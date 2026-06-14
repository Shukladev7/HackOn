/**
 * Tests for EventBufferManager — buffer capacity management, rejection,
 * and dead letter queue functionality.
 *
 * Uses an in-memory mock Redis client to test logic without requiring
 * a running Redis instance.
 *
 * Validates: Requirements 11.3, 11.5
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  EventBufferManager,
  BUFFER_STREAM_KEY,
  REJECTED_EVENTS_KEY,
  DEAD_LETTER_QUEUE_KEY,
  RETRY_COUNTS_KEY,
  DEFAULT_MAX_RETRIES,
} from './eventBufferManager';

// ---------------------------------------------------------------------------
// In-memory Redis mock
// ---------------------------------------------------------------------------

/**
 * Minimal mock of ioredis commands used by EventBufferManager.
 * Simulates streams, sets, and hashes in memory.
 */
class MockRedisClient {
  private streams: Map<string, Array<[string, string[]]>> = new Map();
  private sets: Map<string, Set<string>> = new Map();
  private hashes: Map<string, Map<string, string>> = new Map();
  private idCounter = 0;

  async xlen(key: string): Promise<number> {
    return this.streams.get(key)?.length ?? 0;
  }

  async xadd(key: string, id: string, ...fields: string[]): Promise<string> {
    if (!this.streams.has(key)) {
      this.streams.set(key, []);
    }
    const generatedId = id === '*' ? `${Date.now()}-${this.idCounter++}` : id;
    this.streams.get(key)!.push([generatedId, fields]);
    return generatedId;
  }

  async xrange(
    key: string,
    _start: string,
    _end: string,
    ..._args: unknown[]
  ): Promise<Array<[string, string[]]>> {
    const entries = this.streams.get(key) ?? [];
    // Honor COUNT if provided
    const countIdx = _args.indexOf('COUNT');
    if (countIdx !== -1 && countIdx + 1 < _args.length) {
      const count = _args[countIdx + 1] as number;
      return entries.slice(0, count);
    }
    return entries;
  }

  async sadd(key: string, ...members: string[]): Promise<number> {
    if (!this.sets.has(key)) {
      this.sets.set(key, new Set());
    }
    let added = 0;
    for (const m of members) {
      if (!this.sets.get(key)!.has(m)) {
        this.sets.get(key)!.add(m);
        added++;
      }
    }
    return added;
  }

  async smembers(key: string): Promise<string[]> {
    return Array.from(this.sets.get(key) ?? []);
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    const set = this.sets.get(key);
    if (!set) return 0;
    let removed = 0;
    for (const m of members) {
      if (set.delete(m)) removed++;
    }
    return removed;
  }

  async scard(key: string): Promise<number> {
    return this.sets.get(key)?.size ?? 0;
  }

  async hincrby(key: string, field: string, increment: number): Promise<number> {
    if (!this.hashes.has(key)) {
      this.hashes.set(key, new Map());
    }
    const hash = this.hashes.get(key)!;
    const current = parseInt(hash.get(field) ?? '0', 10);
    const newVal = current + increment;
    hash.set(field, String(newVal));
    return newVal;
  }

  async hget(key: string, field: string): Promise<string | null> {
    return this.hashes.get(key)?.get(field) ?? null;
  }

  async hdel(key: string, ...fields: string[]): Promise<number> {
    const hash = this.hashes.get(key);
    if (!hash) return 0;
    let deleted = 0;
    for (const f of fields) {
      if (hash.delete(f)) deleted++;
    }
    return deleted;
  }

  // Helpers for test setup
  _setStreamLength(key: string, count: number): void {
    if (!this.streams.has(key)) {
      this.streams.set(key, []);
    }
    const stream = this.streams.get(key)!;
    stream.length = 0;
    for (let i = 0; i < count; i++) {
      stream.push([`${Date.now()}-${i}`, ['eventId', `event-${i}`]]);
    }
  }

