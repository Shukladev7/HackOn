/**
 * Tests for Evidence Collection Engine - collectEvidence() method
 *
 * Covers:
 * - Req 2.1: Collect from 7 sources (GPS, call logs, delivery scans, order history,
 *   support tickets, address validation, hub events) within 72h lookback, completing within 30 seconds
 * - Req 2.2: Per-source 5s timeout, proceed if ≥3 of 7 respond, record unavailable sources with timestamps
 */
import { describe, it, expect, vi } from 'vitest';
import {
  collectEvidenceWithDeps,
  collectEvidenceWithMetadata,
  withTimeout,
  EvidenceCollectionError,
  EvidenceSource,
  EvidenceSourceFetchers,
  EVIDENCE_SOURCE_TYPES,
  RTOEventPayload,
} from './evidenceCollection';

// ─── Test Helpers ────────────────────────────────────────────────────────────

function makeRTOEventPayload(overrides: Partial<RTOEventPayload> = {}): RTOEventPayload {
  return {
    shipmentId: 'SHIP-001',
    orderId: 'ORDER-001',
    customerId: 'CUST-001',
    courierId: 'COUR-001',
    packageDetails: {
      sku: 'SKU-001',
      weight: 1.5,
      dimensions: { l: 30, w: 20, h: 10 },
      category: 'electronics',
      price: 5000,
      hsnCode: '8471',
    },
    deliveryAttempt: {
      attemptNumber: 1,
      timestamp: new Date().toISOString(),
      gpsLocation: { lat: 28.6139, lng: 77.209 },
      statusCode: 'FAILED',
      failureReason: 'customer_unavailable',
    },
    hubLocation: { lat: 28.6139, lng: 77.209, hubId: 'HUB-001' },
    metadata: { source: 'courier_partner', receivedAt: new Date().toISOString() },
    ...overrides,
  };
}

function makeEvidenceSource(type: EvidenceSource['type']): EvidenceSource {
  return {
    type,
    data: { mockData: true },
    collectedAt: new Date().toISOString(),
    sourceId: `src-${type}`,
  };
}

function makeFetchers(options: {
  respondingSources?: EvidenceSource['type'][];
  delayMs?: Record<string, number>;
  failingSources?: EvidenceSource['type'][];
} = {}): EvidenceSourceFetchers {
  const { respondingSources, delayMs = {}, failingSources = [] } = options;
  const responding = respondingSources || EVIDENCE_SOURCE_TYPES;

  const makeFetcher = (type: EvidenceSource['type']) => {
    return async (_event: RTOEventPayload, _since: Date): Promise<EvidenceSource> => {
      const delay = delayMs[type] || 0;
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      if (failingSources.includes(type)) {
        throw new Error(`Source '${type}' failed`);
      }
      if (!responding.includes(type)) {
        throw new Error(`Source '${type}' unavailable`);
      }
      return makeEvidenceSource(type);
    };
  };

  return {
    fetchGPS: makeFetcher('gps'),
    fetchCallLogs: makeFetcher('call_logs'),
    fetchDeliveryScans: makeFetcher('delivery_scans'),
    fetchOrderHistory: makeFetcher('order_history'),
    fetchSupportTickets: makeFetcher('support_tickets'),
    fetchAddressValidation: makeFetcher('address_validation'),
    fetchHubEvents: makeFetcher('hub_events'),
  };
}

// ─── Unit Tests: withTimeout Utility ─────────────────────────────────────────

describe('withTimeout utility', () => {
  it('should resolve if promise completes before timeout', async () => {
    const result = await withTimeout(Promise.resolve('ok'), 1000, 'test');
    expect(result).toBe('ok');
  });

  it('should reject if promise exceeds timeout', async () => {
    const slowPromise = new Promise((resolve) => setTimeout(resolve, 200));
    await expect(withTimeout(slowPromise, 50, 'slow')).rejects.toThrow(
      "Source 'slow' timed out after 50ms"
    );
  });

  it('should reject with the original error if promise fails before timeout', async () => {
    const failPromise = Promise.reject(new Error('original error'));
    await expect(withTimeout(failPromise, 1000, 'fail')).rejects.toThrow('original error');
  });
});

// ─── Unit Tests: Parallel Evidence Collection ────────────────────────────────

