/**
 * Tests for Evidence Normalization and Persistence
 *
 * Covers:
 * - Req 2.3: Normalize evidence into standardized schema with completeness metadata
 * - Req 2.4: Retain raw evidence for 90 days
 * - Req 2.5: Link each evidence record to originating RTO_Event ID
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  EvidenceCollectionEngine,
  normalizeEvidencePure,
  EvidenceSource,
  EligibilityResult,
  NormalizedEvidence,
  EVIDENCE_SOURCE_TYPES,
} from './evidenceCollection';

// ─── Test Helpers ────────────────────────────────────────────────────────────

function makeEligibilityResult(eligible: boolean = true): EligibilityResult {
  return {
    eligible,
    conditions: {
      unopened: { pass: eligible, evidenceIds: ['ev1'] },
      undamaged: { pass: eligible, evidenceIds: ['ev2'] },
      sealed: { pass: eligible, evidenceIds: ['ev3'] },
    },
    determinedAt: new Date().toISOString(),
  };
}

function makeEvidenceSource(type: EvidenceSource['type'], data: unknown = { test: true }): EvidenceSource {
  return {
    type,
    data,
    collectedAt: new Date().toISOString(),
    sourceId: `source-${type}-${Math.random().toString(36).slice(2)}`,
  };
}

// ─── Unit Tests: normalizeEvidence ───────────────────────────────────────────

describe('Evidence Collection Engine - normalizeEvidence', () => {
  const engine = new EvidenceCollectionEngine();

  describe('Req 2.3: Normalize evidence into standardized schema', () => {
    it('should produce a NormalizedEvidence with all required fields', () => {
      const sources: EvidenceSource[] = [
        makeEvidenceSource('gps'),
        makeEvidenceSource('call_logs'),
        makeEvidenceSource('delivery_scans'),
      ];
      const eligibility = makeEligibilityResult(true);
      const rtoEventId = 'rto-event-001';

      const result = engine.normalizeEvidence(sources, rtoEventId, eligibility);

      expect(result.rtoEventId).toBe(rtoEventId);
      expect(result.eligibility).toEqual(eligibility);
      expect(result.sources).toEqual(sources);
      expect(result.normalizedAt).toBeDefined();
      expect(() => new Date(result.normalizedAt)).not.toThrow();
      expect(result.completeness).toBeDefined();
      expect(result.completeness.collected).toBeDefined();
      expect(result.completeness.unavailable).toBeDefined();
      expect(result.completeness.timeoutTimestamps).toBeDefined();
    });

    it('should include normalizedAt as a valid ISO 8601 timestamp', () => {
      const sources = [makeEvidenceSource('gps')];
      const eligibility = makeEligibilityResult(true);

      const result = engine.normalizeEvidence(sources, 'rto-001', eligibility);

      const parsed = new Date(result.normalizedAt);
      expect(parsed.toISOString()).toBe(result.normalizedAt);
    });

    it('should include all sources in the output', () => {
      const sources: EvidenceSource[] = [
        makeEvidenceSource('gps'),
        makeEvidenceSource('call_logs'),
        makeEvidenceSource('hub_events'),
        makeEvidenceSource('order_history'),
      ];
      const eligibility = makeEligibilityResult(true);

      const result = engine.normalizeEvidence(sources, 'rto-001', eligibility);

      expect(result.sources).toHaveLength(4);
      expect(result.sources.map((s) => s.type)).toEqual(['gps', 'call_logs', 'hub_events', 'order_history']);
    });
  });

  describe('Req 2.3: Completeness metadata', () => {
    it('should derive collected types from sources when completeness not provided', () => {
      const sources: EvidenceSource[] = [
        makeEvidenceSource('gps'),
        makeEvidenceSource('delivery_scans'),
        makeEvidenceSource('hub_events'),
      ];
      const eligibility = makeEligibilityResult(true);

      const result = engine.normalizeEvidence(sources, 'rto-001', eligibility);

      expect(result.completeness.collected).toEqual(['gps', 'delivery_scans', 'hub_events']);
    });

    it('should derive unavailable types from missing sources when completeness not provided', () => {
      const sources: EvidenceSource[] = [
        makeEvidenceSource('gps'),
        makeEvidenceSource('delivery_scans'),
        makeEvidenceSource('hub_events'),
      ];
      const eligibility = makeEligibilityResult(true);

      const result = engine.normalizeEvidence(sources, 'rto-001', eligibility);

      expect(result.completeness.unavailable).toContain('call_logs');
      expect(result.completeness.unavailable).toContain('order_history');
      expect(result.completeness.unavailable).toContain('support_tickets');
      expect(result.completeness.unavailable).toContain('address_validation');
      expect(result.completeness.unavailable).not.toContain('gps');
      expect(result.completeness.unavailable).not.toContain('delivery_scans');
      expect(result.completeness.unavailable).not.toContain('hub_events');
    });

    it('should use provided completeness metadata when supplied', () => {
      const sources: EvidenceSource[] = [makeEvidenceSource('gps')];
      const eligibility = makeEligibilityResult(true);
      const completeness = {
        collected: ['gps', 'call_logs'],
        unavailable: ['delivery_scans', 'hub_events'],
        timeoutTimestamps: {
          delivery_scans: '2024-01-01T12:00:00.000Z',
          hub_events: '2024-01-01T12:00:01.000Z',
        },
      };

      const result = engine.normalizeEvidence(sources, 'rto-001', eligibility, completeness);

      expect(result.completeness.collected).toEqual(['gps', 'call_logs']);
      expect(result.completeness.unavailable).toEqual(['delivery_scans', 'hub_events']);
      expect(result.completeness.timeoutTimestamps).toEqual({
        delivery_scans: '2024-01-01T12:00:00.000Z',
        hub_events: '2024-01-01T12:00:01.000Z',
      });
    });

    it('should have empty timeoutTimestamps when no sources timed out', () => {
      const sources = EVIDENCE_SOURCE_TYPES.map((type) => makeEvidenceSource(type));
      const eligibility = makeEligibilityResult(true);

      const result = engine.normalizeEvidence(sources, 'rto-001', eligibility);

      expect(result.completeness.unavailable).toEqual([]);
      expect(result.completeness.timeoutTimestamps).toEqual({});
    });

    it('should mark all sources as unavailable when no sources provided', () => {
      const eligibility = makeEligibilityResult(false);

      const result = engine.normalizeEvidence([], 'rto-001', eligibility);

      expect(result.completeness.collected).toEqual([]);
      expect(result.completeness.unavailable).toEqual(EVIDENCE_SOURCE_TYPES);
    });
  });

  describe('Req 2.5: Link evidence to RTO_Event ID', () => {
    it('should include the rtoEventId in normalized output', () => {
      const sources = [makeEvidenceSource('gps')];
      const eligibility = makeEligibilityResult(true);
      const rtoEventId = 'rto-event-unique-123';

      const result = engine.normalizeEvidence(sources, rtoEventId, eligibility);

      expect(result.rtoEventId).toBe(rtoEventId);
    });

    it('should preserve different rtoEventIds correctly', () => {
      const sources = [makeEvidenceSource('gps')];
      const eligibility = makeEligibilityResult(true);

      const result1 = engine.normalizeEvidence(sources, 'rto-aaa', eligibility);
      const result2 = engine.normalizeEvidence(sources, 'rto-bbb', eligibility);

      expect(result1.rtoEventId).toBe('rto-aaa');
      expect(result2.rtoEventId).toBe('rto-bbb');
    });
  });
});

// ─── Unit Tests: normalizeEvidencePure (standalone function) ─────────────────

describe('normalizeEvidencePure', () => {
  it('should produce identical output to the class method', () => {
    const engine = new EvidenceCollectionEngine();
    const sources: EvidenceSource[] = [
      makeEvidenceSource('gps'),
      makeEvidenceSource('call_logs'),
      makeEvidenceSource('delivery_scans'),
    ];
    const eligibility = makeEligibilityResult(true);
    const rtoEventId = 'rto-001';

    // Both should produce structurally identical output
    const classResult = engine.normalizeEvidence(sources, rtoEventId, eligibility);
    const pureResult = normalizeEvidencePure(sources, rtoEventId, eligibility);

    expect(pureResult.rtoEventId).toBe(classResult.rtoEventId);
    expect(pureResult.eligibility).toEqual(classResult.eligibility);
    expect(pureResult.sources).toEqual(classResult.sources);
    expect(pureResult.completeness.collected).toEqual(classResult.completeness.collected);
    expect(pureResult.completeness.unavailable).toEqual(classResult.completeness.unavailable);
  });

  it('should handle empty sources correctly', () => {
    const eligibility = makeEligibilityResult(false);
    const result = normalizeEvidencePure([], 'rto-001', eligibility);

    expect(result.rtoEventId).toBe('rto-001');
    expect(result.sources).toEqual([]);
    expect(result.completeness.collected).toEqual([]);
    expect(result.completeness.unavailable).toEqual(EVIDENCE_SOURCE_TYPES);
  });
});

// ─── Unit Tests: persistEvidence ─────────────────────────────────────────────

describe('Evidence Collection Engine - persistEvidence', () => {
  // Mock EvidenceStore.insertMany
  vi.mock('../models/EvidenceStore', () => ({
    EvidenceStore: {
      insertMany: vi.fn().mockResolvedValue([]),
    },
  }));

  let engine: EvidenceCollectionEngine;

  beforeEach(() => {
    engine = new EvidenceCollectionEngine();
    vi.clearAllMocks();
  });

  describe('Req 2.4: Persist raw evidence with 90-day TTL', () => {
    it('should call insertMany with correct documents', async () => {
      const { EvidenceStore: MockStore } = await import('../models/EvidenceStore');
      const sources: EvidenceSource[] = [
        makeEvidenceSource('gps', { lat: 28.6, lng: 77.2 }),
        makeEvidenceSource('call_logs', { calls: [] }),
      ];
      const rtoEventId = 'rto-persist-001';

      await engine.persistEvidence(sources, rtoEventId);

      expect(MockStore.insertMany).toHaveBeenCalledTimes(1);
      const docs = (MockStore.insertMany as any).mock.calls[0][0];
      expect(docs).toHaveLength(2);
    });

    it('should set expiresAt to 90 days from now', async () => {
      const { EvidenceStore: MockStore } = await import('../models/EvidenceStore');
      const sources: EvidenceSource[] = [makeEvidenceSource('gps')];
      const rtoEventId = 'rto-persist-002';

      const before = Date.now();
      await engine.persistEvidence(sources, rtoEventId);
      const after = Date.now();

      const docs = (MockStore.insertMany as any).mock.calls[0][0];
      const expiresAt = docs[0].expiresAt.getTime();
      const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;

      // expiresAt should be approximately 90 days from now
      expect(expiresAt).toBeGreaterThanOrEqual(before + ninetyDaysMs);
      expect(expiresAt).toBeLessThanOrEqual(after + ninetyDaysMs);
    });

    it('should store each source as a separate document', async () => {
      const { EvidenceStore: MockStore } = await import('../models/EvidenceStore');
      const sources: EvidenceSource[] = [
        makeEvidenceSource('gps'),
        makeEvidenceSource('call_logs'),
        makeEvidenceSource('hub_events'),
      ];
      const rtoEventId = 'rto-persist-003';

      await engine.persistEvidence(sources, rtoEventId);

      const docs = (MockStore.insertMany as any).mock.calls[0][0];
      expect(docs).toHaveLength(3);
      expect(docs[0].sourceType).toBe('gps');
      expect(docs[1].sourceType).toBe('call_logs');
      expect(docs[2].sourceType).toBe('hub_events');
    });

    it('should include raw data from each source', async () => {
      const { EvidenceStore: MockStore } = await import('../models/EvidenceStore');
      const gpsData = { lat: 28.6, lng: 77.2, accuracy: 10 };
      const sources: EvidenceSource[] = [makeEvidenceSource('gps', gpsData)];
      const rtoEventId = 'rto-persist-004';

      await engine.persistEvidence(sources, rtoEventId);

      const docs = (MockStore.insertMany as any).mock.calls[0][0];
      expect(docs[0].rawData).toEqual(gpsData);
    });

    it('should include sourceId from each source', async () => {
      const { EvidenceStore: MockStore } = await import('../models/EvidenceStore');
      const source = makeEvidenceSource('gps');
      const rtoEventId = 'rto-persist-005';

      await engine.persistEvidence([source], rtoEventId);

      const docs = (MockStore.insertMany as any).mock.calls[0][0];
      expect(docs[0].sourceId).toBe(source.sourceId);
    });

    it('should set collectedAt from source timestamp', async () => {
      const { EvidenceStore: MockStore } = await import('../models/EvidenceStore');
      const collectedAt = '2024-01-15T10:30:00.000Z';
      const source: EvidenceSource = {
        type: 'gps',
        data: {},
        collectedAt,
        sourceId: 'src-001',
      };
      const rtoEventId = 'rto-persist-006';

      await engine.persistEvidence([source], rtoEventId);

      const docs = (MockStore.insertMany as any).mock.calls[0][0];
      expect(docs[0].collectedAt).toEqual(new Date(collectedAt));
    });
  });

  describe('Req 2.5: Link to originating RTO_Event ID', () => {
    it('should store rtoEventId in each document', async () => {
      const { EvidenceStore: MockStore } = await import('../models/EvidenceStore');
      const sources: EvidenceSource[] = [
        makeEvidenceSource('gps'),
        makeEvidenceSource('call_logs'),
      ];
      const rtoEventId = 'rto-link-001';

      await engine.persistEvidence(sources, rtoEventId);

      const docs = (MockStore.insertMany as any).mock.calls[0][0];
      docs.forEach((doc: any) => {
        expect(doc.rtoEventId).toBe(rtoEventId);
      });
    });
  });

  describe('Edge cases', () => {
    it('should not call insertMany when sources array is empty', async () => {
      const { EvidenceStore: MockStore } = await import('../models/EvidenceStore');

      await engine.persistEvidence([], 'rto-empty-001');

      expect(MockStore.insertMany).not.toHaveBeenCalled();
    });

    it('should handle single source correctly', async () => {
      const { EvidenceStore: MockStore } = await import('../models/EvidenceStore');
      const sources = [makeEvidenceSource('hub_events', { events: [1, 2, 3] })];

      await engine.persistEvidence(sources, 'rto-single-001');

      const docs = (MockStore.insertMany as any).mock.calls[0][0];
      expect(docs).toHaveLength(1);
      expect(docs[0].rtoEventId).toBe('rto-single-001');
      expect(docs[0].sourceType).toBe('hub_events');
    });
  });
});