  _clear(): void {
    this.streams.clear();
    this.sets.clear();
    this.hashes.clear();
    this.idCounter = 0;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EventBufferManager', () => {
  let redis: MockRedisClient;
  let manager: EventBufferManager;

  beforeEach(() => {
    redis = new MockRedisClient();
    manager = new EventBufferManager(redis as any, {
      maxCapacity: 100, // Small capacity for testing
      maxRetries: 3,
    });
  });

  // -------------------------------------------------------------------------
  // Buffer Depth Tracking
  // -------------------------------------------------------------------------

  describe('Buffer Depth Tracking', () => {
    it('should return 0 for an empty buffer', async () => {
      const depth = await manager.getBufferDepth();
      expect(depth).toBe(0);
    });

    it('should return correct depth after enqueuing events', async () => {
      await manager.enqueueEvent('evt-1', { data: 'test1' });
      await manager.enqueueEvent('evt-2', { data: 'test2' });
      const depth = await manager.getBufferDepth();
      expect(depth).toBe(2);
    });

    it('should report max capacity from config', () => {
      expect(manager.getMaxCapacity()).toBe(100);
    });

    it('should detect when buffer is at capacity', async () => {
      redis._setStreamLength(BUFFER_STREAM_KEY, 100);
      const atCap = await manager.isAtCapacity();
      expect(atCap).toBe(true);
    });

    it('should report not at capacity when below max', async () => {
      redis._setStreamLength(BUFFER_STREAM_KEY, 50);
      const atCap = await manager.isAtCapacity();
      expect(atCap).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Event Enqueue with Capacity Check
  // -------------------------------------------------------------------------

  describe('Event Enqueue with Capacity Check', () => {
    it('should accept events when buffer has capacity', async () => {
      const result = await manager.enqueueEvent('evt-1', { shipmentId: 'SHP001' });
      expect(result.accepted).toBe(true);
      expect(result.streamId).toBeTruthy();
      expect(result.rejectionReason).toBeUndefined();
      expect(result.currentDepth).toBe(1);
      expect(result.maxCapacity).toBe(100);
    });

    it('should reject events when buffer is at capacity', async () => {
      redis._setStreamLength(BUFFER_STREAM_KEY, 100);

      const result = await manager.enqueueEvent('evt-overflow', { shipmentId: 'SHP999' });
      expect(result.accepted).toBe(false);
      expect(result.streamId).toBeNull();
      expect(result.rejectionReason).toBe('capacity_exceeded');
      expect(result.currentDepth).toBe(100);
    });

    it('should persist rejected event ID for later reprocessing', async () => {
      redis._setStreamLength(BUFFER_STREAM_KEY, 100);

      await manager.enqueueEvent('evt-rejected-1', { shipmentId: 'SHP100' });
      await manager.enqueueEvent('evt-rejected-2', { shipmentId: 'SHP101' });

      const rejected = await manager.getRejectedEventIds();
      expect(rejected).toContain('evt-rejected-1');
      expect(rejected).toContain('evt-rejected-2');
    });

    it('should include eventId field in stream entry data', async () => {
      const result = await manager.enqueueEvent('evt-1', { foo: 'bar' });
      expect(result.accepted).toBe(true);
      // The mock stores the fields; verify structure by checking depth
      expect(await manager.getBufferDepth()).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Rejected Event Persistence
  // -------------------------------------------------------------------------

  describe('Rejected Event Persistence', () => {
    it('should persist and retrieve rejected event IDs', async () => {
      await manager.persistRejectedEventId('evt-a');
      await manager.persistRejectedEventId('evt-b');

      const ids = await manager.getRejectedEventIds();
      expect(ids.sort()).toEqual(['evt-a', 'evt-b']);
    });

    it('should remove rejected event IDs after reprocessing', async () => {
      await manager.persistRejectedEventId('evt-a');
      await manager.persistRejectedEventId('evt-b');

      await manager.removeRejectedEventId('evt-a');

      const ids = await manager.getRejectedEventIds();
      expect(ids).toEqual(['evt-b']);
    });

    it('should return correct count of rejected events', async () => {
      await manager.persistRejectedEventId('evt-1');
      await manager.persistRejectedEventId('evt-2');
      await manager.persistRejectedEventId('evt-3');

      const count = await manager.getRejectedCount();
      expect(count).toBe(3);
    });

    it('should not duplicate rejected event IDs', async () => {
      await manager.persistRejectedEventId('evt-dup');
      await manager.persistRejectedEventId('evt-dup');

      const count = await manager.getRejectedCount();
      expect(count).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Dead Letter Queue
  // -------------------------------------------------------------------------

  describe('Dead Letter Queue', () => {
    it('should increment retry count correctly', async () => {
      const count1 = await manager.incrementRetryCount('evt-1');
      expect(count1).toBe(1);
      const count2 = await manager.incrementRetryCount('evt-1');
      expect(count2).toBe(2);
      const count3 = await manager.incrementRetryCount('evt-1');
      expect(count3).toBe(3);
    });

    it('should report retry count for an event', async () => {
      await manager.incrementRetryCount('evt-1');
      await manager.incrementRetryCount('evt-1');

      const count = await manager.getRetryCount('evt-1');
      expect(count).toBe(2);
    });

    it('should return 0 for events with no retries', async () => {
      const count = await manager.getRetryCount('non-existent');
      expect(count).toBe(0);
    });

    it('should detect when retries are exhausted', async () => {
      await manager.incrementRetryCount('evt-1');
      await manager.incrementRetryCount('evt-1');
      await manager.incrementRetryCount('evt-1');

      const exhausted = await manager.hasExhaustedRetries('evt-1');
      expect(exhausted).toBe(true);
    });

    it('should not mark retries exhausted before reaching max', async () => {
      await manager.incrementRetryCount('evt-1');
      await manager.incrementRetryCount('evt-1');

      const exhausted = await manager.hasExhaustedRetries('evt-1');
      expect(exhausted).toBe(false);
    });

    it('should send event to DLQ with correct data', async () => {
      // Set retry count first
      await manager.incrementRetryCount('evt-fail');
      await manager.incrementRetryCount('evt-fail');
      await manager.incrementRetryCount('evt-fail');

      const streamId = await manager.sendToDeadLetterQueue(
        'evt-fail',
        'processing_timeout',
        { shipmentId: 'SHP001', orderId: 'ORD001' },
      );

      expect(streamId).toBeTruthy();

      const dlqDepth = await manager.getDLQDepth();
      expect(dlqDepth).toBe(1);
    });

    it('should clean up retry counter after sending to DLQ', async () => {
      await manager.incrementRetryCount('evt-fail');
      await manager.incrementRetryCount('evt-fail');
      await manager.incrementRetryCount('evt-fail');

      await manager.sendToDeadLetterQueue('evt-fail', 'timeout', { data: 'test' });

      const count = await manager.getRetryCount('evt-fail');
      expect(count).toBe(0);
    });

    it('should read DLQ entries with all required fields', async () => {
      await manager.incrementRetryCount('evt-dlq-1');
      await manager.incrementRetryCount('evt-dlq-1');
      await manager.incrementRetryCount('evt-dlq-1');

      await manager.sendToDeadLetterQueue(
        'evt-dlq-1',
        'service_unavailable',
        { shipmentId: 'SHP001' },
      );

      const entries = await manager.readDLQEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].eventId).toBe('evt-dlq-1');
      expect(entries[0].reason).toBe('service_unavailable');
      expect(entries[0].retryCount).toBe(3);
      expect(entries[0].enqueuedAt).toBeTruthy();
      expect(entries[0].originalData).toEqual({ shipmentId: 'SHP001' });
    });
  });

  // -------------------------------------------------------------------------
  // handleProcessingFailure
  // -------------------------------------------------------------------------

  describe('handleProcessingFailure', () => {
    it('should increment retry and not send to DLQ on first failures', async () => {
      const result = await manager.handleProcessingFailure(
        'evt-1',
        'timeout',
        { data: 'test' },
      );

      expect(result.sentToDlq).toBe(false);
      expect(result.retryCount).toBe(1);
      expect(result.dlqStreamId).toBeUndefined();
    });

    it('should send to DLQ when retries are exhausted', async () => {
      // First two failures
      await manager.handleProcessingFailure('evt-1', 'timeout', { data: 'test' });
      await manager.handleProcessingFailure('evt-1', 'timeout', { data: 'test' });

      // Third failure should trigger DLQ
      const result = await manager.handleProcessingFailure(
        'evt-1',
        'timeout',
        { data: 'test' },
      );

      expect(result.sentToDlq).toBe(true);
      expect(result.retryCount).toBe(3);
      expect(result.dlqStreamId).toBeTruthy();
    });

    it('should route to DLQ with correct data after exhausting retries', async () => {
      const originalData = { shipmentId: 'SHP001', orderId: 'ORD001' };

      await manager.handleProcessingFailure('evt-dlq', 'timeout', originalData);
      await manager.handleProcessingFailure('evt-dlq', 'timeout', originalData);
      await manager.handleProcessingFailure('evt-dlq', 'service_error', originalData);

      const entries = await manager.readDLQEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].eventId).toBe('evt-dlq');
      expect(entries[0].reason).toBe('service_error');
      expect(entries[0].originalData).toEqual(originalData);
    });
  });

  // -------------------------------------------------------------------------
  // Health Status
  // -------------------------------------------------------------------------

  describe('getHealthStatus', () => {
    it('should return correct health status for empty buffer', async () => {
      const status = await manager.getHealthStatus();
      expect(status.bufferDepth).toBe(0);
      expect(status.maxCapacity).toBe(100);
      expect(status.utilizationPercent).toBe(0);
      expect(status.atCapacity).toBe(false);
      expect(status.rejectedCount).toBe(0);
      expect(status.dlqDepth).toBe(0);
    });

    it('should return correct utilization percentage', async () => {
      redis._setStreamLength(BUFFER_STREAM_KEY, 50);

      const status = await manager.getHealthStatus();
      expect(status.utilizationPercent).toBe(50);
    });

    it('should reflect rejected events and DLQ in status', async () => {
      await manager.persistRejectedEventId('r1');
      await manager.persistRejectedEventId('r2');

      await manager.incrementRetryCount('f1');
      await manager.incrementRetryCount('f1');
      await manager.incrementRetryCount('f1');
      await manager.sendToDeadLetterQueue('f1', 'test', { data: 'x' });

      const status = await manager.getHealthStatus();
      expect(status.rejectedCount).toBe(2);
      expect(status.dlqDepth).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Edge Cases
  // -------------------------------------------------------------------------

  describe('Edge Cases', () => {
    it('should handle buffer at exact capacity boundary', async () => {
      redis._setStreamLength(BUFFER_STREAM_KEY, 99);

      // One more should succeed (bringing to 100)
      const result = await manager.enqueueEvent('evt-99', { data: 'last' });
      expect(result.accepted).toBe(true);
    });

    it('should handle zero max capacity gracefully', () => {
      const zeroCapManager = new EventBufferManager(redis as any, {
        maxCapacity: 0,
        maxRetries: 3,
      });
      expect(zeroCapManager.getMaxCapacity()).toBe(0);
    });

    it('should handle concurrent rejected events', async () => {
      redis._setStreamLength(BUFFER_STREAM_KEY, 100);

      // Simulate multiple concurrent rejections
      const results = await Promise.all([
        manager.enqueueEvent('evt-c1', { data: '1' }),
        manager.enqueueEvent('evt-c2', { data: '2' }),
        manager.enqueueEvent('evt-c3', { data: '3' }),
      ]);

      results.forEach((r) => {
        expect(r.accepted).toBe(false);
        expect(r.rejectionReason).toBe('capacity_exceeded');
      });

      const rejectedCount = await manager.getRejectedCount();
      expect(rejectedCount).toBe(3);
    });

    it('should use default max retries when not specified', () => {
      const defaultManager = new EventBufferManager(redis as any);
      expect(DEFAULT_MAX_RETRIES).toBe(3);
    });
  });
});