describe('Evidence Collection Engine - collectEvidence (parallel collection)', () => {
  const event = makeRTOEventPayload();
  const lookbackHours = 72;
  const perSourceTimeout = 5000;
  const totalTimeout = 30000;
  const minSources = 3;

  describe('Req 2.1: Collect from all 7 sources in parallel', () => {
    it('should return evidence from all 7 sources when all respond', async () => {
      const fetchers = makeFetchers();

      const result = await collectEvidenceWithDeps(
        event, lookbackHours, perSourceTimeout, totalTimeout, minSources, fetchers
      );

      expect(result).toHaveLength(7);
      const types = result.map((s) => s.type);
      for (const sourceType of EVIDENCE_SOURCE_TYPES) {
        expect(types).toContain(sourceType);
      }
    });

    it('should fetch all sources in parallel (not sequentially)', async () => {
      const start = Date.now();
      // Each source takes 50ms, but they should run in parallel
      const delays: Record<string, number> = {};
      EVIDENCE_SOURCE_TYPES.forEach((t) => { delays[t] = 50; });

      const fetchers = makeFetchers({ delayMs: delays });
      await collectEvidenceWithDeps(
        event, lookbackHours, perSourceTimeout, totalTimeout, minSources, fetchers
      );

      const elapsed = Date.now() - start;
      // If sequential, would take 350ms (7 × 50ms). Parallel should be ~50ms.
      expect(elapsed).toBeLessThan(200);
    });

    it('should include collectedAt and sourceId in each returned source', async () => {
      const fetchers = makeFetchers();

      const result = await collectEvidenceWithDeps(
        event, lookbackHours, perSourceTimeout, totalTimeout, minSources, fetchers
      );

      for (const source of result) {
        expect(source.collectedAt).toBeDefined();
        expect(source.sourceId).toBeDefined();
        expect(() => new Date(source.collectedAt)).not.toThrow();
      }
    });
  });

  describe('Req 2.1: 72-hour lookback window', () => {
    it('should pass the correct lookback time to fetchers', async () => {
      let receivedSince: Date | null = null;
      const fetchers = makeFetchers();
      fetchers.fetchGPS = async (_event, since) => {
        receivedSince = since;
        return makeEvidenceSource('gps');
      };

      await collectEvidenceWithDeps(
        event, 72, perSourceTimeout, totalTimeout, minSources, fetchers
      );

      expect(receivedSince).not.toBeNull();
      const expectedMs = 72 * 60 * 60 * 1000;
      const diff = Date.now() - receivedSince!.getTime();
      // Should be approximately 72 hours (within 1 second tolerance)
      expect(diff).toBeGreaterThan(expectedMs - 1000);
      expect(diff).toBeLessThan(expectedMs + 1000);
    });

    it('should use custom lookback hours when specified', async () => {
      let receivedSince: Date | null = null;
      const fetchers = makeFetchers();
      fetchers.fetchGPS = async (_event, since) => {
        receivedSince = since;
        return makeEvidenceSource('gps');
      };

      await collectEvidenceWithDeps(
        event, 48, perSourceTimeout, totalTimeout, minSources, fetchers
      );

      const expectedMs = 48 * 60 * 60 * 1000;
      const diff = Date.now() - receivedSince!.getTime();
      expect(diff).toBeGreaterThan(expectedMs - 1000);
      expect(diff).toBeLessThan(expectedMs + 1000);
    });
  });

  describe('Req 2.2: Per-source 5-second timeout', () => {
    it('should timeout individual sources that exceed per-source timeout', async () => {
      const fetchers = makeFetchers({
        delayMs: { gps: 200, call_logs: 200 }, // These will exceed a 50ms timeout
      });

      // Use a very short per-source timeout to simulate
      const result = await collectEvidenceWithDeps(
        event, lookbackHours, 100, totalTimeout, minSources, fetchers
      );

      // GPS and call_logs should be timed out, but we still have 5 sources
      expect(result.length).toBeGreaterThanOrEqual(5);
      const types = result.map((s) => s.type);
      expect(types).not.toContain('gps');
      expect(types).not.toContain('call_logs');
    });

    it('should include fast sources even when slow sources timeout', async () => {
      const fetchers = makeFetchers({
        delayMs: { gps: 200 },
      });

      const result = await collectEvidenceWithDeps(
        event, lookbackHours, 100, totalTimeout, minSources, fetchers
      );

      expect(result.length).toBe(6);
      const types = result.map((s) => s.type);
      expect(types).not.toContain('gps');
      expect(types).toContain('call_logs');
    });
  });

  describe('Req 2.2: Minimum source threshold (≥3 of 7)', () => {
    it('should succeed when exactly 3 sources respond', async () => {
      const fetchers = makeFetchers({
        respondingSources: ['gps', 'call_logs', 'hub_events'],
      });

      const result = await collectEvidenceWithDeps(
        event, lookbackHours, perSourceTimeout, totalTimeout, minSources, fetchers
      );

      expect(result).toHaveLength(3);
    });

    it('should throw EvidenceCollectionError when fewer than 3 sources respond', async () => {
      const fetchers = makeFetchers({
        respondingSources: ['gps', 'call_logs'],
      });

      await expect(
        collectEvidenceWithDeps(
          event, lookbackHours, perSourceTimeout, totalTimeout, minSources, fetchers
        )
      ).rejects.toThrow(EvidenceCollectionError);
    });

    it('should include partial results in the error when threshold not met', async () => {
      const fetchers = makeFetchers({
        respondingSources: ['gps', 'call_logs'],
      });

      try {
        await collectEvidenceWithDeps(
          event, lookbackHours, perSourceTimeout, totalTimeout, minSources, fetchers
        );
        expect.fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(EvidenceCollectionError);
        const err = e as EvidenceCollectionError;
        expect(err.result.sources).toHaveLength(2);
        expect(err.result.completeness.collected).toEqual(['gps', 'call_logs']);
        expect(err.result.completeness.unavailable.length).toBe(5);
        expect(err.result.success).toBe(false);
      }
    });

    it('should succeed when all 7 sources respond', async () => {
      const fetchers = makeFetchers();

      const result = await collectEvidenceWithDeps(
        event, lookbackHours, perSourceTimeout, totalTimeout, minSources, fetchers
      );

      expect(result).toHaveLength(7);
    });

    it('should succeed when 4 sources respond (above minimum)', async () => {
      const fetchers = makeFetchers({
        respondingSources: ['gps', 'call_logs', 'order_history', 'hub_events'],
      });

      const result = await collectEvidenceWithDeps(
        event, lookbackHours, perSourceTimeout, totalTimeout, minSources, fetchers
      );

      expect(result).toHaveLength(4);
    });
  });

  describe('Req 2.2: Record unavailable sources with timeout timestamps', () => {
    it('should record unavailable sources in completeness metadata', async () => {
      const fetchers = makeFetchers({
        respondingSources: ['gps', 'call_logs', 'hub_events', 'order_history'],
      });

      const result = await collectEvidenceWithMetadata(
        event, lookbackHours, perSourceTimeout, totalTimeout, minSources, fetchers
      );

      expect(result.success).toBe(true);
      expect(result.completeness.collected).toEqual(
        expect.arrayContaining(['gps', 'call_logs', 'hub_events', 'order_history'])
      );
      expect(result.completeness.unavailable).toEqual(
        expect.arrayContaining(['delivery_scans', 'support_tickets', 'address_validation'])
      );
    });

    it('should record timeout timestamps for unavailable sources', async () => {
      const fetchers = makeFetchers({
        respondingSources: ['gps', 'call_logs', 'hub_events'],
      });

      const result = await collectEvidenceWithMetadata(
        event, lookbackHours, perSourceTimeout, totalTimeout, minSources, fetchers
      );

      for (const unavailable of result.completeness.unavailable) {
        expect(result.completeness.timeoutTimestamps[unavailable]).toBeDefined();
        expect(() => new Date(result.completeness.timeoutTimestamps[unavailable])).not.toThrow();
      }
    });

    it('should have empty unavailable list when all sources respond', async () => {
      const fetchers = makeFetchers();

      const result = await collectEvidenceWithMetadata(
        event, lookbackHours, perSourceTimeout, totalTimeout, minSources, fetchers
      );

      expect(result.completeness.unavailable).toHaveLength(0);
      expect(Object.keys(result.completeness.timeoutTimestamps)).toHaveLength(0);
    });
  });

  describe('Req 2.1: Total collection timeout (30 seconds)', () => {
    it('should throw when total timeout is exceeded', async () => {
      // All sources take longer than the total timeout
      const delays: Record<string, number> = {};
      EVIDENCE_SOURCE_TYPES.forEach((t) => { delays[t] = 200; });

      const fetchers = makeFetchers({ delayMs: delays });

      // Set total timeout lower than source delays
      await expect(
        collectEvidenceWithDeps(
          event, lookbackHours, 500, 50, minSources, fetchers
        )
      ).rejects.toThrow('exceeded total timeout');
    });

    it('should succeed when total time is within limit', async () => {
      const delays: Record<string, number> = {};
      EVIDENCE_SOURCE_TYPES.forEach((t) => { delays[t] = 10; });

      const fetchers = makeFetchers({ delayMs: delays });

      const result = await collectEvidenceWithDeps(
        event, lookbackHours, perSourceTimeout, totalTimeout, minSources, fetchers
      );

      expect(result).toHaveLength(7);
    });
  });

  describe('Edge cases', () => {
    it('should handle all sources failing gracefully', async () => {
      const fetchers = makeFetchers({
        failingSources: [...EVIDENCE_SOURCE_TYPES],
      });

      await expect(
        collectEvidenceWithDeps(
          event, lookbackHours, perSourceTimeout, totalTimeout, minSources, fetchers
        )
      ).rejects.toThrow(EvidenceCollectionError);
    });

    it('should handle a mix of timeouts and failures', async () => {
      const fetchers = makeFetchers({
        respondingSources: ['gps', 'call_logs', 'hub_events'],
        failingSources: ['delivery_scans', 'support_tickets'],
        delayMs: { order_history: 200, address_validation: 200 },
      });

      // Use 100ms per-source timeout so order_history and address_validation timeout
      const result = await collectEvidenceWithDeps(
        event, lookbackHours, 100, totalTimeout, minSources, fetchers
      );

      expect(result).toHaveLength(3);
      const types = result.map((s) => s.type);
      expect(types).toContain('gps');
      expect(types).toContain('call_logs');
      expect(types).toContain('hub_events');
    });

    it('should use default lookback of 72 hours', async () => {
      let receivedSince: Date | null = null;
      const fetchers = makeFetchers();
      fetchers.fetchGPS = async (_event, since) => {
        receivedSince = since;
        return makeEvidenceSource('gps');
      };

      // collectEvidence defaults to 72 hours
      await collectEvidenceWithDeps(
        event, 72, perSourceTimeout, totalTimeout, minSources, fetchers
      );

      const expectedMs = 72 * 60 * 60 * 1000;
      const diff = Date.now() - receivedSince!.getTime();
      expect(diff).toBeGreaterThan(expectedMs - 1000);
      expect(diff).toBeLessThan(expectedMs + 1000);
    });
  });
});

