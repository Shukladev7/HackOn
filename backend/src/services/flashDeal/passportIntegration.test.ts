import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FeatureVector } from './types';

// Use vi.hoisted to create mocks that can be used in vi.mock factory
const { mockSave, mockFindOne, MockProductPassport } = vi.hoisted(() => {
  const mockSave = vi.fn().mockResolvedValue(undefined);
  const mockFindOne = vi.fn();
  const MockProductPassport = Object.assign(
    vi.fn().mockImplementation((data: Record<string, unknown>) => ({
      ...data,
      routingHistory: data.routingHistory || [],
      save: mockSave,
    })),
    { findOne: mockFindOne }
  );
  return { mockSave, mockFindOne, MockProductPassport };
});

vi.mock('../../models/ProductPassport', () => ({
  ProductPassport: MockProductPassport,
}));

import {
  appendEvaluationStarted,
  appendAnalysisComplete,
  appendDispositionEvent,
  ensurePassportExists,
} from './passportIntegration';

// ─── Test Fixtures ───────────────────────────────────────────────────────────

function createMockPassport() {
  const routingHistory: Array<{ event: string; timestamp: string; details: string; status: string }> = [];
  return {
    passportId: 'test-passport-123',
    routingHistory,
    save: mockSave,
  };
}

function createMockFeatureVector(overrides?: Partial<FeatureVector>): FeatureVector {
  return {
    product: {
      category: 'Electronics',
      mrp: 50000,
      currentMarketPrice: 40000,
      brandPopularityScore: 80,
    },
    condition: {
      inspectionGrade: 'A',
      packagingCondition: 'Original',
      damageScore: 10,
      batteryHealth: 95,
    },
    demand: {
      wishlistCount: 120,
      cartCount: 30,
      nearbyInterestedBuyers: 5,
      historicalConversionRate: 0.65,
    },
    location: {
      city: 'Mumbai',
      demandDensity: 80,
      distanceToBuyers: 8,
    },
    financial: {
      expectedRecoveryValue: 35000,
      warehouseCostAvoided: 200,
      deliveryCostSaved: 100,
    },
    metadata: {
      source: 'random',
      syntheticFields: [],
      generatedAt: new Date().toISOString(),
    },
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('passportIntegration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('appendEvaluationStarted()', () => {
    it('appends "Flash Deal Evaluation Started" event to passport routing history', async () => {
      const mockPassport = createMockPassport();
      mockFindOne.mockResolvedValue(mockPassport);

      await appendEvaluationStarted('test-passport-123', 'eval-001');

      expect(mockFindOne).toHaveBeenCalledWith({ passportId: 'test-passport-123' });
      expect(mockPassport.routingHistory).toHaveLength(1);
      expect(mockPassport.routingHistory[0]).toMatchObject({
        event: 'Flash Deal Evaluation Started',
        details: 'Evaluation eval-001 initiated',
        status: 'active',
      });
      expect(mockPassport.routingHistory[0].timestamp).toBeDefined();
      expect(mockSave).toHaveBeenCalled();
    });

    it('logs warning and returns without throwing when passport not found', async () => {
      mockFindOne.mockResolvedValue(null);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await expect(
        appendEvaluationStarted('nonexistent', 'eval-001')
      ).resolves.toBeUndefined();

      expect(warnSpy).toHaveBeenCalled();
      expect(mockSave).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('catches and logs errors without throwing', async () => {
      mockFindOne.mockRejectedValue(new Error('DB error'));
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await expect(
        appendEvaluationStarted('test-passport-123', 'eval-001')
      ).resolves.toBeUndefined();

      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });

  describe('appendAnalysisComplete()', () => {
    it('appends "AI Analysis Complete" event with score and decision', async () => {
      const mockPassport = createMockPassport();
      mockFindOne.mockResolvedValue(mockPassport);

      await appendAnalysisComplete('test-passport-123', 85, 'FLASH_DEAL');

      expect(mockPassport.routingHistory).toHaveLength(1);
      expect(mockPassport.routingHistory[0]).toMatchObject({
        event: 'AI Analysis Complete',
        details: 'Flash Deal Score: 85/100. Decision: FLASH_DEAL',
        status: 'completed',
      });
      expect(mockSave).toHaveBeenCalled();
    });

    it('logs warning when passport not found', async () => {
      mockFindOne.mockResolvedValue(null);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await appendAnalysisComplete('nonexistent', 50, 'NORMAL_RESALE');

      expect(warnSpy).toHaveBeenCalled();
      expect(mockSave).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('catches and logs errors without throwing', async () => {
      mockFindOne.mockRejectedValue(new Error('DB error'));
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await expect(
        appendAnalysisComplete('test-passport-123', 85, 'FLASH_DEAL')
      ).resolves.toBeUndefined();

      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });

  describe('appendDispositionEvent()', () => {
    it('appends "Flash Deal Eligible" event for FLASH_DEAL decision', async () => {
      const mockPassport = createMockPassport();
      mockFindOne.mockResolvedValue(mockPassport);

      await appendDispositionEvent('test-passport-123', 'FLASH_DEAL', 0, 'Mumbai', 5);

      expect(mockPassport.routingHistory).toHaveLength(1);
      expect(mockPassport.routingHistory[0]).toMatchObject({
        event: 'Flash Deal Eligible',
        status: 'completed',
      });
    });

    it('appends "Buyer Reserved" event when FLASH_DEAL and nearbyBuyers > 0', async () => {
      const mockPassport = createMockPassport();
      mockFindOne.mockResolvedValue(mockPassport);

      await appendDispositionEvent('test-passport-123', 'FLASH_DEAL', 3, 'Delhi', 12);

      expect(mockPassport.routingHistory).toHaveLength(2);
      expect(mockPassport.routingHistory[0]).toMatchObject({
        event: 'Flash Deal Eligible',
        status: 'completed',
      });
      expect(mockPassport.routingHistory[1]).toMatchObject({
        event: 'Buyer Reserved',
        details: 'Buyer in Delhi, 12 km away',
        status: 'pending',
      });
    });

    it('appends "Routed to Amazon Renewed" for AMAZON_RENEWED', async () => {
      const mockPassport = createMockPassport();
      mockFindOne.mockResolvedValue(mockPassport);

      await appendDispositionEvent('test-passport-123', 'AMAZON_RENEWED', 0, 'Mumbai', 5);

      expect(mockPassport.routingHistory).toHaveLength(1);
      expect(mockPassport.routingHistory[0]).toMatchObject({
        event: 'Routed to Amazon Renewed',
        status: 'completed',
      });
    });

    it('appends "Routed to Normal Resale" for NORMAL_RESALE', async () => {
      const mockPassport = createMockPassport();
      mockFindOne.mockResolvedValue(mockPassport);

      await appendDispositionEvent('test-passport-123', 'NORMAL_RESALE', 0, 'Mumbai', 5);

      expect(mockPassport.routingHistory[0].event).toBe('Routed to Normal Resale');
    });

    it('appends "Routed to Circular Routing" for CIRCULAR_ROUTING', async () => {
      const mockPassport = createMockPassport();
      mockFindOne.mockResolvedValue(mockPassport);

      await appendDispositionEvent('test-passport-123', 'CIRCULAR_ROUTING', 0, 'Mumbai', 5);

      expect(mockPassport.routingHistory[0].event).toBe('Routed to Circular Routing');
    });

    it('appends "Routed to Warehouse Return" for WAREHOUSE_RETURN', async () => {
      const mockPassport = createMockPassport();
      mockFindOne.mockResolvedValue(mockPassport);

      await appendDispositionEvent('test-passport-123', 'WAREHOUSE_RETURN', 0, 'Mumbai', 5);

      expect(mockPassport.routingHistory[0].event).toBe('Routed to Warehouse Return');
    });

    it('logs warning when passport not found', async () => {
      mockFindOne.mockResolvedValue(null);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await appendDispositionEvent('nonexistent', 'FLASH_DEAL', 3, 'Delhi', 12);

      expect(warnSpy).toHaveBeenCalled();
      expect(mockSave).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe('ensurePassportExists()', () => {
    it('returns existing passportId when passport already exists', async () => {
      mockFindOne.mockResolvedValue({ passportId: 'flash-deal-eval-001' });

      const result = await ensurePassportExists(createMockFeatureVector(), 'eval-001');

      expect(result).toBe('flash-deal-eval-001');
      expect(mockSave).not.toHaveBeenCalled();
    });

    it('creates a new passport when none exists and returns passportId', async () => {
      mockFindOne.mockResolvedValue(null);

      const features = createMockFeatureVector();
      const result = await ensurePassportExists(features, 'eval-002');

      expect(result).toBe('flash-deal-eval-002');
      expect(mockSave).toHaveBeenCalled();
    });

    it('maps inspection grade A to condition "like_new"', async () => {
      mockFindOne.mockResolvedValue(null);
      const features = createMockFeatureVector({
        condition: { inspectionGrade: 'A', packagingCondition: 'Original', damageScore: 10, batteryHealth: 95 },
      });

      await ensurePassportExists(features, 'eval-a');

      expect(MockProductPassport).toHaveBeenCalledWith(
        expect.objectContaining({ condition: 'like_new' })
      );
    });

    it('maps inspection grade B to condition "good"', async () => {
      mockFindOne.mockResolvedValue(null);
      const features = createMockFeatureVector({
        condition: { inspectionGrade: 'B', packagingCondition: 'Original', damageScore: 20, batteryHealth: 85 },
      });

      await ensurePassportExists(features, 'eval-b');

      expect(MockProductPassport).toHaveBeenCalledWith(
        expect.objectContaining({ condition: 'good' })
      );
    });

    it('maps inspection grade C to condition "fair"', async () => {
      mockFindOne.mockResolvedValue(null);
      const features = createMockFeatureVector({
        condition: { inspectionGrade: 'C', packagingCondition: 'Damaged', damageScore: 50, batteryHealth: 60 },
      });

      await ensurePassportExists(features, 'eval-c');

      expect(MockProductPassport).toHaveBeenCalledWith(
        expect.objectContaining({ condition: 'fair' })
      );
    });

    it('maps inspection grade D to condition "fair"', async () => {
      mockFindOne.mockResolvedValue(null);
      const features = createMockFeatureVector({
        condition: { inspectionGrade: 'D', packagingCondition: 'Missing', damageScore: 70, batteryHealth: 40 },
      });

      await ensurePassportExists(features, 'eval-d');

      expect(MockProductPassport).toHaveBeenCalledWith(
        expect.objectContaining({ condition: 'fair' })
      );
    });

    it('sets correct fields on new passport', async () => {
      mockFindOne.mockResolvedValue(null);
      const features = createMockFeatureVector();

      await ensurePassportExists(features, 'eval-005');

      expect(MockProductPassport).toHaveBeenCalledWith(
        expect.objectContaining({
          passportId: 'flash-deal-eval-005',
          qrCodeValue: 'FD-eval-005',
          productName: 'Electronics Product',
          category: 'Electronics',
          currentOwner: 'Flash Deal Engine',
          currentLocation: { city: 'Mumbai', hub: 'Mumbai Hub' },
          currentStatus: 'at_hub',
          eligibilityScore: 0,
          routingHistory: [],
          lifecycleCount: 1,
        })
      );
    });

    it('returns null on error without throwing', async () => {
      mockFindOne.mockRejectedValue(new Error('DB connection failed'));
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await ensurePassportExists(createMockFeatureVector(), 'eval-fail');

      expect(result).toBeNull();
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });
});
