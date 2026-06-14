/**
 * Redis Streams Producer/Consumer utilities for the RTO Reallocation Engine pipeline.
 *
 * Provides event-driven pub/sub patterns using Redis Streams with consumer groups
 * for each pipeline stage. Supports auto-reconnect, connection pooling, and
 * typed message interfaces.
 *
 * Validates: Requirements 10.2, 11.3
 */
import Redis, { Redis as RedisClient } from 'ioredis';
import { config } from '../config';

// ---------------------------------------------------------------------------
// Types & Interfaces
// ---------------------------------------------------------------------------

/** Pipeline stages used as stream and consumer group names. */
export const PIPELINE_STAGES = [
  'rto-events',
  'evidence-collection',
  'classification',
  'prediction',
  'demand-matching',
  'buyer-ranking',
  'decision',
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

/** Base stream message envelope (Requirement 10.2). */
export interface StreamMessage {
  /** Unique event type identifier */
  eventType: string;
  /** Source entity identifier (e.g. order ID, RTO event ID) */
  sourceEntityId: string;
  /** Target entity identifier (e.g. buyer ID, courier ID) */
  targetEntityId: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Module that produced the event */
  actorModule: string;
  /** Outcome status of the operation */
  outcomeStatus: string;
  /** JSON-encoded input parameters that produced the outcome */
  inputParams: string;
}

/** Raw Redis stream entry returned from XREADGROUP / XREAD. */
export interface StreamEntry {
  id: string;
  fields: Record<string, string>;
}

/** Handler callback for consumed messages. */
export type StreamMessageHandler = (
  entry: StreamEntry,
  stream: string,
) => Promise<void>;

/** Options for the consumer. */
export interface ConsumerOptions {
  /** Consumer group name (defaults to stage name + '-group') */
  group?: string;
  /** Consumer name within the group (defaults to hostname + pid) */
  consumer?: string;
  /** Block timeout in ms when waiting for new messages (default: 5000) */
  blockMs?: number;
  /** Number of messages to read per batch (default: 10) */
  batchSize?: number;
  /** Whether to start reading from the beginning or only new messages */
  startId?: string;
}

// ---------------------------------------------------------------------------
// Connection Management
// ---------------------------------------------------------------------------

/**
 * Creates a Redis client with auto-reconnect and error handling.
 * Uses the REDIS_URL from config with sensible retry defaults.
 */
export function createRedisClient(purpose?: string): RedisClient {
  const client = new Redis(config.redisUrl, {
    maxRetriesPerRequest: null, // Required for blocking commands (XREADGROUP)
    enableReadyCheck: true,
    retryStrategy(times: number) {
      // Exponential backoff capped at 5 seconds
      const delay = Math.min(times * 200, 5000);
      return delay;
    },
    reconnectOnError(err: Error) {
      // Reconnect on common transient errors
      const targetErrors = ['READONLY', 'ECONNRESET', 'ECONNREFUSED'];
      return targetErrors.some((e) => err.message.includes(e));
    },
    lazyConnect: false,
  });

  const label = purpose ? `[Redis:${purpose}]` : '[Redis]';

  client.on('error', (err) => {
    console.error(`${label} Connection error:`, err.message);
  });

  client.on('connect', () => {
    console.log(`${label} Connected`);
  });

  client.on('reconnecting', () => {
    console.log(`${label} Reconnecting...`);
  });

  return client;
}

// ---------------------------------------------------------------------------
// Consumer Group Management
// ---------------------------------------------------------------------------

/**
 * Creates a consumer group for a stream if it does not already exist.
 * Uses MKSTREAM to auto-create the stream if needed.
 *
 * @param client - Redis client instance
 * @param stream - Stream key name
 * @param group - Consumer group name
 * @param startId - ID to start reading from ('0' for beginning, '$' for new only)
 */
export async function createConsumerGroup(
  client: RedisClient,
  stream: string,
  group: string,
  startId: string = '0',
): Promise<void> {
  try {
    await client.xgroup('CREATE', stream, group, startId, 'MKSTREAM');
  } catch (err: unknown) {
    // BUSYGROUP means group already exists — that's fine
    if (err instanceof Error && err.message.includes('BUSYGROUP')) {
      return;
    }
    throw err;
  }
}

/**
 * Initializes consumer groups for all pipeline stages.
 * Each stage gets a stream named after the stage and a group named `{stage}-group`.
 */
export async function initializePipelineGroups(client: RedisClient): Promise<void> {
  for (const stage of PIPELINE_STAGES) {
    await createConsumerGroup(client, stage, `${stage}-group`, '0');
  }
}

// ---------------------------------------------------------------------------
// RedisStreamProducer
// ---------------------------------------------------------------------------

/**
 * Publishes events to Redis Streams.
 * Requirement 10.2: Emit events within 500ms.
 * Requirement 11.3: Supports buffering up to 500,000 events.
 */
export class RedisStreamProducer {
  private client: RedisClient;
  private connected: boolean = false;

  constructor(client?: RedisClient) {
    this.client = client ?? createRedisClient('producer');
    this.connected = true;
  }

  /**
   * Publishes a message to a Redis Stream.
   * Automatically generates a timestamp-based ID using '*' (server-assigned).
   *
   * @param stream - The stream key (typically a PipelineStage)
   * @param data - Key-value pairs to store in the stream entry
   * @returns The generated stream entry ID
   */
  async publishEvent(
    stream: string,
    data: Record<string, string>,
  ): Promise<string> {
    const fields: string[] = [];
    for (const [key, value] of Object.entries(data)) {
      fields.push(key, value);
    }
    const id = await this.client.xadd(stream, '*', ...fields);
    return id as string;
  }

  /**
   * Publishes a typed StreamMessage to the given stream.
   * Convenience wrapper that serializes a StreamMessage into flat key-value pairs.
   */
  async publishStreamMessage(
    stream: string,
    message: StreamMessage,
  ): Promise<string> {
    return this.publishEvent(stream, message as unknown as Record<string, string>);
  }

  /**
   * Trims a stream to a maximum length (approximate) for capacity management.
   * Requirement 11.3: Buffer capacity management.
   *
   * @param stream - Stream key
   * @param maxLen - Maximum number of entries to retain
   */
  async trimStream(stream: string, maxLen: number): Promise<number> {
    return this.client.xtrim(stream, 'MAXLEN', '~', maxLen);
  }

  /** Returns the underlying Redis client (for testing / advanced use). */
  getClient(): RedisClient {
    return this.client;
  }

  /** Gracefully close the producer connection. */
  async disconnect(): Promise<void> {
    if (this.connected) {
      this.connected = false;
      await this.client.quit();
    }
  }
}

// ---------------------------------------------------------------------------
// RedisStreamConsumer
// ---------------------------------------------------------------------------

/**
 * Subscribes to Redis Streams using consumer groups for pipeline stage processing.
 * Supports blocking reads, acknowledgement, and graceful shutdown.
 */
export class RedisStreamConsumer {
  private client: RedisClient;
  private running: boolean = false;
  private options: Required<ConsumerOptions>;
  private stream: string;

  constructor(stream: string, options?: ConsumerOptions, client?: RedisClient) {
    this.client = client ?? createRedisClient(`consumer:${stream}`);
    this.stream = stream;
    this.options = {
      group: options?.group ?? `${stream}-group`,
      consumer:
        options?.consumer ?? `consumer-${process.pid}-${Date.now()}`,
      blockMs: options?.blockMs ?? 5000,
      batchSize: options?.batchSize ?? 10,
      startId: options?.startId ?? '>',
    };
  }

  /**
   * Starts consuming messages from the stream.
   * Calls handler for each message and acknowledges on success.
   * Runs until stop() is called.
   */
  async subscribe(handler: StreamMessageHandler): Promise<void> {
    // Ensure consumer group exists
    await createConsumerGroup(
      this.client,
      this.stream,
      this.options.group,
      '0',
    );

    this.running = true;

    while (this.running) {
      try {
        const results = await this.client.xreadgroup(
          'GROUP',
          this.options.group,
          this.options.consumer,
          'COUNT',
          this.options.batchSize,
          'BLOCK',
          this.options.blockMs,
          'STREAMS',
          this.stream,
          this.options.startId,
        );

        if (!results) continue;

        for (const [streamKey, messages] of results as [string, [string, string[]][]][]) {
          for (const [id, fields] of messages) {
            const entry = parseStreamEntry(id, fields);
            await handler(entry, streamKey);
            // Acknowledge successful processing
            await this.client.xack(
              this.stream,
              this.options.group,
              id,
            );
          }
        }
      } catch (err: unknown) {
        if (!this.running) break;
        console.error(
          `[Consumer:${this.stream}] Error reading stream:`,
          err instanceof Error ? err.message : err,
        );
        // Brief pause before retrying to avoid tight error loops
        await sleep(1000);
      }
    }
  }

  /**
   * Processes pending (unacknowledged) messages that were claimed but not completed.
   * Useful for recovery after consumer crashes.
   */
  async processPending(handler: StreamMessageHandler): Promise<number> {
    let processed = 0;
    const pending = await this.client.xreadgroup(
      'GROUP',
      this.options.group,
      this.options.consumer,
      'COUNT',
      this.options.batchSize,
      'STREAMS',
      this.stream,
      '0', // '0' reads pending entries for this consumer
    );

    if (!pending) return 0;

    for (const [streamKey, messages] of pending as [string, [string, string[]][]][]) {
      for (const [id, fields] of messages) {
        if (fields.length === 0) continue; // Already acknowledged
        const entry = parseStreamEntry(id, fields);
        await handler(entry, streamKey);
        await this.client.xack(this.stream, this.options.group, id);
        processed++;
      }
    }

    return processed;
  }

  /** Stops the consumer loop gracefully. */
  stop(): void {
    this.running = false;
  }

  /** Returns whether the consumer is currently running. */
  isRunning(): boolean {
    return this.running;
  }

  /** Returns the underlying Redis client (for testing / advanced use). */
  getClient(): RedisClient {
    return this.client;
  }

  /** Gracefully close the consumer connection. */
  async disconnect(): Promise<void> {
    this.stop();
    await this.client.quit();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parses raw Redis stream fields array into a key-value record. */
function parseStreamEntry(id: string, fields: string[]): StreamEntry {
  const record: Record<string, string> = {};
  for (let i = 0; i < fields.length; i += 2) {
    const key = fields[i];
    const value = fields[i + 1];
    if (key !== undefined && value !== undefined) {
      record[key] = value;
    }
  }
  return { id, fields: record };
}

/** Promise-based sleep utility. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Exported for testing. */
export { parseStreamEntry, sleep };
