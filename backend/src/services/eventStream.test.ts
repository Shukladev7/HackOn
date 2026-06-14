/**
 * Unit tests for EventStreamService.
 *
 * Validates: Requirements 10.2, 10.5
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  EventStreamService,
  EventPayload,
  EventStreamServiceOptions,
  resetEventStreamService,
} from './eventStream';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePayload(overrides?: Partial<EventPayload>): EventPayload {
  return {
    eventType: 'classification',
    sourceEntityId: 'rto-event-123',
    targetEntityId: 'customer-456',
    timestamp: new Date().toISOString(),
    actorModule: 'root_cause_classifier',
    outcomeStatus: 'success',
    inputParams: { confidence: 0.85 },
    ...overrides,
  };
}

/** Creates a service with test-friendly defaults. */
function createService(overrides?: Partial<EventStreamServiceOptions>): EventStreamService {
  return new EventStreamService({
    delayFn: async () => {}, // No real delays in tests
    persistFn: async () => {},
    loadPersistedFn: async () => [],
    publishFn: async () => 'mock-id-123',
    maxBufferSize: 5,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EventStreamService', () => {
  beforeEach(() => {
    resetEventStreamService();
  });

  describe('emit()', () => {
    it('should emit successfully on first attempt when stream is available', async () => {
      const publishFn = vi.fn().mockResolvedValue('event-id-1');
      const service = createService({ publishFn });

      const result = await service.emit(makePayload());

      expect(result.success).toBe(true);
      expect(result.eventId).toBe('event-id-1');
      expect(result.buffered).toBe(false);
      expect(result.retryCount).toBe(0);
      expect(result.persistedToDisk).toBe(false);
      expect(publishFn).toHaveBeenCalledTimes(1);
    });

    it('should include all required event fields in the payload', async () => {
      const publishFn = vi.fn().mockResolvedValue('event-id-1');
      const service = createService({ publishFn });

      const payload = makePayload({
        eventType: 'decision',
        sourceEntityId: 'rto-789',
        targetEntityId: 'buyer-101',
        actorModule: 'decision_engine',
        outcomeStatus: 'success',
        inputParams: { recoveryProbability: 0.7 },
      });

      await service.emit(payload);

      const emittedPayload = publishFn.mock.calls[0][0];
      expect(emittedPayload).toHaveProperty('eventType', 'decision');
      expect(emittedPayload).toHaveProperty('sourceEntityId', 'rto-789');
      expect(emittedPayload).toHaveProperty('targetEntityId', 'buyer-101');
      expect(emittedPayload).toHaveProperty('timestamp');
      expect(emittedPayload).toHaveProperty('actorModule', 'decision_engine');
      expect(emittedPayload).toHaveProperty('outcomeStatus', 'success');
      expect(emittedPayload).toHaveProperty('inputParams');
      expect(emittedPayload.inputParams).toEqual({ recoveryProbability: 0.7 });
    });

    it('should buffer locally and retry when initial publish fails', async () => {
      const publishFn = vi
        .fn()
        .mockRejectedValueOnce(new Error('Stream unavailable')) // initial attempt
        .mockRejectedValueOnce(new Error('Stream unavailable')) // retry 1
        .mockResolvedValueOnce('event-id-2'); // retry 2

      const delayFn = vi.fn().mockResolvedValue(undefined);
      const service = createService({ publishFn, delayFn });

      const result = await service.emit(makePayload());

      expect(result.success).toBe(true);
      expect(result.buffered).toBe(true);
      expect(result.retryCount).toBe(2);
      expect(result.eventId).toBe('event-id-2');
      // First delay: 100ms, second delay: 200ms
      expect(delayFn).toHaveBeenCalledTimes(2);
      expect(delayFn).toHaveBeenCalledWith(100);
      expect(delayFn).toHaveBeenCalledWith(200);
    });

    it('should retry up to 5 times with exponential backoff', async () => {
      const publishFn = vi.fn().mockRejectedValue(new Error('Stream unavailable'));
      const delayFn = vi.fn().mockResolvedValue(undefined);
      const service = createService({ publishFn, delayFn, maxRetries: 5 });

      const result = await service.emit(makePayload());

      expect(result.success).toBe(false);
      expect(result.retryCount).toBe(5);
      expect(result.buffered).toBe(true);
      // 5 delays: 100, 200, 400, 800, 1600
      expect(delayFn).toHaveBeenCalledTimes(5);
      expect(delayFn).toHaveBeenNthCalledWith(1, 100);
      expect(delayFn).toHaveBeenNthCalledWith(2, 200);
      expect(delayFn).toHaveBeenNthCalledWith(3, 400);
      expect(delayFn).toHaveBeenNthCalledWith(4, 800);
      expect(delayFn).toHaveBeenNthCalledWith(5, 1600);
    });

    it('should persist to disk when buffer is full and retries exhausted', async () => {
      const publishFn = vi.fn().mockRejectedValue(new Error('Stream unavailable'));
      const persistFn = vi.fn().mockResolvedValue(undefined);
      const service = createService({
        publishFn,
        persistFn,
        maxBufferSize: 1, // Very low threshold: buffer overflows on first failed emit
      });

      // First emit fails all retries, buffer reaches maxBufferSize → persists to disk
      const result = await service.emit(makePayload({ sourceEntityId: 'evt-1' }));

      expect(result.persistedToDisk).toBe(true);
      expect(persistFn).toHaveBeenCalled();
    });

    it('should remove event from buffer on successful retry', async () => {
      const publishFn = vi
        .fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValueOnce('event-id-3');

      const service = createService({ publishFn });

      await service.emit(makePayload());

      // Buffer should be empty after successful retry
      expect(service.getBufferSize()).toBe(0);
    });

    it('should respect emission deadline of 500ms', async () => {
      // Publish takes too long (exceeds 500ms deadline)
      const slowPublish = () =>
        new Promise<string>((resolve) => setTimeout(() => resolve('late-id'), 700));

      // After deadline failure, retries succeed
      let callCount = 0;
      const publishFn = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return slowPublish();
        return Promise.resolve('retry-id');
      });

      const service = createService({
        publishFn,
        emissionDeadlineMs: 500,
        delayFn: async () => {},
      });

      const result = await service.emit(makePayload());

      // First attempt exceeded deadline, retry succeeded
      expect(result.success).toBe(true);
      expect(result.buffered).toBe(true);
      expect(result.retryCount).toBeGreaterThanOrEqual(1);
    });

    it('should return error message when all retries exhausted', async () => {
      const publishFn = vi.fn().mockRejectedValue(new Error('Permanent failure'));
      const service = createService({ publishFn, maxBufferSize: 1000 });

      const result = await service.emit(makePayload());

      expect(result.success).toBe(false);
      expect(result.error).toContain('retry attempts exhausted');
    });
  });

  describe('buffer management', () => {
    it('should track buffer size correctly', async () => {
      const publishFn = vi.fn().mockRejectedValue(new Error('fail'));
      const service = createService({ publishFn, maxBufferSize: 100 });

      await service.emit(makePayload({ sourceEntityId: 'a' }));
      await service.emit(makePayload({ sourceEntityId: 'b' }));

      expect(service.getBufferSize()).toBe(2);
    });

    it('should return buffer contents via getBuffer()', async () => {
      const publishFn = vi.fn().mockRejectedValue(new Error('fail'));
      const service = createService({ publishFn, maxBufferSize: 100 });

      const payload = makePayload({ sourceEntityId: 'buffer-test' });
      await service.emit(payload);

      const buffer = service.getBuffer();
      expect(buffer).toHaveLength(1);
      expect(buffer[0].sourceEntityId).toBe('buffer-test');
    });

    it('should clear buffer via clearBuffer()', async () => {
      const publishFn = vi.fn().mockRejectedValue(new Error('fail'));
      const service = createService({ publishFn, maxBufferSize: 100 });

      await service.emit(makePayload());
      expect(service.getBufferSize()).toBe(1);

      service.clearBuffer();
      expect(service.getBufferSize()).toBe(0);
    });
  });

  describe('reconcile()', () => {
    it('should re-publish events persisted to disk', async () => {
      const persistedEvents: EventPayload[] = [
        makePayload({ sourceEntityId: 'persisted-1' }),
        makePayload({ sourceEntityId: 'persisted-2' }),
      ];

      const publishFn = vi.fn().mockResolvedValue('reconciled-id');
      const persistFn = vi.fn().mockResolvedValue(undefined);
      const loadPersistedFn = vi.fn().mockResolvedValue(persistedEvents);

      const service = createService({ publishFn, persistFn, loadPersistedFn });

      const result = await service.reconcile();

      expect(result.reconciled).toBe(2);
      expect(result.failed).toBe(0);
      expect(publishFn).toHaveBeenCalledTimes(2);
      // Should clear disk buffer after all reconciled
      expect(persistFn).toHaveBeenCalledWith([]);
    });

    it('should re-persist events that fail during reconciliation', async () => {
      const persistedEvents: EventPayload[] = [
        makePayload({ sourceEntityId: 'ok-event' }),
        makePayload({ sourceEntityId: 'fail-event' }),
      ];

      const publishFn = vi
        .fn()
        .mockResolvedValueOnce('reconciled-id')
        .mockRejectedValueOnce(new Error('still down'));

      const persistFn = vi.fn().mockResolvedValue(undefined);
      const loadPersistedFn = vi.fn().mockResolvedValue(persistedEvents);

      const service = createService({ publishFn, persistFn, loadPersistedFn });

      const result = await service.reconcile();

      expect(result.reconciled).toBe(1);
      expect(result.failed).toBe(1);
      // Re-persist the failed event
      expect(persistFn).toHaveBeenCalledWith([
        expect.objectContaining({ sourceEntityId: 'fail-event' }),
      ]);
    });

    it('should return zeros when no persisted events exist', async () => {
      const loadPersistedFn = vi.fn().mockResolvedValue([]);
      const service = createService({ loadPersistedFn });

      const result = await service.reconcile();

      expect(result.reconciled).toBe(0);
      expect(result.failed).toBe(0);
    });

    it('should prevent concurrent reconciliation', async () => {
      const persistedEvents: EventPayload[] = [
        makePayload({ sourceEntityId: 'concurrent-1' }),
      ];

      let resolvePublish!: (value: string) => void;
      const publishPromise = new Promise<string>((resolve) => {
        resolvePublish = resolve;
      });

      const publishFn = vi.fn().mockReturnValueOnce(publishPromise);
      const loadPersistedFn = vi.fn().mockResolvedValue(persistedEvents);
      const persistFn = vi.fn().mockResolvedValue(undefined);

      const service = createService({ publishFn, persistFn, loadPersistedFn });

      // Start first reconciliation (will block on publish)
      const firstReconcile = service.reconcile();

      // Allow event loop to process so first reconcile enters reconciling state
      await new Promise((r) => setTimeout(r, 10));

      // Start second reconciliation immediately — should return zeros
      const secondResult = await service.reconcile();
      expect(secondResult.reconciled).toBe(0);
      expect(secondResult.failed).toBe(0);

      // Unblock first reconciliation
      resolvePublish('id');
      const firstResult = await firstReconcile;
      expect(firstResult.reconciled).toBe(1);
    });
  });

  describe('exponential backoff', () => {
    it('should use correct exponential backoff delays', async () => {
      const publishFn = vi.fn().mockRejectedValue(new Error('fail'));
      const delayFn = vi.fn().mockResolvedValue(undefined);
      const service = createService({
        publishFn,
        delayFn,
        maxRetries: 5,
        initialDelayMs: 100,
        backoffMultiplier: 2,
      });

      await service.emit(makePayload());

      // Verify exponential delays: 100, 200, 400, 800, 1600
      const calls = delayFn.mock.calls.map((c) => c[0]);
      expect(calls).toEqual([100, 200, 400, 800, 1600]);
    });

    it('should support custom initial delay and multiplier', async () => {
      const publishFn = vi.fn().mockRejectedValue(new Error('fail'));
      const delayFn = vi.fn().mockResolvedValue(undefined);
      const service = createService({
        publishFn,
        delayFn,
        maxRetries: 3,
        initialDelayMs: 50,
        backoffMultiplier: 3,
      });

      await service.emit(makePayload());

      const calls = delayFn.mock.calls.map((c) => c[0]);
      // 50, 150, 450
      expect(calls).toEqual([50, 150, 450]);
    });
  });

  describe('disk persistence', () => {
    it('should persist buffer to disk when buffer is full', async () => {
      const publishFn = vi.fn().mockRejectedValue(new Error('fail'));
      const persistFn = vi.fn().mockResolvedValue(undefined);
      const service = createService({
        publishFn,
        persistFn,
        maxBufferSize: 1, // Very small buffer
      });

      const result = await service.emit(makePayload());

      expect(result.persistedToDisk).toBe(true);
      expect(persistFn).toHaveBeenCalled();
      // Buffer should be cleared after disk persistence
      expect(service.getBufferSize()).toBe(0);
    });

    it('should not persist to disk when buffer is not full', async () => {
      const publishFn = vi.fn().mockRejectedValue(new Error('fail'));
      const persistFn = vi.fn().mockResolvedValue(undefined);
      const service = createService({
        publishFn,
        persistFn,
        maxBufferSize: 100, // Large buffer
      });

      const result = await service.emit(makePayload());

      expect(result.persistedToDisk).toBe(false);
      expect(persistFn).not.toHaveBeenCalled();
    });
  });
});
