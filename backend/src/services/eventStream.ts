/**
 * Event Stream Service — emits events on all state transitions within the
 * RTO Reallocation Engine pipeline.
 *
 * Validates: Requirements 10.2, 10.5
 *
 * - Emits events within 500ms containing: eventType, sourceEntityId,
 *   targetEntityId, timestamp, actorModule, outcomeStatus, inputParams
 * - Buffers locally when stream unavailable; retries up to 5 times
 *   with exponential backoff
 * - Persists to disk if buffer exhausted; reconciles later
 */

import * as fs from 'fs';
import * as path from 'path';
import { EventStream, IEventStream } from '../models/EventStream';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Event payload emitted on state transitions (Requirement 10.2). */
export interface EventPayload {
  eventType: string;
  sourceEntityId: string;
  targetEntityId: string;
  timestamp: string; // ISO 8601
  actorModule: string;
  outcomeStatus: 'success' | 'failure' | 'partial';
  inputParams: Record<string, unknown>;
}

/** Result of an emit attempt. */
export interface EmitResult {
  success: boolean;
  eventId?: string;
  buffered: boolean;
  retryCount: number;
  persistedToDisk: boolean;
  error?: string;
}

/** Options for the EventStreamService. */
export interface EventStreamServiceOptions {
  /** Maximum retry attempts (default: 5) */
  maxRetries?: number;
  /** Initial delay in ms for exponential backoff (default: 100ms) */
  initialDelayMs?: number;
  /** Backoff multiplier (default: 2) */
  backoffMultiplier?: number;
  /** Maximum in-memory buffer size before persisting to disk (default: 1000) */
  maxBufferSize?: number;
  /** Directory path for disk persistence (default: ./data/event-buffer) */
  diskBufferPath?: string;
  /** Emission deadline in ms (default: 500ms per Requirement 10.2) */
  emissionDeadlineMs?: number;
  /** Custom delay function for testing */
  delayFn?: (ms: number) => Promise<void>;
  /** Custom persist function for testing (replaces disk I/O) */
  persistFn?: (events: EventPayload[]) => Promise<void>;
  /** Custom load function for testing (replaces disk I/O) */
  loadPersistedFn?: () => Promise<EventPayload[]>;
  /** Custom stream publish function (replaces MongoDB save) */
  publishFn?: (payload: EventPayload) => Promise<string>;
}

// ---------------------------------------------------------------------------
// Default helpers
// ---------------------------------------------------------------------------

const defaultDelay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// EventStreamService
// ---------------------------------------------------------------------------

export class EventStreamService {
  private buffer: EventPayload[] = [];
  private maxRetries: number;
  private initialDelayMs: number;
  private backoffMultiplier: number;
  private maxBufferSize: number;
  private diskBufferPath: string;
  private emissionDeadlineMs: number;
  private delayFn: (ms: number) => Promise<void>;
  private persistFn: (events: EventPayload[]) => Promise<void>;
  private loadPersistedFn: () => Promise<EventPayload[]>;
  private publishFn: (payload: EventPayload) => Promise<string>;
  private reconciling: boolean = false;

  constructor(options?: EventStreamServiceOptions) {
    this.maxRetries = options?.maxRetries ?? 5;
    this.initialDelayMs = options?.initialDelayMs ?? 100;
    this.backoffMultiplier = options?.backoffMultiplier ?? 2;
    this.maxBufferSize = options?.maxBufferSize ?? 1000;
    this.diskBufferPath = options?.diskBufferPath ?? path.resolve(process.cwd(), 'data', 'event-buffer');
    this.emissionDeadlineMs = options?.emissionDeadlineMs ?? 500;
    this.delayFn = options?.delayFn ?? defaultDelay;
    this.persistFn = options?.persistFn ?? this.defaultPersistToDisk.bind(this);
    this.loadPersistedFn = options?.loadPersistedFn ?? this.defaultLoadFromDisk.bind(this);
    this.publishFn = options?.publishFn ?? this.defaultPublish.bind(this);
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Emits an event for a state transition. Attempts to publish immediately.
   * If publishing fails, buffers locally and retries with exponential backoff.
   * If the in-memory buffer is exhausted, persists to disk.
   *
   * Must complete initial attempt within 500ms (Requirement 10.2).
   */
  async emit(payload: EventPayload): Promise<EmitResult> {
    const result: EmitResult = {
      success: false,
      buffered: false,
      retryCount: 0,
      persistedToDisk: false,
    };

    // Attempt immediate publish with deadline
    try {
      const eventId = await this.publishWithDeadline(payload);
      result.success = true;
      result.eventId = eventId;
      return result;
    } catch {
      // Immediate publish failed — buffer and retry
    }

    // Buffer locally
    result.buffered = true;
    this.addToBuffer(payload);

    // Retry with exponential backoff (up to 5 attempts)
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      const delay = this.initialDelayMs * Math.pow(this.backoffMultiplier, attempt - 1);
      await this.delayFn(delay);
      result.retryCount = attempt;

      try {
        const eventId = await this.publishFn(payload);
        result.success = true;
        result.eventId = eventId;
        this.removeFromBuffer(payload);
        return result;
      } catch {
        // Continue retrying
      }
    }

    // All retries exhausted — persist to disk if buffer is full
    if (this.buffer.length >= this.maxBufferSize) {
      await this.persistBufferToDisk();
      result.persistedToDisk = true;
    }

    result.error = 'All retry attempts exhausted; event buffered for later reconciliation';
    return result;
  }

