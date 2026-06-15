import { describe, it, expect } from 'vitest';
import { calculate } from './businessImpactCalculator';
import { FeatureVector } from './types';

function makeFeatureVector(overrides?: {
  mrp?: number;
  currentMarketPrice?: number;
  inspectionGrade?: 'A' | 'B' | 'C' | 'D' | 'F';
}): FeatureVector {
  return {
    product: {
      category: 'Electronics',
      mrp: overrides?.mrp ?? 50000,
      currentMarketPrice: overrides?.currentMarketPrice ?? 40000,
      brandPopularityScore: 80,
    },
    condition: {
      inspectionGrade: overrides?.inspectionGrade ?? 'A',
      packagingCondition: 'Original',
      damageScore: 10,
      batteryHealth: 95,
    },
    demand: {
      wishlistCount: 100,
      cartCount: 30,
      nearbyInterestedBuyers: 10,
      historicalConversionRate: 0.7,
    },
    location: {
      city: 'Mumbai',
      demandDensity: 80,
      distanceToBuyers: 5,
    },
    financial: {
      expectedRecoveryValue: 38000,
      warehouseCostAvoided: 200,
      deliveryCostSaved: 150,
    },
    metadata: {
      source: 'random',
      syntheticFields: [],
      generatedAt: new Date().toISOString(),
    },
  };
}

describe('BusinessImpactCalculator', () => {
  describe('calculate', () => {
    it('should compute traditional return cost as sum of reverse pickup + hub processing + warehouse inbound + re-listing', () => {
      const features = makeFeatureVector();
      const result = calculate(features);
      // 120 + 80 + 90 + 100 = 390
      expect(result.traditionalReturnCost).toBe(390);
    });

    it('should compute flash deal route cost as local delivery + inspection', () => {
      const features = makeFeatureVector();
      const result = calculate(features);
      // 120 + 50 = 170
      expect(result.flashDealRouteCost).toBe(170);
    });

    it('should compute savings amount as traditional - flash deal route', () => {
      const features = makeFeatureVector();
      const result = calculate(features);
      // 390 - 170 = 220
      expect(result.savingsAmount).toBe(220);
    });

    it('should compute cost reduction percentage rounded to 1 decimal', () => {
      const features = makeFeatureVector();
      const result = calculate(features);
      // (220 / 390) * 100 = 56.410...% → 56.4
      expect(result.costReductionPercentage).toBe(56.4);
    });

    it('should set warehouseTouchesAvoided to 3', () => {
      const features = makeFeatureVector();
      const result = calculate(features);
      expect(result.warehouseTouchesAvoided).toBe(3);
    });

    it('should compute estimatedRecoveryValue using grade depreciation for grade A', () => {
      const features = makeFeatureVector({ currentMarketPrice: 40000, inspectionGrade: 'A' });
      const result = calculate(features);
      // 40000 * 1.0 = 40000
      expect(result.estimatedRecoveryValue).toBe(40000);
    });

    it('should compute estimatedRecoveryValue using grade depreciation for grade B', () => {
      const features = makeFeatureVector({ currentMarketPrice: 40000, inspectionGrade: 'B' });
      const result = calculate(features);
      // 40000 * 0.85 = 34000
      expect(result.estimatedRecoveryValue).toBe(34000);
    });

    it('should compute estimatedRecoveryValue using grade depreciation for grade C', () => {
      const features = makeFeatureVector({ currentMarketPrice: 40000, inspectionGrade: 'C' });
      const result = calculate(features);
      // 40000 * 0.70 = 28000
      expect(result.estimatedRecoveryValue).toBe(28000);
    });

    it('should compute estimatedRecoveryValue using grade depreciation for grade D', () => {
      const features = makeFeatureVector({ currentMarketPrice: 40000, inspectionGrade: 'D' });
      const result = calculate(features);
      // 40000 * 0.50 = 20000
      expect(result.estimatedRecoveryValue).toBe(20000);
    });

    it('should compute estimatedRecoveryValue using grade depreciation for grade F', () => {
      const features = makeFeatureVector({ currentMarketPrice: 40000, inspectionGrade: 'F' });
      const result = calculate(features);
      // 40000 * 0.50 = 20000
      expect(result.estimatedRecoveryValue).toBe(20000);
    });

    it('should compute revenueRecoveryRate as (estimatedRecoveryValue / mrp) × 100', () => {
      const features = makeFeatureVector({ mrp: 50000, currentMarketPrice: 40000, inspectionGrade: 'B' });
      const result = calculate(features);
      // estimatedRecoveryValue = 40000 * 0.85 = 34000
      // revenueRecoveryRate = (34000 / 50000) * 100 = 68.0
      expect(result.revenueRecoveryRate).toBe(68);
    });

    it('should set estimatedRecoveryValue to null and add to missingInputs when currentMarketPrice is missing', () => {
      const features = makeFeatureVector();
      // Simulate missing currentMarketPrice
      (features.product as any).currentMarketPrice = undefined;
      const result = calculate(features);
      expect(result.estimatedRecoveryValue).toBeNull();
      expect(result.missingInputs).toContain('currentMarketPrice');
    });

    it('should set estimatedRecoveryValue to null and add to missingInputs when inspectionGrade is missing', () => {
      const features = makeFeatureVector();
      // Simulate missing inspectionGrade
      (features.condition as any).inspectionGrade = undefined;
      const result = calculate(features);
      expect(result.estimatedRecoveryValue).toBeNull();
      expect(result.missingInputs).toContain('inspectionGrade');
    });

    it('should set revenueRecoveryRate to null and add mrp to missingInputs when mrp is 0', () => {
      const features = makeFeatureVector({ mrp: 0 });
      const result = calculate(features);
      expect(result.revenueRecoveryRate).toBeNull();
      expect(result.missingInputs).toContain('mrp');
    });

    it('should not include missingInputs field when all inputs are present', () => {
      const features = makeFeatureVector();
      const result = calculate(features);
      expect(result.missingInputs).toBeUndefined();
    });

    it('should round monetary values to 2 decimal places', () => {
      const features = makeFeatureVector({ currentMarketPrice: 33333, inspectionGrade: 'C' });
      const result = calculate(features);
      // 33333 * 0.70 = 23333.1
      expect(result.estimatedRecoveryValue).toBe(23333.1);
      // Verify it's rounded to 2 decimal places
      const decimals = result.estimatedRecoveryValue!.toString().split('.')[1];
      expect(!decimals || decimals.length <= 2).toBe(true);
    });
  });
});
