/**
 * Tests for Courier Escalation Service
 *
 * Validates Requirements 9.1, 9.3, 9.4:
 *  - 9.1: Generate escalation alert for fake_delivery_attempt, gps_anomaly,
 *          route_deviation within 60 seconds
 *  - 9.3: Include GPS traces, call logs, scan timestamps, address validation,
 *          hub events in the alert
 *  - 9.4: Note missing evidence sources that were unavailable
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  checkForEscalation,
  shouldEscalate,
  generateAlert,
  getEscalationAlerts,
  clearEscalationAlerts,
  ESCALATION_SUB_CAUSES,
  ClassificationResult,
  NormalizedEvidenceInput,
  EvidenceSourceData,
} from './courierEscalation';

// ─── Test Helpers ────────────────────────────────────────────────────────────

function makeClassification(overrides: Partial<ClassificationResult> = {}): ClassificationResult {
  return {
    customer_score: 0.2,
    courier_score: 0.85,
    system_score: 0.1,
    primary_category: 'courier_issue',
    sub_cause: 'fake_delivery_attempt',
    sub_cause_confidence: 0.8,
    confidence_threshold: 0.6,
    requires_manual_review: false,
    classification_timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function makeEvidenceSources(available: string[] = ['gps', 'call_logs', 'delivery_scans', 'address_validation', 'hub_events']): EvidenceSourceData[] {
  const sourceData: Record<string, any> = {
    gps: [
      { lat: 28.6139, lng: 77.209, timestamp: '2024-01-15T10:00:00Z' },
      { lat: 28.6145, lng: 77.2095, timestamp: '2024-01-15T10:05:00Z' },
    ],
    call_logs: [
      { callId: 'call-1', from: 'courier', to: 'customer', duration: 0, timestamp: '2024-01-15T10:01:00Z' },
    ],
    delivery_scans: [
      { scanId: 'scan-1', occurredAt: '2024-01-15T09:30:00Z', eventType: 'out_for_delivery' },
      { scanId: 'scan-2', occurredAt: '2024-01-15T10:10:00Z', eventType: 'delivery_failed' },
    ],
    order_history: [
      { orderId: 'ord-1', status: 'delivered', placedAt: '2024-01-10T08:00:00Z' },
    ],
    support_tickets: [
      { ticketId: 'tk-1', subject: 'Where is my order?' },
    ],
    address_validation: {
      address: { line1: '123 Main St', city: 'Delhi', pincode: '110001' },
      gpsLocation: { lat: 28.6139, lng: 77.209 },
      validationResult: 'match',
    },
    hub_events: [
      { eventType: 'scan_in', hubId: 'hub-1', occurredAt: '2024-01-15T08:00:00Z' },
      { eventType: 'dispatch', hubId: 'hub-1', occurredAt: '2024-01-15T09:00:00Z' },
    ],
  };

  return available.map((type) => ({
    type: type as EvidenceSourceData['type'],
    data: sourceData[type] || null,
    collectedAt: new Date().toISOString(),
    sourceId: `src-${type}`,
  }));
}

function makeNormalizedEvidence(
  availableSources: string[] = ['gps', 'call_logs', 'delivery_scans', 'address_validation', 'hub_events'],
  unavailableSources: string[] = []
): NormalizedEvidenceInput {
  const timeoutTimestamps: Record<string, string> = {};
  unavailableSources.forEach((s) => {
    timeoutTimestamps[s] = new Date().toISOString();
  });

  return {
    rtoEventId: 'rto-event-123',
    eligibility: {
      eligible: true,
      conditions: {
        unopened: { pass: true, evidenceIds: ['ev-1'] },
        undamaged: { pass: true, evidenceIds: ['ev-2'] },
        sealed: { pass: true, evidenceIds: ['ev-3'] },
      },
      determinedAt: new Date().toISOString(),
    },
    sources: makeEvidenceSources(availableSources),
    completeness: {
      collected: availableSources,
      unavailable: unavailableSources,
      timeoutTimestamps,
    },
    normalizedAt: new Date().toISOString(),
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Courier Escalation Service', () => {
  beforeEach(() => {
    clearEscalationAlerts();
  });

  describe('shouldEscalate', () => {
    it('should return true for fake_delivery_attempt sub-cause', () => {
      const classification = makeClassification({ sub_cause: 'fake_delivery_attempt' });
      expect(shouldEscalate(classification)).toBe(true);
    });

    it('should return true for gps_anomaly sub-cause', () => {
      const classification = makeClassification({ sub_cause: 'gps_anomaly' });
      expect(shouldEscalate(classification)).toBe(true);
    });

    it('should return true for route_deviation sub-cause', () => {
      const classification = makeClassification({ sub_cause: 'route_deviation' });
      expect(shouldEscalate(classification)).toBe(true);
    });

    it('should return false for non-escalation courier sub-causes', () => {
      const nonEscalationSubCauses = [
        'courier_never_contacted',
        'incorrect_status_update',
        'failed_despite_availability',
      ];

      nonEscalationSubCauses.forEach((subCause) => {
        const classification = makeClassification({ sub_cause: subCause });
        expect(shouldEscalate(classification)).toBe(false);
      });
    });

    it('should return false when primary category is not courier_issue', () => {
      const classification = makeClassification({
        primary_category: 'customer_issue',
        sub_cause: 'fake_delivery_attempt',
      });
      expect(shouldEscalate(classification)).toBe(false);
    });

    it('should return false when primary category is system_issue', () => {
      const classification = makeClassification({
        primary_category: 'system_issue',
        sub_cause: 'gps_anomaly',
      });
      expect(shouldEscalate(classification)).toBe(false);
    });

    it('should return false when sub_cause is null', () => {
      const classification = makeClassification({ sub_cause: null });
      expect(shouldEscalate(classification)).toBe(false);
    });

    it('should return false when primary_category is null', () => {
      const classification = makeClassification({
        primary_category: null,
        sub_cause: 'fake_delivery_attempt',
      });
      expect(shouldEscalate(classification)).toBe(false);
    });
  });

  describe('generateAlert', () => {
    it('should create alert with correct structure (Req 9.3)', () => {
      const evidence = makeNormalizedEvidence();
      const alert = generateAlert('courier-1', 'rto-event-123', 'fake_delivery_attempt', evidence);

      expect(alert.alertId).toMatch(/^ESC-courier-1-/);
      expect(alert.courierId).toBe('courier-1');
      expect(alert.rtoEventId).toBe('rto-event-123');
      expect(alert.subCause).toBe('fake_delivery_attempt');
      expect(alert.generatedAt).toBeDefined();
      expect(new Date(alert.generatedAt).getTime()).not.toBeNaN();
    });

    it('should include GPS traces in evidence (Req 9.3)', () => {
      const evidence = makeNormalizedEvidence();
      const alert = generateAlert('courier-1', 'rto-1', 'gps_anomaly', evidence);

      expect(alert.evidence.gpsTraces).toBeInstanceOf(Array);
      expect(alert.evidence.gpsTraces.length).toBeGreaterThan(0);
      expect(alert.evidence.gpsTraces[0]).toHaveProperty('lat');
      expect(alert.evidence.gpsTraces[0]).toHaveProperty('lng');
    });

    it('should include call logs in evidence (Req 9.3)', () => {
      const evidence = makeNormalizedEvidence();
      const alert = generateAlert('courier-1', 'rto-1', 'fake_delivery_attempt', evidence);

      expect(alert.evidence.callLogs).toBeInstanceOf(Array);
      expect(alert.evidence.callLogs.length).toBeGreaterThan(0);
    });

    it('should include delivery scan timestamps in evidence (Req 9.3)', () => {
      const evidence = makeNormalizedEvidence();
      const alert = generateAlert('courier-1', 'rto-1', 'route_deviation', evidence);

      expect(alert.evidence.deliveryScanTimestamps).toBeInstanceOf(Array);
      expect(alert.evidence.deliveryScanTimestamps.length).toBeGreaterThan(0);
      // Timestamps should be valid ISO strings
      alert.evidence.deliveryScanTimestamps.forEach((ts) => {
        expect(new Date(ts).getTime()).not.toBeNaN();
      });
    });

    it('should include address validation in evidence (Req 9.3)', () => {
      const evidence = makeNormalizedEvidence();
      const alert = generateAlert('courier-1', 'rto-1', 'fake_delivery_attempt', evidence);

      expect(alert.evidence.addressValidation).toBeDefined();
      expect(alert.evidence.addressValidation).toHaveProperty('address');
      expect(alert.evidence.addressValidation).toHaveProperty('gpsLocation');
    });

    it('should include hub events in evidence (Req 9.3)', () => {
      const evidence = makeNormalizedEvidence();
      const alert = generateAlert('courier-1', 'rto-1', 'gps_anomaly', evidence);

      expect(alert.evidence.hubEvents).toBeInstanceOf(Array);
      expect(alert.evidence.hubEvents.length).toBeGreaterThan(0);
    });

    it('should note missing evidence sources (Req 9.4)', () => {
      const evidence = makeNormalizedEvidence(
        ['gps', 'delivery_scans', 'hub_events'],
        ['call_logs', 'address_validation']
      );

      const alert = generateAlert('courier-1', 'rto-1', 'fake_delivery_attempt', evidence);

      expect(alert.evidence.missingEvidenceSources).toContain('call_logs');
      expect(alert.evidence.missingEvidenceSources).toContain('address_validation');
    });

    it('should have empty missingEvidenceSources when all sources are available (Req 9.4)', () => {
      const evidence = makeNormalizedEvidence(
        ['gps', 'call_logs', 'delivery_scans', 'address_validation', 'hub_events'],
        []
      );

      const alert = generateAlert('courier-1', 'rto-1', 'route_deviation', evidence);

      expect(alert.evidence.missingEvidenceSources).toEqual([]);
    });

    it('should store alert in alerts list', () => {
      const evidence = makeNormalizedEvidence();

      expect(getEscalationAlerts()).toHaveLength(0);
      generateAlert('courier-1', 'rto-1', 'fake_delivery_attempt', evidence);
      expect(getEscalationAlerts()).toHaveLength(1);
    });

    it('should generate unique alert IDs', () => {
      const evidence = makeNormalizedEvidence();

      const alert1 = generateAlert('courier-1', 'rto-1', 'fake_delivery_attempt', evidence);
      const alert2 = generateAlert('courier-1', 'rto-2', 'gps_anomaly', evidence);

      expect(alert1.alertId).not.toBe(alert2.alertId);
    });

    it('should handle empty evidence sources gracefully', () => {
      const evidence: NormalizedEvidenceInput = {
        rtoEventId: 'rto-1',
        eligibility: { eligible: true, conditions: {}, determinedAt: new Date().toISOString() },
        sources: [],
        completeness: {
          collected: [],
          unavailable: ['gps', 'call_logs', 'delivery_scans', 'address_validation', 'hub_events'],
          timeoutTimestamps: {},
        },
        normalizedAt: new Date().toISOString(),
      };

      const alert = generateAlert('courier-1', 'rto-1', 'fake_delivery_attempt', evidence);

      expect(alert.evidence.gpsTraces).toEqual([]);
      expect(alert.evidence.callLogs).toEqual([]);
      expect(alert.evidence.deliveryScanTimestamps).toEqual([]);
      expect(alert.evidence.addressValidation).toBeNull();
      expect(alert.evidence.hubEvents).toEqual([]);
      expect(alert.evidence.missingEvidenceSources).toHaveLength(5);
    });
  });

  describe('checkForEscalation', () => {
    it('should return an alert for fake_delivery_attempt (Req 9.1)', () => {
      const classification = makeClassification({ sub_cause: 'fake_delivery_attempt' });
      const evidence = makeNormalizedEvidence();

      const alert = checkForEscalation('courier-1', 'rto-1', classification, evidence);

      expect(alert).not.toBeNull();
      expect(alert!.courierId).toBe('courier-1');
      expect(alert!.rtoEventId).toBe('rto-1');
      expect(alert!.subCause).toBe('fake_delivery_attempt');
    });

    it('should return an alert for gps_anomaly (Req 9.1)', () => {
      const classification = makeClassification({ sub_cause: 'gps_anomaly' });
      const evidence = makeNormalizedEvidence();

      const alert = checkForEscalation('courier-2', 'rto-2', classification, evidence);

      expect(alert).not.toBeNull();
      expect(alert!.subCause).toBe('gps_anomaly');
    });

    it('should return an alert for route_deviation (Req 9.1)', () => {
      const classification = makeClassification({ sub_cause: 'route_deviation' });
      const evidence = makeNormalizedEvidence();

      const alert = checkForEscalation('courier-3', 'rto-3', classification, evidence);

      expect(alert).not.toBeNull();
      expect(alert!.subCause).toBe('route_deviation');
    });

    it('should return null for non-escalation sub-causes', () => {
      const classification = makeClassification({ sub_cause: 'courier_never_contacted' });
      const evidence = makeNormalizedEvidence();

      const alert = checkForEscalation('courier-1', 'rto-1', classification, evidence);

      expect(alert).toBeNull();
    });

    it('should return null for customer_issue classification', () => {
      const classification = makeClassification({
        primary_category: 'customer_issue',
        sub_cause: 'customer_unavailable',
      });
      const evidence = makeNormalizedEvidence();

      const alert = checkForEscalation('courier-1', 'rto-1', classification, evidence);

      expect(alert).toBeNull();
    });

    it('should return null for system_issue classification', () => {
      const classification = makeClassification({
        primary_category: 'system_issue',
        sub_cause: 'routing_engine_issue',
      });
      const evidence = makeNormalizedEvidence();

      const alert = checkForEscalation('courier-1', 'rto-1', classification, evidence);

      expect(alert).toBeNull();
    });

    it('should include all evidence types in generated alert (Req 9.3)', () => {
      const classification = makeClassification({ sub_cause: 'fake_delivery_attempt' });
      const evidence = makeNormalizedEvidence();

      const alert = checkForEscalation('courier-1', 'rto-1', classification, evidence);

      expect(alert).not.toBeNull();
      expect(alert!.evidence.gpsTraces.length).toBeGreaterThan(0);
      expect(alert!.evidence.callLogs.length).toBeGreaterThan(0);
      expect(alert!.evidence.deliveryScanTimestamps.length).toBeGreaterThan(0);
      expect(alert!.evidence.addressValidation).not.toBeNull();
      expect(alert!.evidence.hubEvents.length).toBeGreaterThan(0);
    });

    it('should note missing evidence sources in generated alert (Req 9.4)', () => {
      const classification = makeClassification({ sub_cause: 'gps_anomaly' });
      const evidence = makeNormalizedEvidence(
        ['gps', 'hub_events', 'delivery_scans'],
        ['call_logs', 'address_validation']
      );

      const alert = checkForEscalation('courier-1', 'rto-1', classification, evidence);

      expect(alert).not.toBeNull();
      expect(alert!.evidence.missingEvidenceSources).toContain('call_logs');
      expect(alert!.evidence.missingEvidenceSources).toContain('address_validation');
    });

    it('should generate alert within timing constraint (Req 9.1 - 60 seconds)', () => {
      const classification = makeClassification({ sub_cause: 'route_deviation' });
      const evidence = makeNormalizedEvidence();

      const startTime = Date.now();
      const alert = checkForEscalation('courier-1', 'rto-1', classification, evidence);
      const elapsed = Date.now() - startTime;

      expect(alert).not.toBeNull();
      // The function should be nearly instantaneous (well under 60s)
      expect(elapsed).toBeLessThan(1000);
    });
  });

  describe('ESCALATION_SUB_CAUSES constant', () => {
    it('should contain exactly the three escalation sub-causes', () => {
      expect(ESCALATION_SUB_CAUSES).toHaveLength(3);
      expect(ESCALATION_SUB_CAUSES).toContain('fake_delivery_attempt');
      expect(ESCALATION_SUB_CAUSES).toContain('gps_anomaly');
      expect(ESCALATION_SUB_CAUSES).toContain('route_deviation');
    });
  });

  describe('clearEscalationAlerts', () => {
    it('should clear all stored alerts', () => {
      const evidence = makeNormalizedEvidence();
      generateAlert('c1', 'rto-1', 'fake_delivery_attempt', evidence);
      generateAlert('c2', 'rto-2', 'gps_anomaly', evidence);

      expect(getEscalationAlerts()).toHaveLength(2);
      clearEscalationAlerts();
      expect(getEscalationAlerts()).toHaveLength(0);
    });
  });
});
