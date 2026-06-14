/**
 * Tests for the Pipeline Orchestrator
 *
 * Verifies end-to-end pipeline wiring:
 *  - Event flows through all stages
 *  - ML service HTTP calls (mocked)
 *  - Courier escalation post-classification
 *  - Fraud detection pre-decision
 *  - Event stream emission at each state transition
 *  - Decision routing based on classification and recovery
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  processRTOEvent,
  callClassifier,
  callRecoveryPredictor,
  shouldRunDemandMatching,
  MLClassificationResult,
  MLRecoveryPrediction,
  PipelineOptions,
} from './pipeline';
import { RTOEventPayload, NormalizedEvidence, EligibilityResult } from './evidenceCollection';
import { EventStreamService, EventPayload } from './eventStream';

// ---------------------------------------------------------------------------
// Helpers & Fixtures
// ---------------------------------------------------------------------------

function createMockRTOEvent(overrides?: Partial<RTOEventPayload>): RTOEventPayload {
  return {
    shipmentId: 'SHIP-001',
    orderId: 'ORDER-001',
    customerId: 'CUST-001',
    courierId: 'COURIER-001',
    packageDetails: {
      sku: 'SKU-PHONE-001',
      weight: 0.5,
      dimensions: { l: 20, w: 15, h: 8 },
      category: 'electronics',
      price: 15000,
      hsnCode: '8517',
    },
    deliveryAttempt: {
      attemptNumber: 1,
      timestamp: new Date().toISOString(),
      gpsLocation: { lat: 28.6139, lng: 77.209 },
      statusCode: 'RTO_INITIATED',
      failureReason: 'customer_unavailable',
    },
    hubLocation: { lat: 28.6139, lng: 77.209, hubId: 'HUB-DEL-01' },
    metadata: { source: 'logistics-partner', receivedAt: new Date().toISOString() },
    ...overrides,
  };
}

function createMockClassification(overrides?: Partial<MLClassificationResult>): MLClassificationResult {
  return {
    customer_score: 0.8,
    courier_score: 0.1,
    system_score: 0.1,
    primary_category: 'customer_issue',
    sub_cause: 'customer_unavailable',
    sub_cause_confidence: 0.75,
    confidence_threshold: 0.6,
    requires_manual_review: false,
    classification_timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function createMockPrediction(overrides?: Partial<MLRecoveryPrediction>): MLRecoveryPrediction {
  return {
    recovery_probability: 0.65,
    features_used: { prior_orders: 5, return_rate: 0.1 },
    partially_imputed: false,
    model_version: '1.0.0',
    predicted_at: new Date().toISOString(),
    ...overrides,
  };
}

function createMockEligibility(eligible: boolean): EligibilityResult {
  return {
    eligible,
    conditions: {
      unopened: { pass: eligible, evidenceIds: ['ev-1'] },
      undamaged: { pass: eligible, evidenceIds: ['ev-2'] },
      sealed: { pass: eligible, evidenceIds: ['ev-3'] },
    },
    determinedAt: new Date().toISOString(),
  };
}

/**
 * Creates a mock fetch function that returns predefined responses for ML endpoints.
 */
