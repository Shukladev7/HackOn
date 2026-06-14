import mongoose from 'mongoose';
import { config } from '../config';

/**
 * Database connection manager with retry logic and exponential backoff.
 * Implements Requirement 11.4: retry with exponential backoff starting at 1 second,
 * doubling per attempt, up to 3 attempts.
 */

export interface DatabaseHealth {
  status: 'connected' | 'disconnected' | 'connecting' | 'error';
  readyState: number;
  host: string | null;
  lastConnectedAt: string | null;
}

let lastConnectedAt: string | null = null;

/**
 * Delays execution for the specified number of milliseconds.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Connects to MongoDB with exponential backoff retry logic.
 *
 * Retry policy (Requirement 11.4):
 * - Max attempts: 3 (configurable via RETRY_MAX_ATTEMPTS)
 * - Initial delay: 1000ms (configurable via RETRY_INITIAL_DELAY_MS)
 * - Backoff: doubles per attempt (1s, 2s, 4s)
 *
 * @throws Error if all retry attempts are exhausted
 */
export async function connectToDatabase(): Promise<typeof mongoose> {
  const maxAttempts = config.retryMaxAttempts;
  const initialDelayMs = config.retryInitialDelayMs;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const connection = await mongoose.connect(config.mongodbUri, {
        maxPoolSize: 10,
        minPoolSize: 2,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
        connectTimeoutMS: 10000,
      });

      lastConnectedAt = new Date().toISOString();
      console.log(`[Database] Connected to MongoDB (attempt ${attempt}/${maxAttempts})`);
      return connection;
    } catch (error) {
      const isLastAttempt = attempt === maxAttempts;

      if (isLastAttempt) {
        console.error(
          `[Database] Failed to connect after ${maxAttempts} attempts:`,
          error instanceof Error ? error.message : error
        );
        throw new Error(
          `Database connection failed after ${maxAttempts} attempts: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`
        );
      }

      const backoffMs = initialDelayMs * Math.pow(2, attempt - 1);
      console.warn(
        `[Database] Connection attempt ${attempt}/${maxAttempts} failed. ` +
          `Retrying in ${backoffMs}ms...`,
        error instanceof Error ? error.message : error
      );
      await delay(backoffMs);
    }
  }

  // This should never be reached due to the throw above, but satisfies TypeScript
  throw new Error('Database connection failed: unexpected state');
}

/**
 * Gracefully disconnects from MongoDB.
 * Intended for use during application shutdown.
 */
export async function disconnectDatabase(): Promise<void> {
  try {
    await mongoose.disconnect();
    console.log('[Database] Disconnected from MongoDB');
  } catch (error) {
    console.error(
      '[Database] Error during disconnect:',
      error instanceof Error ? error.message : error
    );
    throw error;
  }
}

/**
 * Returns the current database connection health status.
 *
 * Ready states:
 * - 0: disconnected
 * - 1: connected
 * - 2: connecting
 * - 3: disconnecting
 */
export function getDatabaseHealth(): DatabaseHealth {
  const readyState = mongoose.connection.readyState;

  const statusMap: Record<number, DatabaseHealth['status']> = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnected',
  };

  return {
    status: statusMap[readyState] ?? 'error',
    readyState,
    host: mongoose.connection.host || null,
    lastConnectedAt,
  };
}
