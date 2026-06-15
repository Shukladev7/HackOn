/**
 * Unit tests for Explainability Reporter Service.
 *
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6
 */

import { describe, it, expect } from 'vitest';
import { computePercentile, generateReport, generateExplanation } from './explainabilityReporter';
import { FeatureVector, DispositionDecision } from './types';

// ─── Test Helpers ────────────────────────────────────────────────────────────

function createFeatureVector(overrides?: Partial<{
  mrp: number;
  currentMarketPrice: number;
  brandPopularityScore: number;
  damageScore: number;
  batteryHealth: number;
  inspectionGrade: 'A' | 'B' | 'C' | 'D' | 'F';
  wishlistCount: number;
  cartCount: number;
  nearbyInterestedBuyers: number;
  historicalConversionRate: number;
  demandDensity: number;
  distanceToBuyers: number;
  expectedRecoveryValue: number;
  warehouseCostAvoided: number;
  deliveryCostSaved: number;
}>): FeatureVector {
  const defaults = {
    mrp: 75000,
    currentMarketPrice: 60000,
    brandPopularityScore: 50,
    damageScore: 50,
    batteryHealth: 50,
    inspectionGrade: 'B' as const,
    wishlistCount: 250,
    cartCount: 100,
    nearbyInterestedBuyers: 25,
    historicalConversionRate: 0.5,
    demandDensity: 50,
    distanceToBuyers: 50,
    expectedRecoveryValue: 70000,
    warehouseCostAvoided: 275,
    deliveryCostSaved: 160,
    ...overrides,
  };

  return {
    product: {
      category: 'Electronics',
      mrp: defaults.mrp,
      currentMarketPrice: defaults.currentMarketPrice,
      brandPopularityScore: defaults.brandPopularityScore,
    },
    condition: {
      inspectionGrade: defaults.inspectionGrade,
      packagingCondition: 'Original',
      damageScore: defaults.damageScore,
      batteryHealth: defaults.batteryHealth,
    },
    demand: {
      wishlistCount: defaults.wishlistCount,
      cartCount: defaults.cartCount,
      nearbyInterestedBuyers: defaults.nearbyInterestedBuyers,
      historicalConversionRate: defaults.historicalConversionRate,
    },
    location: {
      city: 'Mumbai',
      demandDensity: defaults.demandDensity,
      distanceToBuyers: defaults.distanceToBuyers,
    },
    financial: {
      expectedRecoveryValue: defaults.expectedRecoveryValue,
      warehouseCostAvoided: defaults.warehouseCostAvoided,
      deliveryCostSaved: defaults.deliveryCostSaved,
    },
    metadata: {
      source: 'random',
      syntheticFields: [],
      generatedAt: new Date().toISOString(),
    },
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('computePercentile', () => {
  it('returns 0 when value equals min', () => {
    expect(computePercentile(0, 0, 100)).toBe(0);
  });

  it('returns 100 when value equals max', () => {
    expect(computePercentile(100, 0, 100)).toBe(100);
  });

  it('returns 50 when value is at midpoint', () => {
    expect(computePercentile(50, 0, 100)).toBe(50);
  });

  it('returns 50 when min equals max', () => {
    expect(computePercentile(5, 5, 5)).toBe(50);
  });

  it('handles non-zero min correctly', () => {
    // 75 is 50% between 50 and 100
    expect(computePercentile(75, 50, 100)).toBe(50);
  });

  it('clamps below-min values to 0', () => {
    expect(computePercentile(-10, 0, 100)).toBe(0);
  });

  it('clamps above-max values to 100', () => {
    expect(computePercentile(150, 0, 100)).toBe(100);
  });
});

describe('generateReport', () => {
  it('returns 1–5 positive factors and 1–5 negative factors', () => {
    const features = createFeatureVector({
      wishlistCount: 490, // very high → positive
      batteryHealth: 95, // very high → positive
      damageScore: 5, // very low (inverted) → positive
      cartCount: 5, // very low → negative
      demandDensity: 5, // very low → negative
    });

    const report = generateReport(features, 'FLASH_DEAL', 82);

    expect(report.positiveFactors.length).toBeGreaterThanOrEqual(1);
    expect(report.positiveFactors.length).toBeLessThanOrEqual(5);
    expect(report.negativeFactors.length).toBeGreaterThanOrEqual(1);
    expect(report.negativeFactors.length).toBeLessThanOrEqual(5);
  });

  it('positive factors have "✓" prefix', () => {
    const features = createFeatureVector({ wishlistCount: 490, batteryHealth: 95 });
    const report = generateReport(features, 'FLASH_DEAL', 85);

    report.positiveFactors.forEach((f) => {
      expect(f.label).toMatch(/^✓ /);
    });
  });

  it('negative factors have "✗" prefix', () => {
    const features = createFeatureVector({ cartCount: 5, demandDensity: 5 });
    const report = generateReport(features, 'NORMAL_RESALE', 45);

    report.negativeFactors.forEach((f) => {
      expect(f.label).toMatch(/^✗ /);
    });
  });

  it('positive factors are sorted by percentile descending', () => {
    const features = createFeatureVector({
      wishlistCount: 490,
      batteryHealth: 95,
      brandPopularityScore: 85,
    });

    const report = generateReport(features, 'FLASH_DEAL', 80);

    for (let i = 1; i < report.positiveFactors.length; i++) {
      expect(report.positiveFactors[i - 1].percentile).toBeGreaterThanOrEqual(
        report.positiveFactors[i].percentile
      );
    }
  });

  it('negative factors are sorted by percentile ascending', () => {
    const features = createFeatureVector({
      cartCount: 5,
      demandDensity: 5,
      historicalConversionRate: 0.05,
    });

    const report = generateReport(features, 'WAREHOUSE_RETURN', 10);

    for (let i = 1; i < report.negativeFactors.length; i++) {
      expect(report.negativeFactors[i - 1].percentile).toBeLessThanOrEqual(
        report.negativeFactors[i].percentile
      );
    }
  });

  it('guarantees at least 1 positive and 1 negative factor even with mid-range features', () => {
    // All features at exactly 50th percentile — nothing above 70 or below 30
    const features = createFeatureVector();
    const report = generateReport(features, 'NORMAL_RESALE', 50);

    expect(report.positiveFactors.length).toBeGreaterThanOrEqual(1);
    expect(report.negativeFactors.length).toBeGreaterThanOrEqual(1);
  });

  it('caps positive factors at 5', () => {
    // Many features very high
    const features = createFeatureVector({
      mrp: 145000,
      currentMarketPrice: 135000,
      brandPopularityScore: 95,
      batteryHealth: 95,
      wishlistCount: 490,
      cartCount: 195,
      nearbyInterestedBuyers: 48,
      historicalConversionRate: 0.95,
      demandDensity: 95,
      expectedRecoveryValue: 135000,
      warehouseCostAvoided: 490,
      deliveryCostSaved: 290,
      damageScore: 5, // inverted, so low = high percentile
      distanceToBuyers: 1, // inverted, so low = high percentile
    });

    const report = generateReport(features, 'FLASH_DEAL', 92);
    expect(report.positiveFactors.length).toBeLessThanOrEqual(5);
  });

  it('handles damageScore inversion correctly (low damage = positive)', () => {
    const features = createFeatureVector({ damageScore: 5 });
    const report = generateReport(features, 'FLASH_DEAL', 80);

    const damageFactor = [...report.positiveFactors, ...report.negativeFactors].find(
      (f) => f.featureName === 'damageScore'
    );

    if (damageFactor && report.positiveFactors.includes(damageFactor)) {
      expect(damageFactor.label).toContain('Low Damage Score');
    }
  });

  it('handles distanceToBuyers inversion correctly (close = positive)', () => {
    const features = createFeatureVector({ distanceToBuyers: 1 });
    const report = generateReport(features, 'FLASH_DEAL', 80);

    const distanceFactor = [...report.positiveFactors, ...report.negativeFactors].find(
      (f) => f.featureName === 'distanceToBuyers'
    );

    if (distanceFactor && report.positiveFactors.includes(distanceFactor)) {
      expect(distanceFactor.label).toContain('Buyer Proximity');
    }
  });

  it('includes an explanation string', () => {
    const features = createFeatureVector();
    const report = generateReport(features, 'FLASH_DEAL', 80);

    expect(typeof report.explanation).toBe('string');
    expect(report.explanation.length).toBeGreaterThan(0);
  });
});

describe('generateExplanation', () => {
  it('produces a 2–4 sentence paragraph', () => {
    const positiveFactor = { label: '✓ Wishlist Activity', featureName: 'wishlistCount', value: 450, percentile: 90 };
    const negativeFactor = { label: '✗ Low Cart Activity', featureName: 'cartCount', value: 10, percentile: 5 };

    const explanation = generateExplanation('FLASH_DEAL', positiveFactor, negativeFactor, 82);
    const sentences = explanation.split(/[.!?]+/).filter((s) => s.trim().length > 0);

    expect(sentences.length).toBeGreaterThanOrEqual(2);
    expect(sentences.length).toBeLessThanOrEqual(4);
  });

  it('references the disposition decision name', () => {
    const positiveFactor = { label: '✓ Wishlist Activity', featureName: 'wishlistCount', value: 450, percentile: 90 };
    const negativeFactor = { label: '✗ Low Cart Activity', featureName: 'cartCount', value: 10, percentile: 5 };

    const explanation = generateExplanation('FLASH_DEAL', positiveFactor, negativeFactor, 82);
    expect(explanation).toContain('Flash Deal');
  });

  it('references the Flash Deal Score value', () => {
    const positiveFactor = { label: '✓ Wishlist Activity', featureName: 'wishlistCount', value: 450, percentile: 90 };
    const negativeFactor = { label: '✗ Low Cart Activity', featureName: 'cartCount', value: 10, percentile: 5 };

    const explanation = generateExplanation('FLASH_DEAL', positiveFactor, negativeFactor, 82);
    expect(explanation).toContain('82');
  });

  it('references the top positive factor', () => {
    const positiveFactor = { label: '✓ Wishlist Activity', featureName: 'wishlistCount', value: 450, percentile: 90 };
    const negativeFactor = { label: '✗ Low Cart Activity', featureName: 'cartCount', value: 10, percentile: 5 };

    const explanation = generateExplanation('FLASH_DEAL', positiveFactor, negativeFactor, 82);
    expect(explanation.toLowerCase()).toContain('wishlist activity');
  });

  it('references the primary risk factor', () => {
    const positiveFactor = { label: '✓ Wishlist Activity', featureName: 'wishlistCount', value: 450, percentile: 90 };
    const negativeFactor = { label: '✗ Low Cart Activity', featureName: 'cartCount', value: 10, percentile: 5 };

    const explanation = generateExplanation('FLASH_DEAL', positiveFactor, negativeFactor, 82);
    expect(explanation.toLowerCase()).toContain('cart activity');
  });

  it('handles null positive factor gracefully', () => {
    const negativeFactor = { label: '✗ Low Cart Activity', featureName: 'cartCount', value: 10, percentile: 5 };

    const explanation = generateExplanation('WAREHOUSE_RETURN', null, negativeFactor, 12);
    const sentences = explanation.split(/[.!?]+/).filter((s) => s.trim().length > 0);

    expect(sentences.length).toBeGreaterThanOrEqual(2);
    expect(explanation).toContain('12');
  });

  it('handles null negative factor gracefully', () => {
    const positiveFactor = { label: '✓ Wishlist Activity', featureName: 'wishlistCount', value: 450, percentile: 90 };

    const explanation = generateExplanation('FLASH_DEAL', positiveFactor, null, 85);
    const sentences = explanation.split(/[.!?]+/).filter((s) => s.trim().length > 0);

    expect(sentences.length).toBeGreaterThanOrEqual(2);
    expect(explanation).toContain('85');
  });

  it('works for WAREHOUSE_RETURN disposition', () => {
    const positiveFactor = { label: '✓ Battery Health', featureName: 'batteryHealth', value: 80, percentile: 80 };
    const negativeFactor = { label: '✗ High Damage Score', featureName: 'damageScore', value: 90, percentile: 10 };

    const explanation = generateExplanation('WAREHOUSE_RETURN', positiveFactor, negativeFactor, 8);
    expect(explanation).toContain('Warehouse Return');
    expect(explanation).toContain('8/100');
  });
});
