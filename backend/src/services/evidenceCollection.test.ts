/**
 * Tests for Evidence Collection Engine - Package Eligibility Verification
 *
 * Covers:
 * - Req 1.1: Verify seal intact, no damage, no tamper indicators within 10 seconds
 * - Req 1.2: Route ineligible packages to warehouse return with specific failed conditions
 * - Req 1.3: Inconclusive evidence marks package as ineligible
 * - Req 1.4: Record eligibility determination with timestamps, pass/fail per condition, evidence IDs
 * - Req 1.5: Eligible packages proceed to Root Cause Classifier
 */
import { describe, it, expect } from 'vitest';
import {
  EvidenceCollectionEngine,
  verifyEligibilityFromEvidence,
  getFailedConditions,
  EligibilityResult,
  DAMAGE_EVENT_TYPES,
  TAMPER_EVENT_TYPES,
  SEAL_INTACT_EVENT_TYPES,
  CONDITION_OK_EVENT_TYPES,
} from './evidenceCollection';

// ─── Test Helpers ────────────────────────────────────────────────────────────

function makeEvent(id: string, eventType: string) {
  return { _id: id, eventType, scanData: {} };
}

function makeRTOEventPayload(overrides: Partial<any> = {}) {
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

// ─── Unit Tests: Pure Eligibility Verification ───────────────────────────────

describe('Evidence Collection Engine - verifyEligibilityFromEvidence', () => {
  describe('Req 1.1: Package is eligible when all conditions pass', () => {
    it('should return eligible=true when seal is intact, no damage, and no tamper', () => {
      const hubEvents = [
        makeEvent('ev1', 'seal_verified'),
        makeEvent('ev2', 'condition_ok'),
      ];
      const deliveryScans = [
        makeEvent('ev3', 'inspection_pass'),
      ];

      const result = verifyEligibilityFromEvidence(hubEvents, deliveryScans);

      expect(result.eligible).toBe(true);
      expect(result.conditions.unopened.pass).toBe(true);
      expect(result.conditions.undamaged.pass).toBe(true);
      expect(result.conditions.sealed.pass).toBe(true);
    });

    it('should include evidence IDs for each passing condition', () => {
      const hubEvents = [
        makeEvent('ev1', 'seal_intact'),
        makeEvent('ev2', 'condition_ok'),
      ];

      const result = verifyEligibilityFromEvidence(hubEvents, []);

      expect(result.conditions.sealed.evidenceIds).toContain('ev1');
      expect(result.conditions.undamaged.evidenceIds).toContain('ev2');
    });
  });

  describe('Req 1.1: Package is ineligible when any condition fails', () => {
    it('should return eligible=false when damage is detected', () => {
      const hubEvents = [
        makeEvent('ev1', 'seal_verified'),
        makeEvent('ev2', 'damage_reported'),
      ];

      const result = verifyEligibilityFromEvidence(hubEvents, []);

      expect(result.eligible).toBe(false);
      expect(result.conditions.undamaged.pass).toBe(false);
      expect(result.conditions.undamaged.evidenceIds).toContain('ev2');
    });

    it('should return eligible=false when tamper is detected', () => {
      const hubEvents = [
        makeEvent('ev1', 'seal_verified'),
        makeEvent('ev2', 'condition_ok'),
        makeEvent('ev3', 'tamper_detected'),
      ];

      const result = verifyEligibilityFromEvidence(hubEvents, []);

      expect(result.eligible).toBe(false);
      expect(result.conditions.unopened.pass).toBe(false);
      expect(result.conditions.unopened.evidenceIds).toContain('ev3');
    });

    it('should return eligible=false when seal is broken', () => {
      const hubEvents = [
        makeEvent('ev1', 'condition_ok'),
        makeEvent('ev2', 'seal_broken'),
      ];

      const result = verifyEligibilityFromEvidence(hubEvents, []);

      expect(result.eligible).toBe(false);
      expect(result.conditions.sealed.pass).toBe(false);
      expect(result.conditions.sealed.evidenceIds).toContain('ev2');
    });

    it('should return eligible=false when all conditions fail', () => {
      const hubEvents = [
        makeEvent('ev1', 'damage_reported'),
        makeEvent('ev2', 'tamper_detected'),
        makeEvent('ev3', 'seal_broken'),
      ];

      const result = verifyEligibilityFromEvidence(hubEvents, []);

      expect(result.eligible).toBe(false);
      expect(result.conditions.unopened.pass).toBe(false);
      expect(result.conditions.undamaged.pass).toBe(false);
      expect(result.conditions.sealed.pass).toBe(false);
    });
  });

  describe('Req 1.3: Inconclusive evidence marks package as ineligible', () => {
    it('should return eligible=false when no evidence is available', () => {
      const result = verifyEligibilityFromEvidence([], []);

      expect(result.eligible).toBe(false);
      expect(result.conditions.unopened.pass).toBe(false);
      expect(result.conditions.undamaged.pass).toBe(false);
      expect(result.conditions.sealed.pass).toBe(false);
    });

    it('should return eligible=false when evidence is present but not relevant', () => {
      const hubEvents = [
        makeEvent('ev1', 'package_received'),
        makeEvent('ev2', 'dispatched'),
      ];

      const result = verifyEligibilityFromEvidence(hubEvents, []);

      expect(result.eligible).toBe(false);
      // No positive or negative evidence → inconclusive → ineligible
    });

    it('should fail the sealed condition when no seal evidence exists', () => {
      // Only condition_ok events, no seal-specific events
      const hubEvents = [
        makeEvent('ev1', 'condition_ok'),
      ];

      const result = verifyEligibilityFromEvidence(hubEvents, []);

      // unopened passes (condition_ok implies), undamaged passes, sealed fails (no seal evidence)
      expect(result.conditions.sealed.pass).toBe(false);
      expect(result.eligible).toBe(false);
    });
  });

  describe('Req 1.4: Record eligibility determination with timestamps and evidence IDs', () => {
    it('should include a determinedAt timestamp in ISO format', () => {
      const hubEvents = [makeEvent('ev1', 'seal_verified'), makeEvent('ev2', 'condition_ok')];

      const result = verifyEligibilityFromEvidence(hubEvents, []);

      expect(result.determinedAt).toBeDefined();
      expect(() => new Date(result.determinedAt)).not.toThrow();
      expect(new Date(result.determinedAt).toISOString()).toBe(result.determinedAt);
    });

    it('should record evidence IDs for each condition', () => {
      const hubEvents = [
        makeEvent('ev1', 'seal_verified'),
        makeEvent('ev2', 'condition_ok'),
        makeEvent('ev3', 'damage_reported'),
      ];

      const result = verifyEligibilityFromEvidence(hubEvents, []);

      // sealed passes with ev1
      expect(result.conditions.sealed.evidenceIds.length).toBeGreaterThan(0);
      // undamaged fails with ev3
      expect(result.conditions.undamaged.evidenceIds).toContain('ev3');
    });
  });
});

// ─── Unit Tests: Warehouse Return Routing ────────────────────────────────────

describe('Evidence Collection Engine - routeIneligibleToWarehouseReturn', () => {
  const engine = new EvidenceCollectionEngine();

  describe('Req 1.2: Route ineligible packages with failed condition details', () => {
    it('should route with single failed condition', () => {
      const eligibilityResult: EligibilityResult = {
        eligible: false,
        conditions: {
          unopened: { pass: true, evidenceIds: ['ev1'] },
          undamaged: { pass: false, evidenceIds: ['ev2'] },
          sealed: { pass: true, evidenceIds: ['ev3'] },
        },
        determinedAt: new Date().toISOString(),
      };

      const routing = engine.routeIneligibleToWarehouseReturn('rto-123', eligibilityResult);

      expect(routing.rtoEventId).toBe('rto-123');
      expect(routing.reason).toBe('ineligible');
      expect(routing.failedConditions).toEqual(['undamaged']);
      expect(routing.eligibilityResult).toEqual(eligibilityResult);
    });

    it('should route with multiple failed conditions', () => {
      const eligibilityResult: EligibilityResult = {
        eligible: false,
        conditions: {
          unopened: { pass: false, evidenceIds: [] },
          undamaged: { pass: false, evidenceIds: ['ev1'] },
          sealed: { pass: true, evidenceIds: ['ev2'] },
        },
        determinedAt: new Date().toISOString(),
      };

      const routing = engine.routeIneligibleToWarehouseReturn('rto-456', eligibilityResult);

      expect(routing.failedConditions).toContain('unopened');
      expect(routing.failedConditions).toContain('undamaged');
      expect(routing.failedConditions).not.toContain('sealed');
    });

    it('should route with all conditions failed', () => {
      const eligibilityResult: EligibilityResult = {
        eligible: false,
        conditions: {
          unopened: { pass: false, evidenceIds: [] },
          undamaged: { pass: false, evidenceIds: [] },
          sealed: { pass: false, evidenceIds: [] },
        },
        determinedAt: new Date().toISOString(),
      };

      const routing = engine.routeIneligibleToWarehouseReturn('rto-789', eligibilityResult);

      expect(routing.failedConditions).toEqual(['unopened', 'undamaged', 'sealed']);
    });
  });
});

// ─── Unit Tests: getFailedConditions Helper ──────────────────────────────────

describe('Evidence Collection Engine - getFailedConditions', () => {
  it('should return empty array when all conditions pass', () => {
    const result: EligibilityResult = {
      eligible: true,
      conditions: {
        unopened: { pass: true, evidenceIds: ['a'] },
        undamaged: { pass: true, evidenceIds: ['b'] },
        sealed: { pass: true, evidenceIds: ['c'] },
      },
      determinedAt: new Date().toISOString(),
    };

    expect(getFailedConditions(result)).toEqual([]);
  });

  it('should return all failed condition names', () => {
    const result: EligibilityResult = {
      eligible: false,
      conditions: {
        unopened: { pass: false, evidenceIds: [] },
        undamaged: { pass: true, evidenceIds: ['b'] },
        sealed: { pass: false, evidenceIds: [] },
      },
      determinedAt: new Date().toISOString(),
    };

    expect(getFailedConditions(result)).toEqual(['unopened', 'sealed']);
  });
});

// ─── Unit Tests: Edge Cases ──────────────────────────────────────────────────

describe('Evidence Collection Engine - Edge Cases', () => {
  it('should handle delivery scans alongside hub events', () => {
    const hubEvents = [makeEvent('ev1', 'seal_verified')];
    const deliveryScans = [
      makeEvent('ev2', 'condition_ok'),
      makeEvent('ev3', 'inspection_pass'),
    ];

    const result = verifyEligibilityFromEvidence(hubEvents, deliveryScans);

    expect(result.eligible).toBe(true);
  });

  it('should prioritize negative evidence over positive evidence', () => {
    // Both damage and condition_ok present → damage wins
    const hubEvents = [
      makeEvent('ev1', 'condition_ok'),
      makeEvent('ev2', 'damage_reported'),
      makeEvent('ev3', 'seal_verified'),
    ];

    const result = verifyEligibilityFromEvidence(hubEvents, []);

    expect(result.conditions.undamaged.pass).toBe(false);
    expect(result.eligible).toBe(false);
  });

  it('negative tamper evidence should override positive seal evidence for unopened', () => {
    const hubEvents = [
      makeEvent('ev1', 'seal_verified'),
      makeEvent('ev2', 'condition_ok'),
      makeEvent('ev3', 'tamper_detected'),
    ];

    const result = verifyEligibilityFromEvidence(hubEvents, []);

    expect(result.conditions.unopened.pass).toBe(false);
  });

  it('all known damage event types should cause undamaged to fail', () => {
    for (const damageType of DAMAGE_EVENT_TYPES) {
      const hubEvents = [
        makeEvent('ev1', 'seal_verified'),
        makeEvent('ev2', 'condition_ok'),
        makeEvent('damage', damageType),
      ];

      const result = verifyEligibilityFromEvidence(hubEvents, []);
      expect(result.conditions.undamaged.pass).toBe(false);
    }
  });

  it('all known tamper event types should cause unopened to fail', () => {
    for (const tamperType of TAMPER_EVENT_TYPES) {
      const hubEvents = [
        makeEvent('ev1', 'seal_verified'),
        makeEvent('ev2', 'condition_ok'),
        makeEvent('tamper', tamperType),
      ];

      const result = verifyEligibilityFromEvidence(hubEvents, []);
      expect(result.conditions.unopened.pass).toBe(false);
    }
  });

  it('all seal_intact event types should cause sealed to pass', () => {
    for (const sealType of SEAL_INTACT_EVENT_TYPES) {
      const hubEvents = [
        makeEvent('ev1', sealType),
        makeEvent('ev2', 'condition_ok'),
      ];

      const result = verifyEligibilityFromEvidence(hubEvents, []);
      expect(result.conditions.sealed.pass).toBe(true);
    }
  });
});

// ─── Unit Tests: Req 1.5 - Eligible packages proceed ─────────────────────────

describe('Evidence Collection Engine - Req 1.5: Eligible packages proceed', () => {
  it('eligible result signals that package should proceed to Root Cause Classifier', () => {
    const hubEvents = [
      makeEvent('ev1', 'seal_verified'),
      makeEvent('ev2', 'condition_ok'),
    ];

    const result = verifyEligibilityFromEvidence(hubEvents, []);

    // Eligible packages should have eligible=true — downstream caller uses
    // this to route to Root Cause Classifier
    expect(result.eligible).toBe(true);
  });

  it('ineligible result signals that package should NOT proceed', () => {
    const result = verifyEligibilityFromEvidence([], []);

    expect(result.eligible).toBe(false);
  });
});