function createMockFetch(
  classificationResponse: MLClassificationResult,
  predictionResponse: MLRecoveryPrediction
): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const urlStr = typeof url === 'string' ? url : url.toString();

    if (urlStr.includes('/ml/v1/classify')) {
      return new Response(JSON.stringify(classificationResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (urlStr.includes('/ml/v1/predict-recovery')) {
      return new Response(JSON.stringify(predictionResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not found', { status: 404 });
  }) as typeof fetch;
}

/**
 * Creates a mock EvidenceCollectionEngine that returns predefined results.
 */
function createMockEvidenceEngine(opts?: { eligible?: boolean; throwOnCollect?: boolean }) {
  const eligible = opts?.eligible ?? true;
  const throwOnCollect = opts?.throwOnCollect ?? false;

  return {
    verifyEligibility: vi.fn().mockResolvedValue(createMockEligibility(eligible)),
    collectEvidence: throwOnCollect
      ? vi.fn().mockRejectedValue(new Error('Collection failed'))
      : vi.fn().mockResolvedValue([
          { type: 'gps', data: [{ lat: 28.6, lng: 77.2 }], collectedAt: new Date().toISOString(), sourceId: 's1' },
          { type: 'call_logs', data: {}, collectedAt: new Date().toISOString(), sourceId: 's2' },
          { type: 'delivery_scans', data: [], collectedAt: new Date().toISOString(), sourceId: 's3' },
          { type: 'hub_events', data: [], collectedAt: new Date().toISOString(), sourceId: 's4' },
        ]),
    normalizeEvidence: vi.fn().mockImplementation((sources, rtoEventId, eligibility) => ({
      rtoEventId,
      eligibility,
      sources,
      completeness: { collected: ['gps', 'call_logs', 'delivery_scans', 'hub_events'], unavailable: ['order_history', 'support_tickets', 'address_validation'], timeoutTimestamps: {} },
      normalizedAt: new Date().toISOString(),
    })),
  } as any;
}

/**
 * Creates a mock EventStreamService that records emitted events.
 */
function createMockEventStream(): EventStreamService & { emittedEvents: EventPayload[] } {
  const emittedEvents: EventPayload[] = [];
  const service = new EventStreamService({
    publishFn: async (payload: EventPayload) => {
      emittedEvents.push(payload);
      return 'mock-event-id';
    },
    delayFn: async () => {},
  });
  (service as any).emittedEvents = emittedEvents;
  return service as EventStreamService & { emittedEvents: EventPayload[] };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Pipeline Orchestrator', () => {
  describe('shouldRunDemandMatching', () => {
    it('returns true for courier issue with low recovery', () => {
      expect(shouldRunDemandMatching('courier_issue', 0.3, false)).toBe(true);
    });

    it('returns false for courier issue with high recovery', () => {
      expect(shouldRunDemandMatching('courier_issue', 0.7, false)).toBe(false);
    });

    it('returns true for customer issue with low recovery', () => {
      expect(shouldRunDemandMatching('customer_issue', 0.2, false)).toBe(true);
    });

    it('returns false for customer issue with high recovery', () => {
      expect(shouldRunDemandMatching('customer_issue', 0.8, false)).toBe(false);
    });

    it('returns false for system issue', () => {
      expect(shouldRunDemandMatching('system_issue', 0.1, false)).toBe(false);
    });

    it('returns false when fraud is suspended', () => {
      expect(shouldRunDemandMatching('courier_issue', 0.3, true)).toBe(false);
    });
  });

  describe('callClassifier', () => {
    it('sends POST to /ml/v1/classify and returns classification', async () => {
      const mockClassification = createMockClassification();
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(mockClassification), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const evidence = { rtoEventId: 'test', eligibility: {} as any, sources: [], completeness: { collected: [], unavailable: [], timeoutTimestamps: {} }, normalizedAt: '' };
      const result = await callClassifier(evidence, { mlServiceUrl: 'http://test:8000', fetchFn: mockFetch as any });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://test:8000/ml/v1/classify',
        expect.objectContaining({ method: 'POST' })
      );
      expect(result.primary_category).toBe('customer_issue');
      expect(result.customer_score).toBe(0.8);
    });

    it('throws on non-200 response', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response('Internal Server Error', { status: 500, statusText: 'Internal Server Error' })
      );

      const evidence = { rtoEventId: 'test', eligibility: {} as any, sources: [], completeness: { collected: [], unavailable: [], timeoutTimestamps: {} }, normalizedAt: '' };
      await expect(
        callClassifier(evidence, { mlServiceUrl: 'http://test:8000', fetchFn: mockFetch as any })
      ).rejects.toThrow('Classification service returned 500');
    });
  });

  describe('callRecoveryPredictor', () => {
    it('sends POST to /ml/v1/predict-recovery and returns prediction', async () => {
      const mockPrediction = createMockPrediction();
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(mockPrediction), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const classification = createMockClassification();
      const result = await callRecoveryPredictor(
        classification,
        { customerId: 'c1' },
        { orderId: 'o1' },
        { mlServiceUrl: 'http://test:8000', fetchFn: mockFetch as any }
      );

      expect(mockFetch).toHaveBeenCalledWith(
        'http://test:8000/ml/v1/predict-recovery',
        expect.objectContaining({ method: 'POST' })
      );
      expect(result.recovery_probability).toBe(0.65);
    });
  });

  describe('processRTOEvent — full pipeline', () => {
    let mockEventStream: EventStreamService & { emittedEvents: EventPayload[] };

    beforeEach(() => {
      mockEventStream = createMockEventStream();
      vi.restoreAllMocks();
    });

    it('routes ineligible packages to warehouse return immediately', async () => {
      const event = createMockRTOEvent();
      const evidenceEngine = createMockEvidenceEngine({ eligible: false });

      // Mock persistDecisionRecord
      vi.mock('./decisionEngine', async (importOriginal) => {
        const actual = await importOriginal() as any;
        return {
          ...actual,
          persistDecisionRecord: vi.fn().mockResolvedValue(undefined),
        };
      });

      const options: PipelineOptions = {
        eventStreamService: mockEventStream,
        evidenceEngine,
        fetchFn: createMockFetch(createMockClassification(), createMockPrediction()),
      };

      const result = await processRTOEvent(event, 'RTO-001', options);

      expect(result.stages.evidenceCollection).toBe('success');
      expect(result.stages.decision).toBe('success');
      expect(result.decision?.action).toBe('warehouse_return');
      expect(result.decision?.reasoning).toContain('ineligible');
      // Should not have progressed to classification
      expect(result.stages.classification).toBe('skipped');
    });

    it('processes eligible event through full pipeline with customer issue + high recovery → redeliver', async () => {
      const event = createMockRTOEvent();
      const evidenceEngine = createMockEvidenceEngine({ eligible: true });
      const classification = createMockClassification({ primary_category: 'customer_issue', customer_score: 0.8 });
      const prediction = createMockPrediction({ recovery_probability: 0.7 });

      const options: PipelineOptions = {
        eventStreamService: mockEventStream,
        evidenceEngine,
        fetchFn: createMockFetch(classification, prediction),
      };

      const result = await processRTOEvent(event, 'RTO-002', options);

      expect(result.stages.evidenceCollection).toBe('success');
      expect(result.stages.classification).toBe('success');
      expect(result.stages.prediction).toBe('success');
      // High recovery + customer issue → redeliver (no demand matching needed)
      expect(result.stages.demandMatching).toBe('skipped');
      expect(result.stages.buyerRanking).toBe('skipped');
      expect(result.stages.decision).toBe('success');
      expect(result.stages.execution).toBe('success');
      expect(result.decision?.action).toBe('redeliver');
    });

    it('processes courier issue with high recovery → redeliver', async () => {
      const event = createMockRTOEvent();
      const evidenceEngine = createMockEvidenceEngine({ eligible: true });
      const classification = createMockClassification({
        primary_category: 'courier_issue',
        sub_cause: 'fake_delivery_attempt',
        courier_score: 0.85,
        customer_score: 0.05,
        system_score: 0.1,
      });
      const prediction = createMockPrediction({ recovery_probability: 0.7 });

      const options: PipelineOptions = {
        eventStreamService: mockEventStream,
        evidenceEngine,
        fetchFn: createMockFetch(classification, prediction),
      };

      const result = await processRTOEvent(event, 'RTO-003', options);

      expect(result.stages.evidenceCollection).toBe('success');
      expect(result.stages.classification).toBe('success');
      expect(result.stages.prediction).toBe('success');
      expect(result.stages.decision).toBe('success');
      expect(result.decision?.action).toBe('redeliver');
    });

    it('processes system issue → redeliver', async () => {
      const event = createMockRTOEvent();
      const evidenceEngine = createMockEvidenceEngine({ eligible: true });
      const classification = createMockClassification({
        primary_category: 'system_issue',
        sub_cause: 'address_mapping_error',
        system_score: 0.9,
        customer_score: 0.05,
        courier_score: 0.05,
      });
      const prediction = createMockPrediction({ recovery_probability: 0.3 });

      const options: PipelineOptions = {
        eventStreamService: mockEventStream,
        evidenceEngine,
        fetchFn: createMockFetch(classification, prediction),
      };

      const result = await processRTOEvent(event, 'RTO-004', options);

      expect(result.decision?.action).toBe('redeliver');
    });

    it('handles evidence collection failure gracefully', async () => {
      const event = createMockRTOEvent();
      const evidenceEngine = createMockEvidenceEngine({ eligible: true, throwOnCollect: true });

      const options: PipelineOptions = {
        eventStreamService: mockEventStream,
        evidenceEngine,
        fetchFn: createMockFetch(createMockClassification(), createMockPrediction()),
      };

      const result = await processRTOEvent(event, 'RTO-005', options);

      expect(result.stages.evidenceCollection).toBe('failure');
      expect(result.error).toContain('Evidence collection failed');
      expect(result.stages.classification).toBe('skipped');
    });

    it('handles classification service failure gracefully', async () => {
      const event = createMockRTOEvent();
      const evidenceEngine = createMockEvidenceEngine({ eligible: true });
      const failingFetch = (async (url: string | URL | Request) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        if (urlStr.includes('/ml/v1/classify')) {
          return new Response('Service unavailable', { status: 503, statusText: 'Service Unavailable' });
        }
        return new Response('Not found', { status: 404 });
      }) as typeof fetch;

      const options: PipelineOptions = {
        eventStreamService: mockEventStream,
        evidenceEngine,
        fetchFn: failingFetch,
      };

      const result = await processRTOEvent(event, 'RTO-006', options);

      expect(result.stages.evidenceCollection).toBe('success');
      expect(result.stages.classification).toBe('failure');
      expect(result.error).toContain('Classification failed');
    });

    it('handles prediction service failure gracefully', async () => {
      const event = createMockRTOEvent();
      const evidenceEngine = createMockEvidenceEngine({ eligible: true });
      const classification = createMockClassification();

      const failingFetch = (async (url: string | URL | Request) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        if (urlStr.includes('/ml/v1/classify')) {
          return new Response(JSON.stringify(classification), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (urlStr.includes('/ml/v1/predict-recovery')) {
          return new Response('Timeout', { status: 504, statusText: 'Gateway Timeout' });
        }
        return new Response('Not found', { status: 404 });
      }) as typeof fetch;

      const options: PipelineOptions = {
        eventStreamService: mockEventStream,
        evidenceEngine,
        fetchFn: failingFetch,
      };

      const result = await processRTOEvent(event, 'RTO-007', options);

      expect(result.stages.prediction).toBe('failure');
      expect(result.error).toContain('Recovery prediction failed');
    });

    it('emits event stream events at each stage', async () => {
      const event = createMockRTOEvent();
      const evidenceEngine = createMockEvidenceEngine({ eligible: true });
      const classification = createMockClassification({ primary_category: 'system_issue', system_score: 0.9 });
      const prediction = createMockPrediction({ recovery_probability: 0.8 });

      const options: PipelineOptions = {
        eventStreamService: mockEventStream,
        evidenceEngine,
        fetchFn: createMockFetch(classification, prediction),
      };

      await processRTOEvent(event, 'RTO-008', options);

      const eventTypes = mockEventStream.emittedEvents.map((e) => e.eventType);
      // Should have emitted: eligibility_check, evidence_collected, classification, prediction, decision, redelivery
      expect(eventTypes).toContain('eligibility_check');
      expect(eventTypes).toContain('evidence_collected');
      expect(eventTypes).toContain('classification');
      expect(eventTypes).toContain('prediction');
      expect(eventTypes).toContain('decision');
    });

    it('customer issue + low recovery + no buyers → warehouse return', async () => {
      const event = createMockRTOEvent();
      const evidenceEngine = createMockEvidenceEngine({ eligible: true });
      const classification = createMockClassification({
        primary_category: 'customer_issue',
        customer_score: 0.8,
        courier_score: 0.1,
        system_score: 0.1,
      });
      const prediction = createMockPrediction({ recovery_probability: 0.1 });

      const options: PipelineOptions = {
        eventStreamService: mockEventStream,
        evidenceEngine,
        fetchFn: createMockFetch(classification, prediction),
      };

      const result = await processRTOEvent(event, 'RTO-009', options);

      // Low recovery triggers demand matching but no DB means no candidates
      expect(result.stages.demandMatching).toBeDefined();
      expect(result.stages.decision).toBe('success');
      expect(result.decision?.action).toBe('warehouse_return');
    });
  });

  describe('Pipeline routing decisions integration', () => {
    it('all decision matrix routes produce valid decision records', async () => {
      const eventStream = createMockEventStream();
      const event = createMockRTOEvent();

      const testCases = [
        { category: 'courier_issue', recovery: 0.7, expectedAction: 'redeliver' },
        { category: 'system_issue', recovery: 0.2, expectedAction: 'redeliver' },
        { category: 'customer_issue', recovery: 0.8, expectedAction: 'redeliver' },
      ];

      for (const tc of testCases) {
        const evidenceEngine = createMockEvidenceEngine({ eligible: true });
        const classification = createMockClassification({
          primary_category: tc.category,
          [`${tc.category.split('_')[0]}_score`]: 0.9,
        });
        const prediction = createMockPrediction({ recovery_probability: tc.recovery });

        const options: PipelineOptions = {
          eventStreamService: eventStream,
          evidenceEngine,
          fetchFn: createMockFetch(classification, prediction),
        };

        const result = await processRTOEvent(event, `RTO-${tc.category}`, options);

        expect(result.decision).toBeDefined();
        expect(result.decision?.action).toBe(tc.expectedAction);
        expect(result.decision?.rtoEventId).toBe(`RTO-${tc.category}`);
        expect(result.decision?.rootCause).toBeDefined();
        expect(result.decision?.reasoning).toBeTruthy();
        expect(result.decision?.timestamp).toBeTruthy();
      }
    });
  });
});
