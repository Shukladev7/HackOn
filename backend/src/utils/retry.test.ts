/**
 * Tests for downstream retry with exponential backoff and circuit breaker.
 * Validates Requirement 11.4: retry with 1s, 2s, 4s delays, 3 attempts max,
 * route to warehouse return when retries exhausted, and circuit breaker integration.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  withRetry,
  CircuitBreaker,
  CircuitState,
  CircuitBreakerError,
  withResilientCall,
  type RetryOptions,
  type DelayFn,
} from './retry';

// ─── Helper: Fake delay that records delay durations ─────────────────────────

function createFakeDelay(): { delayFn: DelayFn; delays: number[] } {
  const delays: number[] = [];
  const delayFn: DelayFn = async (ms: number) => {
    delays.push(ms);
  };
  return { delayFn, delays };
}

// ─── withRetry Tests ─────────────────────────────────────────────────────────

describe('withRetry', () => {
  it('should return success on first attempt when function succeeds', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const { delayFn } = createFakeDelay();

    const result = await withRetry(fn, undefined, delayFn);

    expect(result.success).toBe(true);
    expect(result.data).toBe('ok');
    expect(result.attempts).toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry on failure and succeed on second attempt', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValue('ok');
    const { delayFn, delays } = createFakeDelay();

    const result = await withRetry(fn, undefined, delayFn);

    expect(result.success).toBe(true);
    expect(result.data).toBe('ok');
    expect(result.attempts).toBe(2);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(delays).toEqual([1000]); // 1s delay after first failure
  });

  it('should use exponential backoff delays: 1s, 2s, 4s', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always fails'));
    const { delayFn, delays } = createFakeDelay();

    const result = await withRetry(fn, { maxAttempts: 3 }, delayFn);

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(3);
    expect(fn).toHaveBeenCalledTimes(3);
    // Delays between attempts: 1s after attempt 1, 2s after attempt 2
    // No delay after the last (3rd) attempt since it's the final one
    expect(delays).toEqual([1000, 2000]);
  });

  it('should respect maxAttempts configuration', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fail'));
    const { delayFn } = createFakeDelay();

    const result = await withRetry(fn, { maxAttempts: 2 }, delayFn);

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(2);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should call onRetriesExhausted when all retries fail', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('service down'));
    const onRetriesExhausted = vi.fn();
    const { delayFn } = createFakeDelay();

    const result = await withRetry(fn, { maxAttempts: 3, onRetriesExhausted }, delayFn);

    expect(result.success).toBe(false);
    expect(result.error?.message).toBe('service down');
    expect(onRetriesExhausted).toHaveBeenCalledTimes(1);
    expect(onRetriesExhausted).toHaveBeenCalledWith(expect.any(Error));
  });

  it('should handle non-Error throws gracefully', async () => {
    const fn = vi.fn().mockRejectedValue('string error');
    const { delayFn } = createFakeDelay();

    const result = await withRetry(fn, { maxAttempts: 1 }, delayFn);

    expect(result.success).toBe(false);
    expect(result.error?.message).toBe('string error');
  });

  it('should timeout individual calls exceeding timeoutMs', async () => {
    const fn = vi.fn(() => new Promise((resolve) => setTimeout(resolve, 10000)));
    const { delayFn } = createFakeDelay();

    const result = await withRetry(fn, { maxAttempts: 1, timeoutMs: 50 }, delayFn);

    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('timed out');
  });

  it('should use custom initialDelayMs and backoffMultiplier', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fail'));
    const { delayFn, delays } = createFakeDelay();

    await withRetry(
      fn,
      { maxAttempts: 4, initialDelayMs: 500, backoffMultiplier: 3 },
      delayFn
    );

    // Delays: 500, 1500, 4500
    expect(delays).toEqual([500, 1500, 4500]);
  });

  it('should succeed on third attempt with correct delay pattern', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValue('success');
    const { delayFn, delays } = createFakeDelay();

    const result = await withRetry(fn, { maxAttempts: 3 }, delayFn);

    expect(result.success).toBe(true);
    expect(result.data).toBe('success');
    expect(result.attempts).toBe(3);
    expect(delays).toEqual([1000, 2000]); // 1s + 2s = 3s total delay
  });
});

// ─── CircuitBreaker Tests ────────────────────────────────────────────────────

describe('CircuitBreaker', () => {
  let cb: CircuitBreaker;
  let currentTime: number;

  beforeEach(() => {
    currentTime = 1000000;
    cb = new CircuitBreaker('test-service', {
      failureThreshold: 3,
      cooldownMs: 30000,
      successThreshold: 1,
    }, () => currentTime);
  });

  it('should start in CLOSED state', () => {
    expect(cb.getState()).toBe(CircuitState.CLOSED);
  });

  it('should stay CLOSED when calls succeed', async () => {
    const fn = vi.fn().mockResolvedValue('ok');

    await cb.execute(fn);
    await cb.execute(fn);

    expect(cb.getState()).toBe(CircuitState.CLOSED);
    expect(cb.getFailureCount()).toBe(0);
  });

  it('should trip to OPEN after reaching failure threshold', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fail'));

    for (let i = 0; i < 3; i++) {
      try { await cb.execute(fn); } catch {}
    }

    expect(cb.getState()).toBe(CircuitState.OPEN);
    expect(cb.getFailureCount()).toBe(3);
  });

  it('should reject calls immediately when OPEN', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fail'));

    // Trip the circuit
    for (let i = 0; i < 3; i++) {
      try { await cb.execute(fn); } catch {}
    }

    // Next call should be rejected without executing fn
    const successFn = vi.fn().mockResolvedValue('should not run');
    await expect(cb.execute(successFn)).rejects.toThrow(CircuitBreakerError);
    expect(successFn).not.toHaveBeenCalled();
  });

  it('should transition to HALF_OPEN after cooldown period', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fail'));

    // Trip the circuit
    for (let i = 0; i < 3; i++) {
      try { await cb.execute(fn); } catch {}
    }

    expect(cb.getState()).toBe(CircuitState.OPEN);

    // Advance time past cooldown
    currentTime += 30001;

    expect(cb.getState()).toBe(CircuitState.HALF_OPEN);
  });

  it('should close circuit after successful probe in HALF_OPEN', async () => {
    const failFn = vi.fn().mockRejectedValue(new Error('fail'));
    const successFn = vi.fn().mockResolvedValue('recovered');

    // Trip the circuit
    for (let i = 0; i < 3; i++) {
      try { await cb.execute(failFn); } catch {}
    }

    // Advance past cooldown
    currentTime += 30001;
    expect(cb.getState()).toBe(CircuitState.HALF_OPEN);

    // Successful probe
    const result = await cb.execute(successFn);
    expect(result).toBe('recovered');
    expect(cb.getState()).toBe(CircuitState.CLOSED);
    expect(cb.getFailureCount()).toBe(0);
  });

  it('should reopen circuit on failed probe in HALF_OPEN', async () => {
    const failFn = vi.fn().mockRejectedValue(new Error('fail'));

    // Trip the circuit
    for (let i = 0; i < 3; i++) {
      try { await cb.execute(failFn); } catch {}
    }

    // Advance past cooldown
    currentTime += 30001;
    expect(cb.getState()).toBe(CircuitState.HALF_OPEN);

    // Failed probe
    try { await cb.execute(failFn); } catch {}

    expect(cb.getState()).toBe(CircuitState.OPEN);
  });

  it('should reset failure count on success in CLOSED state', async () => {
    const failFn = vi.fn().mockRejectedValue(new Error('fail'));
    const successFn = vi.fn().mockResolvedValue('ok');

    // Accumulate 2 failures (below threshold of 3)
    try { await cb.execute(failFn); } catch {}
    try { await cb.execute(failFn); } catch {}
    expect(cb.getFailureCount()).toBe(2);

    // One success resets failure count
    await cb.execute(successFn);
    expect(cb.getFailureCount()).toBe(0);
    expect(cb.getState()).toBe(CircuitState.CLOSED);
  });

  it('should expose service name', () => {
    expect(cb.getServiceName()).toBe('test-service');
  });

  it('should allow manual reset', async () => {
    const failFn = vi.fn().mockRejectedValue(new Error('fail'));

    // Trip the circuit
    for (let i = 0; i < 3; i++) {
      try { await cb.execute(failFn); } catch {}
    }
    expect(cb.getState()).toBe(CircuitState.OPEN);

    cb.reset();
    expect(cb.getState()).toBe(CircuitState.CLOSED);
    expect(cb.getFailureCount()).toBe(0);
  });
});

// ─── withResilientCall (Combined) Tests ──────────────────────────────────────

describe('withResilientCall', () => {
  it('should retry with circuit breaker integration', async () => {
    let callCount = 0;
    const fn = vi.fn(async () => {
      callCount++;
      if (callCount < 3) throw new Error('fail');
      return 'success';
    });
    const { delayFn } = createFakeDelay();
    const cb = new CircuitBreaker('combined-service', { failureThreshold: 5 });

    const result = await withResilientCall(fn, { circuitBreaker: cb, maxAttempts: 3 }, delayFn);

    expect(result.success).toBe(true);
    expect(result.data).toBe('success');
  });

  it('should fail fast when circuit breaker is OPEN', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const { delayFn } = createFakeDelay();
    let currentTime = 0;
    const cb = new CircuitBreaker('fast-fail-service', { failureThreshold: 1 }, () => currentTime);

    // Trip the circuit
    const failFn = vi.fn().mockRejectedValue(new Error('fail'));
    try { await cb.execute(failFn); } catch {}

    const result = await withResilientCall(fn, { circuitBreaker: cb }, delayFn);

    expect(result.success).toBe(false);
    expect(result.error).toBeInstanceOf(CircuitBreakerError);
    expect(result.attempts).toBe(0);
    expect(fn).not.toHaveBeenCalled();
  });

  it('should trip circuit breaker when retries are exhausted', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('downstream fail'));
    const { delayFn } = createFakeDelay();
    const cb = new CircuitBreaker('exhaust-service', { failureThreshold: 3 });

    const result = await withResilientCall(fn, { circuitBreaker: cb, maxAttempts: 3 }, delayFn);

    expect(result.success).toBe(false);
    expect(cb.getState()).toBe(CircuitState.OPEN);
  });

  it('should work without a circuit breaker (pure retry)', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValue('ok');
    const { delayFn } = createFakeDelay();

    const result = await withResilientCall(fn, { maxAttempts: 3 }, delayFn);

    expect(result.success).toBe(true);
    expect(result.data).toBe('ok');
  });

  it('should route to warehouse return path when retries exhausted (via onRetriesExhausted)', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('service down'));
    const warehouseReturnTriggered = vi.fn();
    const { delayFn } = createFakeDelay();

    const result = await withResilientCall(
      fn,
      { maxAttempts: 3, onRetriesExhausted: warehouseReturnTriggered },
      delayFn
    );

    expect(result.success).toBe(false);
    expect(warehouseReturnTriggered).toHaveBeenCalledTimes(1);
  });
});
