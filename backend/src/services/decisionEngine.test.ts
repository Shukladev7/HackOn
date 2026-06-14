/**
 * Tests for Decision Engine - Decision Record Generation (Task 10.2)
 *
 * Validates:
 * - generateDecisionRecord produces complete records with all required fields
 * - Human-readable reasoning is generated correctly
 * - Action selection logic per Requirements 7.1–7.6
 * - Persistence integration with DecisionRecord model
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generateDecisionRecord,
  generateReasoning,
  selectAction,
  persistDecisionRecord,
  generateAndPersistDecisionRecord,
  DecisionContext,
  DecisionRecord,
} from './decisionEngine';

// Mock the DecisionRecord Mongoose model
vi.mock('../models/DecisionRecord', () => {
  const saveMock = vi.fn().mockResolvedValue(undefined);
  return {
    DecisionRecord: vi.fn().mockImplementation((data: any) => ({
      ...data,
      save: saveMock,
    })),
    __saveMock: saveMock,
  };
});

// --- Test Data Factories ---

function createContext(overrides: Partial<DecisionContext> = {}): DecisionContext {
  return {
    rtoEventId: 'rto-event-123',
    classification: {
      category: 'customer_issue',
      subCause: 'customer_unavailable',
      scores: { customer: 0.85, courier: 0.10, system: 0.05 },
    },
    recoveryProbability: 0.6,
    candidateBuyerCount: 3,
    topBuyerScore: 0.78,
    selectedBuyerId: 'buyer-456',
    ...overrides,
  };
}

// --- Tests ---

describe('Decision Engine - Action Selection (selectAction)', () => {
  it('should select redeliver for courier issue with high recovery probability', () => {
    const context = createContext({
      classification: {
        category: 'courier_issue',
        subCause: 'fake_delivery_attempt',
        scores: { customer: 0.1, courier: 0.9, system: 0.05 },
      },
      recoveryProbability: 0.7,
    });
    expect(selectAction(context)).toBe('redeliver');
  });

  it('should select reallocate for courier issue with low recovery and buyers available', () => {
    const context = createContext({
      classification: {
        category: 'courier_issue',
        subCause: 'gps_anomaly',
        scores: { customer: 0.1, courier: 0.85, system: 0.05 },
      },
      recoveryProbability: 0.3,
      candidateBuyerCount: 2,
      topBuyerScore: 0.65,
    });
    expect(selectAction(context)).toBe('reallocate');
  });

  it('should select warehouse_return for courier issue with low recovery and no buyers', () => {
    const context = createContext({
      classification: {
        category: 'courier_issue',
        subCause: 'route_deviation',
        scores: { customer: 0.1, courier: 0.8, system: 0.1 },
      },
      recoveryProbability: 0.2,
      candidateBuyerCount: 0,
      topBuyerScore: null,
    });
    expect(selectAction(context)).toBe('warehouse_return');
  });

  it('should select redeliver for system issue regardless of recovery', () => {
    const context = createContext({
      classification: {
        category: 'system_issue',
        subCause: 'address_mapping_error',
        scores: { customer: 0.05, courier: 0.1, system: 0.85 },
      },
      recoveryProbability: 0.2,
    });
    expect(selectAction(context)).toBe('redeliver');
  });

  it('should select redeliver for customer issue with recovery above threshold', () => {
    const context = createContext({
      classification: {
        category: 'customer_issue',
        subCause: 'customer_unavailable',
        scores: { customer: 0.8, courier: 0.1, system: 0.1 },
      },
      recoveryProbability: 0.5,
    });
    expect(selectAction(context)).toBe('redeliver');
  });

  it('should select reallocate for customer issue with low recovery and buyers available', () => {
    const context = createContext({
      classification: {
        category: 'customer_issue',
        subCause: 'refused_delivery',
        scores: { customer: 0.9, courier: 0.05, system: 0.05 },
      },
      recoveryProbability: 0.1,
      candidateBuyerCount: 5,
      topBuyerScore: 0.82,
    });
    expect(selectAction(context)).toBe('reallocate');
  });

  it('should select warehouse_return for customer issue with low recovery and no buyers', () => {
    const context = createContext({
      classification: {
        category: 'customer_issue',
        subCause: 'not_interested',
        scores: { customer: 0.9, courier: 0.05, system: 0.05 },
      },
      recoveryProbability: 0.1,
      candidateBuyerCount: 0,
      topBuyerScore: null,
    });
    expect(selectAction(context)).toBe('warehouse_return');
  });

  it('should default to warehouse_return for unknown category', () => {
    const context = createContext({
      classification: {
        category: 'unknown_category',
        subCause: 'unknown',
        scores: { customer: 0.2, courier: 0.2, system: 0.2 },
      },
    });
    expect(selectAction(context)).toBe('warehouse_return');
  });
});

describe('Decision Engine - Reasoning Generation (generateReasoning)', () => {
  it('should include root cause category in reasoning', () => {
    const context = createContext();
    const reasoning = generateReasoning(context, 'redeliver');
    expect(reasoning).toContain('customer issue');
  });

  it('should include sub-cause in reasoning', () => {
    const context = createContext();
    const reasoning = generateReasoning(context, 'redeliver');
    expect(reasoning).toContain('customer_unavailable');
  });

  it('should include all three confidence scores', () => {
    const context = createContext({
      classification: {
        category: 'courier_issue',
        subCause: 'fake_delivery_attempt',
        scores: { customer: 0.12, courier: 0.88, system: 0.05 },
      },
    });
    const reasoning = generateReasoning(context, 'redeliver');
    expect(reasoning).toContain('0.12');
    expect(reasoning).toContain('0.88');
    expect(reasoning).toContain('0.05');
  });

  it('should include recovery probability percentage', () => {
    const context = createContext({ recoveryProbability: 0.65 });
    const reasoning = generateReasoning(context, 'redeliver');
    expect(reasoning).toContain('65.0%');
  });

  it('should mention courier exclusion for courier issue redeliver', () => {
    const context = createContext({
      classification: {
        category: 'courier_issue',
        subCause: 'fake_delivery_attempt',
        scores: { customer: 0.1, courier: 0.9, system: 0.0 },
      },
      recoveryProbability: 0.8,
    });
    const reasoning = generateReasoning(context, 'redeliver');
    expect(reasoning).toContain('different courier');
  });

  it('should mention technical correction for system issue', () => {
    const context = createContext({
      classification: {
        category: 'system_issue',
        subCause: 'routing_engine_issue',
        scores: { customer: 0.05, courier: 0.1, system: 0.85 },
      },
    });
    const reasoning = generateReasoning(context, 'redeliver');
    expect(reasoning).toContain('technical correction');
    expect(reasoning).toContain('routing_engine_issue');
  });

  it('should include candidate count for reallocate action', () => {
    const context = createContext({
      classification: {
        category: 'customer_issue',
        subCause: 'refused_delivery',
        scores: { customer: 0.9, courier: 0.05, system: 0.05 },
      },
      recoveryProbability: 0.1,
      candidateBuyerCount: 4,
      topBuyerScore: 0.72,
    });
    const reasoning = generateReasoning(context, 'reallocate');
    expect(reasoning).toContain('4 candidate buyer(s)');
    expect(reasoning).toContain('0.72');
  });

  it('should indicate no candidates for warehouse return', () => {
    const context = createContext({
      candidateBuyerCount: 0,
      topBuyerScore: null,
    });
    const reasoning = generateReasoning(context, 'warehouse_return');
    expect(reasoning).toContain('No candidate buyers');
  });
});

describe('Decision Engine - Decision Record Generation (generateDecisionRecord)', () => {
  it('should produce a record with all required fields', () => {
    const context = createContext();
    const record = generateDecisionRecord(context);

    // Verify all required fields exist
    expect(record.rtoEventId).toBe('rto-event-123');
    expect(record.rootCause).toBeDefined();
    expect(record.rootCause.category).toBe('customer_issue');
    expect(record.rootCause.subCause).toBe('customer_unavailable');
    expect(record.rootCause.scores).toBeDefined();
    expect(record.rootCause.scores.customer).toBe(0.85);
    expect(record.rootCause.scores.courier).toBe(0.10);
    expect(record.rootCause.scores.system).toBe(0.05);
    expect(record.action).toBeDefined();
    expect(record.reasoning).toBeDefined();
    expect(record.reasoning.length).toBeGreaterThan(0);
    expect(record.inputs).toBeDefined();
    expect(record.inputs.recoveryProbability).toBe(0.6);
    expect(record.inputs.candidateBuyerCount).toBe(3);
    expect(record.inputs.topBuyerScore).toBe(0.78);
    expect(record.timestamp).toBeDefined();
  });

  it('should include rtoEventId from context', () => {
    const context = createContext({ rtoEventId: 'my-special-event-id' });
    const record = generateDecisionRecord(context);
    expect(record.rtoEventId).toBe('my-special-event-id');
  });

  it('should include all three confidence scores in rootCause', () => {
    const context = createContext({
      classification: {
        category: 'courier_issue',
        subCause: 'gps_anomaly',
        scores: { customer: 0.15, courier: 0.75, system: 0.10 },
      },
    });
    const record = generateDecisionRecord(context);
    expect(record.rootCause.scores.customer).toBe(0.15);
    expect(record.rootCause.scores.courier).toBe(0.75);
    expect(record.rootCause.scores.system).toBe(0.10);
  });

  it('should set selectedBuyerId when action is reallocate', () => {
    const context = createContext({
      classification: {
        category: 'customer_issue',
        subCause: 'not_interested',
        scores: { customer: 0.9, courier: 0.05, system: 0.05 },
      },
      recoveryProbability: 0.1,
      candidateBuyerCount: 2,
      topBuyerScore: 0.65,
      selectedBuyerId: 'buyer-789',
    });
    const record = generateDecisionRecord(context);
    expect(record.action).toBe('reallocate');
    expect(record.selectedBuyerId).toBe('buyer-789');
  });

  it('should set selectedBuyerId to null when action is not reallocate', () => {
    const context = createContext({
      classification: {
        category: 'system_issue',
        subCause: 'address_mapping_error',
        scores: { customer: 0.05, courier: 0.1, system: 0.85 },
      },
      recoveryProbability: 0.8,
      selectedBuyerId: 'buyer-should-be-null',
    });
    const record = generateDecisionRecord(context);
    expect(record.action).toBe('redeliver');
    expect(record.selectedBuyerId).toBeNull();
  });

  it('should produce a valid ISO timestamp', () => {
    const context = createContext();
    const record = generateDecisionRecord(context);
    const parsed = new Date(record.timestamp);
    expect(parsed.toISOString()).toBe(record.timestamp);
  });

  it('should include human-readable reasoning', () => {
    const context = createContext();
    const record = generateDecisionRecord(context);
    expect(typeof record.reasoning).toBe('string');
    expect(record.reasoning.length).toBeGreaterThan(20);
    // Reasoning should contain key decision factors
    expect(record.reasoning).toContain('customer issue');
    expect(record.reasoning).toContain('60.0%');
  });

  it('should copy input values correctly', () => {
    const context = createContext({
      recoveryProbability: 0.42,
      candidateBuyerCount: 7,
      topBuyerScore: 0.91,
    });
    const record = generateDecisionRecord(context);
    expect(record.inputs.recoveryProbability).toBe(0.42);
    expect(record.inputs.candidateBuyerCount).toBe(7);
    expect(record.inputs.topBuyerScore).toBe(0.91);
  });

  it('should handle null topBuyerScore in inputs', () => {
    const context = createContext({
      candidateBuyerCount: 0,
      topBuyerScore: null,
    });
    const record = generateDecisionRecord(context);
    expect(record.inputs.topBuyerScore).toBeNull();
  });
});

describe('Decision Engine - Persistence (persistDecisionRecord)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should call save on the Mongoose model', async () => {
    const context = createContext();
    const record = generateDecisionRecord(context);
    const result = await persistDecisionRecord(record);
    expect(result).toEqual(record);
  });

  it('should pass all record fields to the model constructor', async () => {
    const { DecisionRecord: MockModel } = await import('../models/DecisionRecord');
    vi.clearAllMocks();

    const context = createContext({
      rtoEventId: 'persist-test-event',
      classification: {
        category: 'courier_issue',
        subCause: 'fake_delivery_attempt',
        scores: { customer: 0.1, courier: 0.85, system: 0.05 },
      },
      recoveryProbability: 0.3,
      candidateBuyerCount: 2,
      topBuyerScore: 0.6,
      selectedBuyerId: null,
    });
    const record = generateDecisionRecord(context);
    await persistDecisionRecord(record);

    expect(MockModel).toHaveBeenCalledWith(
      expect.objectContaining({
        rtoEventId: 'persist-test-event',
        rootCause: expect.objectContaining({
          category: 'courier_issue',
          subCause: 'fake_delivery_attempt',
          scores: { customer: 0.1, courier: 0.85, system: 0.05 },
        }),
        action: record.action,
        reasoning: expect.any(String),
        inputs: expect.objectContaining({
          recoveryProbability: 0.3,
          candidateBuyerCount: 2,
          topBuyerScore: 0.6,
        }),
      })
    );
  });

  it('should use generateAndPersistDecisionRecord as combined operation', async () => {
    const context = createContext();
    const record = await generateAndPersistDecisionRecord(context);

    expect(record.rtoEventId).toBe(context.rtoEventId);
    expect(record.rootCause.category).toBe(context.classification.category);
    expect(record.action).toBeDefined();
    expect(record.reasoning.length).toBeGreaterThan(0);
  });
});

describe('Decision Engine - Decision Record Field Completeness', () => {
  const allCategories: Array<{ category: string; subCause: string; scores: { customer: number; courier: number; system: number } }> = [
    { category: 'customer_issue', subCause: 'customer_unavailable', scores: { customer: 0.8, courier: 0.1, system: 0.1 } },
    { category: 'customer_issue', subCause: 'wrong_address', scores: { customer: 0.7, courier: 0.2, system: 0.1 } },
    { category: 'courier_issue', subCause: 'fake_delivery_attempt', scores: { customer: 0.1, courier: 0.85, system: 0.05 } },
    { category: 'courier_issue', subCause: 'gps_anomaly', scores: { customer: 0.05, courier: 0.9, system: 0.05 } },
    { category: 'system_issue', subCause: 'address_mapping_error', scores: { customer: 0.05, courier: 0.1, system: 0.85 } },
    { category: 'system_issue', subCause: 'platform_bug', scores: { customer: 0.1, courier: 0.05, system: 0.85 } },
  ];

  allCategories.forEach(({ category, subCause, scores }) => {
    it(`should produce complete record for ${category}/${subCause}`, () => {
      const context = createContext({
        classification: { category, subCause, scores },
        recoveryProbability: 0.4,
        candidateBuyerCount: 2,
        topBuyerScore: 0.7,
      });
      const record = generateDecisionRecord(context);

      // Validate all required fields per Requirement 7.7
      expect(record.rtoEventId).toBeDefined();
      expect(record.rtoEventId).not.toBe('');
      expect(record.rootCause.category).toBe(category);
      expect(record.rootCause.subCause).toBe(subCause);
      expect(typeof record.rootCause.scores.customer).toBe('number');
      expect(typeof record.rootCause.scores.courier).toBe('number');
      expect(typeof record.rootCause.scores.system).toBe('number');
      expect(['redeliver', 'reallocate', 'warehouse_return']).toContain(record.action);
      expect(record.reasoning.length).toBeGreaterThan(0);
      expect(typeof record.inputs.recoveryProbability).toBe('number');
      expect(typeof record.inputs.candidateBuyerCount).toBe('number');
      expect(record.inputs.topBuyerScore === null || typeof record.inputs.topBuyerScore === 'number').toBe(true);
      expect(record.timestamp).toBeDefined();
    });
  });
});
