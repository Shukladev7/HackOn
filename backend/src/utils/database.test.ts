import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import mongoose from 'mongoose';

// Mock mongoose before importing the module under test
vi.mock('mongoose', () => {
  const mockConnection = {
    readyState: 0,
    host: null,
  };

  return {
    default: {
      connect: vi.fn(),
      disconnect: vi.fn(),
      connection: mockConnection,
    },
    __esModule: true,
  };
});

// Mock config
vi.mock('../config', () => ({
  config: {
    mongodbUri: 'mongodb://localhost:27017/test-db',
    retryMaxAttempts: 3,
    retryInitialDelayMs: 1000,
  },
}));

import { connectToDatabase, disconnectDatabase, getDatabaseHealth } from './database';

describe('Database Connection Manager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('connectToDatabase', () => {
    it('should connect successfully on first attempt', async () => {
      vi.mocked(mongoose.connect).mockResolvedValueOnce(mongoose as any);

      const result = await connectToDatabase();

      expect(mongoose.connect).toHaveBeenCalledTimes(1);
      expect(mongoose.connect).toHaveBeenCalledWith(
        'mongodb://localhost:27017/test-db',
        expect.objectContaining({
          maxPoolSize: 10,
          minPoolSize: 2,
          serverSelectionTimeoutMS: 5000,
        })
      );
      expect(result).toBe(mongoose);
    });

    it('should retry on failure with exponential backoff', async () => {
      vi.mocked(mongoose.connect)
        .mockRejectedValueOnce(new Error('Connection refused'))
        .mockResolvedValueOnce(mongoose as any);

      const connectPromise = connectToDatabase();

      // Advance past the first backoff (1000ms)
      await vi.advanceTimersByTimeAsync(1000);

      const result = await connectPromise;

      expect(mongoose.connect).toHaveBeenCalledTimes(2);
      expect(result).toBe(mongoose);
    });

    it('should retry with doubling backoff on second failure', async () => {
      vi.mocked(mongoose.connect)
        .mockRejectedValueOnce(new Error('Connection refused'))
        .mockRejectedValueOnce(new Error('Timeout'))
        .mockResolvedValueOnce(mongoose as any);

      const connectPromise = connectToDatabase();

      // First backoff: 1000ms
      await vi.advanceTimersByTimeAsync(1000);
      // Second backoff: 2000ms
      await vi.advanceTimersByTimeAsync(2000);

      const result = await connectPromise;

      expect(mongoose.connect).toHaveBeenCalledTimes(3);
      expect(result).toBe(mongoose);
    });

    it('should throw after max attempts exhausted', async () => {
      vi.mocked(mongoose.connect)
        .mockRejectedValueOnce(new Error('Fail 1'))
        .mockRejectedValueOnce(new Error('Fail 2'))
        .mockRejectedValueOnce(new Error('Fail 3'));

      const connectPromise = connectToDatabase();

      // Catch the promise early to prevent unhandled rejection warning
      const caughtPromise = connectPromise.catch((e) => e);

      // First backoff: 1000ms
      await vi.advanceTimersByTimeAsync(1000);
      // Second backoff: 2000ms
      await vi.advanceTimersByTimeAsync(2000);

      const error = await caughtPromise;
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe(
        'Database connection failed after 3 attempts: Fail 3'
      );
      expect(mongoose.connect).toHaveBeenCalledTimes(3);
    });

    it('should use connection pooling options', async () => {
      vi.mocked(mongoose.connect).mockResolvedValueOnce(mongoose as any);

      await connectToDatabase();

      expect(mongoose.connect).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          maxPoolSize: 10,
          minPoolSize: 2,
          socketTimeoutMS: 45000,
          connectTimeoutMS: 10000,
        })
      );
    });
  });

  describe('disconnectDatabase', () => {
    it('should disconnect successfully', async () => {
      vi.mocked(mongoose.disconnect).mockResolvedValueOnce(undefined as any);

      await disconnectDatabase();

      expect(mongoose.disconnect).toHaveBeenCalledTimes(1);
    });

    it('should throw when disconnect fails', async () => {
      vi.mocked(mongoose.disconnect).mockRejectedValueOnce(
        new Error('Disconnect error')
      );

      await expect(disconnectDatabase()).rejects.toThrow('Disconnect error');
    });
  });

  describe('getDatabaseHealth', () => {
    it('should return disconnected status when readyState is 0', () => {
      (mongoose.connection as any).readyState = 0;
      (mongoose.connection as any).host = null;

      const health = getDatabaseHealth();

      expect(health.status).toBe('disconnected');
      expect(health.readyState).toBe(0);
      expect(health.host).toBeNull();
    });

    it('should return connected status when readyState is 1', () => {
      (mongoose.connection as any).readyState = 1;
      (mongoose.connection as any).host = 'localhost';

      const health = getDatabaseHealth();

      expect(health.status).toBe('connected');
      expect(health.readyState).toBe(1);
      expect(health.host).toBe('localhost');
    });

    it('should return connecting status when readyState is 2', () => {
      (mongoose.connection as any).readyState = 2;

      const health = getDatabaseHealth();

      expect(health.status).toBe('connecting');
      expect(health.readyState).toBe(2);
    });

    it('should return disconnected status when disconnecting (readyState 3)', () => {
      (mongoose.connection as any).readyState = 3;

      const health = getDatabaseHealth();

      expect(health.status).toBe('disconnected');
      expect(health.readyState).toBe(3);
    });
  });
});
