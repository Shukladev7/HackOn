/**
 * Event Buffer Manager — capacity management for the RTO event pipeline.
 *
 * Tracks buffer depth against a configurable maximum (default: 500,000 events),
 * rejects new events with a capacity-exceeded indication when full, persists
 * rejected event IDs for later reprocessing, and routes events that exhaust
 * retries to a dead letter queue.
 *
 * Validates: Requirements 11.3, 11.5
 */
import { Redis as RedisClient } from 'ioredis';
import { config } from '../config';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Redis key for the main event buffer stream. */
export const BUFFER_STREAM_KEY = 'rto-events';

/** Redis key for persisted rejected event IDs (Set). */
export const REJECTED_EVENTS_KEY = 'rto-events:rejected';

/** Redis key for the dead letter queue stream. */
export const DEAD_LETTER_QUEUE_KEY = 'rto-events:dlq';

/** Redis key for tracking per-event retry counts (Hash). */
export const RETRY_COUNTS_KEY = 'rto-events:retries';

/** Default max retry attempts before routing to DLQ. */
export const DEFAULT_MAX_RETRIES = 3;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of attempting to enqueue an event. */
export interface EnqueueResult {
  /** Whether the event was accepted into the buffer. */
  accepted: boolean;
  /** The stream entry ID if accepted, null if rejected. */
  streamId: string | null;
  /** Reason for rejection (only set when accepted=false). */
  rejectionReason?: 'capacity_exceeded' | 'duplicate';
  /** Current buffer depth at time of attempt. */
  currentDepth: number;
  /** Maximum buffer capacity. */
  maxCapacity: number;
}

/** Result of sending an event to the dead letter queue. */
export interface DLQEntry {
  /** The original event ID. */
  eventId: string;
  /** Reason the event was routed to DLQ. */
  reason: string;
  /** Number of retry attempts made. */
  retryCount: number;
  /** ISO timestamp of DLQ routing. */
  enqueuedAt: string;
  /** Original event data (serialized). */
  originalData: Record<string, string>;
}

/** Options for the EventBufferManager. */
export interface EventBufferManagerOptions {
  /** Maximum buffer capacity (defaults to config.eventBufferCapacity). */
  maxCapacity?: number;
  /** Maximum retries before routing to DLQ (defaults to DEFAULT_MAX_RETRIES). */
  maxRetries?: number;
}

// ---------------------------------------------------------------------------
// EventBufferManager
// ---------------------------------------------------------------------------

export class EventBufferManager {
  private client: RedisClient;
  private maxCapacity: number;
  private maxRetries: number;

  constructor(client: RedisClient, options?: EventBufferManagerOptions) {
    this.client = client;
    this.maxCapacity = options?.maxCapacity ?? config.eventBufferCapacity;
    this.maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
  }

  // -------------------------------------------------------------------------
  // Buffer Depth Tracking
  // -------------------------------------------------------------------------

  /**
   * Returns the current number of events in the buffer stream.
   */
  async getBufferDepth(): Promise<number> {
    const len = await this.client.xlen(BUFFER_STREAM_KEY);
    return len;
  }

  /**
   * Returns the maximum buffer capacity.
   */
  getMaxCapacity(): number {
    return this.maxCapacity;
  }

  /**
   * Returns whether the buffer has reached capacity.
   */
  async isAtCapacity(): Promise<boolean> {
    const depth = await this.getBufferDepth();
    return depth >= this.maxCapacity;
  }

  // -------------------------------------------------------------------------
  // Event Enqueue with Capacity Check
  // -------------------------------------------------------------------------

  /**
   * Attempts to enqueue an event into the buffer stream.
   *
   * If the buffer is at capacity, the event is rejected and its ID is persisted
   * to the rejected events set for later reprocessing (Requirement 11.5).
   *
   * @param eventId - Unique identifier for the event
   * @param data - Key-value pairs to store in the stream entry
   * @returns EnqueueResult indicating acceptance or rejection
   */
  async enqueueEvent(
    eventId: string,
    data: Record<string, string>,
  ): Promise<EnqueueResult> {
    const currentDepth = await this.getBufferDepth();

    if (currentDepth >= this.maxCapacity) {
      // Persist rejected event ID for later reprocessing
      await this.persistRejectedEventId(eventId);

      return {
        accepted: false,
        streamId: null,
        rejectionReason: 'capacity_exceeded',
        currentDepth,
        maxCapacity: this.maxCapacity,
      };
    }

    // Enqueue to the buffer stream
    const fields: string[] = [];
    fields.push('eventId', eventId);
    for (const [key, value] of Object.entries(data)) {
      fields.push(key, value);
    }

    const streamId = await this.client.xadd(BUFFER_STREAM_KEY, '*', ...fields);

    return {
      accepted: true,
      streamId,
      currentDepth: currentDepth + 1,
      maxCapacity: this.maxCapacity,
    };
  }

  // -------------------------------------------------------------------------
  // Rejected Event Persistence
  // -------------------------------------------------------------------------

  /**
   * Persists a rejected event ID for later reprocessing (Requirement 11.5).
   */
  async persistRejectedEventId(eventId: string): Promise<void> {
    await this.client.sadd(REJECTED_EVENTS_KEY, eventId);
  }