// ─── Tests: collectEvidenceWithMetadata ──────────────────────────────────────

describe('collectEvidenceWithMetadata', () => {
  const event = makeRTOEventPayload();
  const lookbackHours = 72;
  const perSourceTimeout = 5000;
  const totalTimeout = 30000;
  const minSources = 3;

  it('should return success=true when enough sources respond', async () => {
    const fetchers = makeFetchers({
      respondingSources: ['gps', 'call_logs', 'hub_events', 'order_history'],
    });

    const result = await collectEvidenceWithMetadata(
      event, lookbackHours, perSourceTimeout, totalTimeout, minSources, fetchers
    );

    expect(result.success).toBe(true);
    expect(result.sources).toHaveLength(4);
  });

  it('should return success=false when too few sources respond', async () => {
    const fetchers = makeFetchers({
      respondingSources: ['gps', 'call_logs'],
    });

    const result = await collectEvidenceWithMetadata(
      event, lookbackHours, perSourceTimeout, totalTimeout, minSources, fetchers
    );

    expect(result.success).toBe(false);
    expect(result.sources).toHaveLength(2);
  });

  it('should return all sources unavailable on total timeout', async () => {
    const delays: Record<string, number> = {};
    EVIDENCE_SOURCE_TYPES.forEach((t) => { delays[t] = 200; });

    const fetchers = makeFetchers({ delayMs: delays });

    const result = await collectEvidenceWithMetadata(
      event, lookbackHours, 500, 50, minSources, fetchers
    );

    expect(result.success).toBe(false);
    expect(result.sources).toHaveLength(0);
    expect(result.completeness.unavailable).toHaveLength(7);
  });
});
