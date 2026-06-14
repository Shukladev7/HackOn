/**
 * Downstream retry with exponential backoff and circuit breaker pattern.
 *
 * Requirement 11.4: If any downstream service fails to respond within 5 seconds,
 * retry with exponential backoff starting at 1 second, doubling per attempt,
 * up to 3 attempts (max total wait 7 seconds), before routing to warehouse return.
 */

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxAttempts?: number;
  /** Initial delay in milliseconds (default: 1000ms = 1s) */
  initialDelayMs?: number;
  /** Multiplier for exponential backoff (default: 2) */
  backoffMultiplier?: number;
  /** Timeout per individual call in milliseconds (default: 5000ms = 5s) */
  timeoutMs?: number;
  /** Optional callback when retries are exhausted */
  onRetriesExhausted?: (error: Error) => void;
}

export interface RetryResult<T> {
  success: boolean;
  data?: T;
  error?: Error;
  attempts: number;
  totalTimeMs: number;
}

const DEFAULT_RETRY_OPTIONS: Required<Omit<RetryOptions, 'onRetriesExhausted'>> = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  backoffMultiplier: 2,
  timeoutMs: 5000,
};

/**
 * Delays execution for specified milliseconds.
 * Extracted as a function so tests can override via dependency injection.
 */
export type DelayFn = (ms: number) => Promise<void>;

export const defaultDelay: DelayFn = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wraps an async function with retry logic using exponential backoff.
 *
 * Retry schedule: 1s, 2s, 4s (3 attempts total, max 7s cumulative delay)
 *
 * @param fn - The async function to retry
 * @param options - Retry configuration options
 * @param delayFn - Delay function (injectable for testing)
 * @returns RetryResult with success/failure and metadata
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions,
  delayFn: DelayFn = defaultDelay
): Promise<RetryResult<T>> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  const startTime = Date.now();
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      const result = await withTimeout(fn(), opts.timeoutMs);
      return {
        success: true,
        data: result,
        attempts: attempt,
        totalTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // If this is not the last attempt, wait with exponential backoff
      if (attempt < opts.maxAttempts) {
        const delay = opts.initialDelayMs * Math.pow(opts.backoffMultiplier, attempt - 1);
        await delayFn(delay);
      }
    }
  }

  // All retries exhausted
  if (options?.onRetriesExhausted && lastError) {
    options.onRetriesExhausted(lastError);
  }

  return {
    success: false,
    error: lastError,
    attempts: opts.maxAttempts,
    totalTimeMs: Date.now() - startTime,
  };
}

/**
 * Wraps a promise with a timeout. Rejects if the promise doesn't resolve
 * within the specified time.
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

// ─── Circuit Breaker ─────────────────────────────────────────────────────────

export enum CircuitState {
  CLOSED = 'CLOSED',       // Normal operation, requests pass through
  OPEN = 'OPEN',           // Failures exceeded threshold, requests rejected
  HALF_OPEN = 'HALF_OPEN', // Testing if service recovered
}

export interface CircuitBreakerOptions {
  /** Number of consecutive failures before opening the circuit (default: 3) */
  failureThreshold?: number;
  /** Time in ms to wait before transitioning from OPEN to HALF_OPEN (default: 30000ms) */
  cooldownMs?: number;
  /** Number of successful calls in HALF_OPEN state to close the circuit (default: 1) */
  successThreshold?: number;
}

export class CircuitBreakerError extends Error {
  constructor(serviceName: string) {
    super(`Circuit breaker is OPEN for service: ${serviceName}`);
    this.name = 'CircuitBreakerError';
  }
}

/**
 * Circuit Breaker pattern implementation for inter-service calls.
 *
 * Tracks failures per service. When consecutive failures reach the threshold,
 * the circuit trips OPEN and rejects all requests during a cooldown period.
 * After cooldown, it transitions to HALF_OPEN and allows a single probe request.
 * If the probe succeeds, the circuit closes; if it fails, it reopens.
 */
export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount: number = 0;
  private successCount: number = 0;
  private lastFailureTime: number = 0;
  private readonly options: Required<CircuitBreakerOptions>;
  private readonly serviceName: string;
  private nowFn: () => number;

  constructor(serviceName: string, options?: CircuitBreakerOptions, nowFn?: () => number) {
    this.serviceName = serviceName;
    this.options = {
      failureThreshold: options?.failureThreshold ?? 3,
      cooldownMs: options?.cooldownMs ?? 30000,
      successThreshold: options?.successThreshold ?? 1,
    };
    this.nowFn = nowFn ?? (() => Date.now());
  }

  getState(): CircuitState {
    // Check if cooldown has elapsed while OPEN
    if (this.state === CircuitState.OPEN) {
      const elapsed = this.nowFn() - this.lastFailureTime;
      if (elapsed >= this.options.cooldownMs) {
        this.state = CircuitState.HALF_OPEN;
        this.successCount = 0;
      }
    }
    return this.state;
  }

  getFailureCount(): number {
    return this.failureCount;
  }

  getServiceName(): string {
    return this.serviceName;
  }

  /**
   * Execute a function through the circuit breaker.
   * Rejects immediately if the circuit is OPEN.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const currentState = this.getState();

    if (currentState === CircuitState.OPEN) {
      throw new CircuitBreakerError(this.serviceName);
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;
      if (this.successCount >= this.options.successThreshold) {
        this.state = CircuitState.CLOSED;
        this.failureCount = 0;
        this.successCount = 0;
      }
    } else {
      // Reset failure count on success in CLOSED state
      this.failureCount = 0;
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = this.nowFn();

    if (this.state === CircuitState.HALF_OPEN) {
      // Probe failed, reopen circuit
      this.state = CircuitState.OPEN;
      this.successCount = 0;
    } else if (this.failureCount >= this.options.failureThreshold) {
      this.state = CircuitState.OPEN;
    }
  }

  /**
   * Manually reset the circuit breaker to CLOSED state.
   */
  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = 0;
  }
}

// ─── Combined Retry + Circuit Breaker ────────────────────────────────────────

export interface ResilientCallOptions extends RetryOptions {
  circuitBreaker?: CircuitBreaker;
}

/**
 * Combines retry with circuit breaker: retries first, then trips circuit
 * if retries are exhausted. Routes to warehouse return on complete failure.
 *
 * @param fn - The async function to call
 * @param options - Combined retry and circuit breaker options
 * @param delayFn - Delay function (injectable for testing)
 * @returns RetryResult with success/failure metadata
 */
export async function withResilientCall<T>(
  fn: () => Promise<T>,
  options?: ResilientCallOptions,
  delayFn: DelayFn = defaultDelay
): Promise<RetryResult<T>> {
  const { circuitBreaker, ...retryOptions } = options ?? {};

  // If circuit breaker is OPEN, fail fast
  if (circuitBreaker) {
    const state = circuitBreaker.getState();
    if (state === CircuitState.OPEN) {
      return {
        success: false,
        error: new CircuitBreakerError(circuitBreaker.getServiceName()),
        attempts: 0,
        totalTimeMs: 0,
      };
    }
  }

  // Execute with retry logic
  const result = await withRetry(
    async () => {
      if (circuitBreaker) {
        return circuitBreaker.execute(fn);
      }
      return fn();
    },
    retryOptions,
    delayFn
  );

  return result;
}