  /**
   * Returns all persisted rejected event IDs.
   */
  async getRejectedEventIds(): Promise<string[]> {
    return this.client.smembers(REJECTED_EVENTS_KEY);
  }

  /**
   * Removes a rejected event ID after successful reprocessing.
   */
  async removeRejectedEventId(eventId: string): Promise<void> {
    await this.client.srem(REJECTED_EVENTS_KEY, eventId);
  }

  /**
   * Returns the count of rejected events pending reprocessing.
   */
  async getRejectedCount(): Promise<number> {
    return this.client.scard(REJECTED_EVENTS_KEY);
  }

  // -------------------------------------------------------------------------
  // Dead Letter Queue
  // -------------------------------------------------------------------------

  /**
   * Increments the retry count for an event and checks if retries are exhausted.
   *
   * @param eventId - The event identifier
   * @returns The new retry count after increment
   */
  async incrementRetryCount(eventId: string): Promise<number> {
    const count = await this.client.hincrby(RETRY_COUNTS_KEY, eventId, 1);
    return count;
  }

  /**
   * Returns the current retry count for an event.
   */
  async getRetryCount(eventId: string): Promise<number> {
    const count = await this.client.hget(RETRY_COUNTS_KEY, eventId);
    return count ? parseInt(count, 10) : 0;
  }

  /**
   * Checks if an event has exhausted its retries.
   */
  async hasExhaustedRetries(eventId: string): Promise<boolean> {
    const count = await this.getRetryCount(eventId);
    return count >= this.maxRetries;
  }

  /**
   * Routes an event to the dead letter queue after exhausting retries.
   *
   * @param eventId - The event identifier
   * @param reason - Reason for DLQ routing
   * @param originalData - Original event data for reprocessing
   * @returns The DLQ stream entry ID
   */
  async sendToDeadLetterQueue(
    eventId: string,
    reason: string,
    originalData: Record<string, string>,
  ): Promise<string> {
    const retryCount = await this.getRetryCount(eventId);
    const enqueuedAt = new Date().toISOString();

    const fields: string[] = [
      'eventId', eventId,
      'reason', reason,
      'retryCount', String(retryCount),
      'enqueuedAt', enqueuedAt,
      'originalData', JSON.stringify(originalData),
    ];

    const streamId = await this.client.xadd(DEAD_LETTER_QUEUE_KEY, '*', ...fields);

    // Clean up retry counter
    await this.client.hdel(RETRY_COUNTS_KEY, eventId);

    return streamId;
  }

  /**
   * Handles a failed event processing attempt. Increments retry count and
   * routes to DLQ if retries are exhausted.
   *
   * @param eventId - The event identifier
   * @param reason - Reason for the failure
   * @param originalData - Original event data
   * @returns Whether the event was sent to DLQ
   */
  async handleProcessingFailure(
    eventId: string,
    reason: string,
    originalData: Record<string, string>,
  ): Promise<{ sentToDlq: boolean; retryCount: number; dlqStreamId?: string }> {
    const retryCount = await this.incrementRetryCount(eventId);

    if (retryCount >= this.maxRetries) {
      const dlqStreamId = await this.sendToDeadLetterQueue(
        eventId,
        reason,
        originalData,
      );
      return { sentToDlq: true, retryCount, dlqStreamId };
    }

    return { sentToDlq: false, retryCount };
  }

  /**
   * Returns the number of events in the dead letter queue.
   */
  async getDLQDepth(): Promise<number> {
    return this.client.xlen(DEAD_LETTER_QUEUE_KEY);
  }

  /**
   * Reads entries from the dead letter queue for inspection or reprocessing.
   *
   * @param count - Maximum number of entries to read
   * @returns Array of DLQ entries
   */
  async readDLQEntries(count: number = 100): Promise<DLQEntry[]> {
    const entries = await this.client.xrange(
      DEAD_LETTER_QUEUE_KEY,
      '-',
      '+',
      'COUNT',
      count,
    );

    return entries.map(([_id, fields]) => {
      const record: Record<string, string> = {};
      for (let i = 0; i < fields.length; i += 2) {
        record[fields[i]] = fields[i + 1];
      }
      return {
        eventId: record.eventId ?? '',
        reason: record.reason ?? '',
        retryCount: parseInt(record.retryCount ?? '0', 10),
        enqueuedAt: record.enqueuedAt ?? '',
        originalData: record.originalData ? JSON.parse(record.originalData) : {},
      };
    });
  }

  // -------------------------------------------------------------------------
  // Utility
  // -------------------------------------------------------------------------

  /**
   * Returns a health status snapshot of the buffer system.
   */
  async getHealthStatus(): Promise<{
    bufferDepth: number;
    maxCapacity: number;
    utilizationPercent: number;
    atCapacity: boolean;
    rejectedCount: number;
    dlqDepth: number;
  }> {
    const [bufferDepth, rejectedCount, dlqDepth] = await Promise.all([
      this.getBufferDepth(),
      this.getRejectedCount(),
      this.getDLQDepth(),
    ]);

    const utilizationPercent =
      this.maxCapacity > 0
        ? Math.round((bufferDepth / this.maxCapacity) * 10000) / 100
        : 0;

    return {
      bufferDepth,
      maxCapacity: this.maxCapacity,
      utilizationPercent,
      atCapacity: bufferDepth >= this.maxCapacity,
      rejectedCount,
      dlqDepth,
    };
  }
}