  /**
   * Reconciles events persisted to disk by attempting to re-publish them.
   * Called periodically or on service recovery.
   */
  async reconcile(): Promise<{ reconciled: number; failed: number }> {
    if (this.reconciling) {
      return { reconciled: 0, failed: 0 };
    }

    this.reconciling = true;
    let reconciled = 0;
    let failed = 0;

    try {
      // Load events from disk
      const persistedEvents = await this.loadPersistedFn();

      if (persistedEvents.length === 0) {
        return { reconciled: 0, failed: 0 };
      }

      const remainingEvents: EventPayload[] = [];

      for (const event of persistedEvents) {
        try {
          await this.publishFn(event);
          reconciled++;
        } catch {
          remainingEvents.push(event);
          failed++;
        }
      }

      // Re-persist events that still failed
      if (remainingEvents.length > 0) {
        await this.persistFn(remainingEvents);
      } else {
        // Clear disk buffer if all reconciled
        await this.persistFn([]);
      }

      return { reconciled, failed };
    } finally {
      this.reconciling = false;
    }
  }

  /**
   * Returns the current in-memory buffer contents.
   */
  getBuffer(): EventPayload[] {
    return [...this.buffer];
  }

  /**
   * Returns the number of events currently in the in-memory buffer.
   */
  getBufferSize(): number {
    return this.buffer.length;
  }

  /**
   * Clears the in-memory buffer.
   */
  clearBuffer(): void {
    this.buffer = [];
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Publishes an event with a deadline (default 500ms).
   * Rejects if the publish takes longer than the deadline.
   */
  private publishWithDeadline(payload: EventPayload): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Emission deadline exceeded (${this.emissionDeadlineMs}ms)`));
      }, this.emissionDeadlineMs);

      this.publishFn(payload)
        .then((id) => {
          clearTimeout(timer);
          resolve(id);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  /**
   * Adds an event to the in-memory buffer.
   */
  private addToBuffer(payload: EventPayload): void {
    this.buffer.push(payload);
  }

  /**
   * Removes an event from the in-memory buffer after successful publish.
   */
  private removeFromBuffer(payload: EventPayload): void {
    const index = this.buffer.findIndex(
      (e) =>
        e.eventType === payload.eventType &&
        e.sourceEntityId === payload.sourceEntityId &&
        e.timestamp === payload.timestamp
    );
    if (index !== -1) {
      this.buffer.splice(index, 1);
    }
  }

  /**
   * Persists the entire in-memory buffer to disk and clears it.
   */
  private async persistBufferToDisk(): Promise<void> {
    const eventsToPersist = [...this.buffer];
    await this.persistFn(eventsToPersist);
    this.buffer = [];
  }

  // -------------------------------------------------------------------------
  // Default I/O implementations (overridable via options for testing)
  // -------------------------------------------------------------------------

  /**
   * Default publish: saves event to MongoDB via the EventStream model.
   */
  private async defaultPublish(payload: EventPayload): Promise<string> {
    const doc = new EventStream({
      eventType: payload.eventType,
      sourceEntityId: payload.sourceEntityId,
      targetEntityId: payload.targetEntityId,
      timestamp: new Date(payload.timestamp),
      actorModule: payload.actorModule,
      outcomeStatus: payload.outcomeStatus,
      inputParams: payload.inputParams,
      buffered: false,
      retryCount: 0,
    });
    const saved = await doc.save();
    return saved._id.toString();
  }

  /**
   * Default disk persistence: writes events as JSON to a file.
   */
  private async defaultPersistToDisk(events: EventPayload[]): Promise<void> {
    const dir = this.diskBufferPath;
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const filePath = path.join(dir, 'buffered-events.json');
    fs.writeFileSync(filePath, JSON.stringify(events, null, 2), 'utf-8');
  }

  /**
   * Default disk load: reads events from the persisted JSON file.
   */
  private async defaultLoadFromDisk(): Promise<EventPayload[]> {
    const filePath = path.join(this.diskBufferPath, 'buffered-events.json');
    if (!fs.existsSync(filePath)) {
      return [];
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    try {
      return JSON.parse(raw) as EventPayload[];
    } catch {
      return [];
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton instance (lazily created)
// ---------------------------------------------------------------------------

let instance: EventStreamService | null = null;

/**
 * Returns a singleton EventStreamService instance.
 */
export function getEventStreamService(options?: EventStreamServiceOptions): EventStreamService {
  if (!instance) {
    instance = new EventStreamService(options);
  }
  return instance;
}

/**
 * Resets the singleton instance (useful for testing).
 */
export function resetEventStreamService(): void {
  instance = null;
}
