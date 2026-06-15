/**
 * Unit tests for Score Calculator Service.
 *
 * Requirements: 3.1, 3.2, 3.7
 */

import { describe, it, expect } from 'vitest';
import { computeScore, normalizeCategoryScore, computeConfidence } from './scoreCalculator';
import { FeatureVector } from './types';

function makeFeatureVector(overrides?: Partial<{
  condition: Partial<FeatureVector['condition']>;
  demand: Partial<FeatureVector['demand']>;
  financial: Partial<FeatureVector['financial']>;
  location: Partial<FeatureVector['location']>;
}>): FeatureVector {
  return {
    product: {
      category: 'Electronics',
      mrp: 50000,
      currentMarketPrice: 40000,
      brandPopularityScore: 75,
    },
    condition: {
      inspectionGrade: 'A',
      packagingCondition: 'Original',
      damageScore: 10,
      batteryHealth: 90,
      ...overrides?.condition,
    },
    demand: {
      wishlistCount: 250,
      cartCount: 100,
      nearbyInterestedBuyers: 25,
      historicalConversionRate: 0.5,
      ...overrides?.demand,
    },
    location: {
      city: 'Mumbai',
      demandDensity: 80,
      distanceToBuyers: 10,
      ...overrides?.location,
    },
    financial: {
      expectedRecoveryValue: 70000,
      warehouseCostAvoided: 300,
      deliveryCostSaved: 150,
      ...overrides?.financial,
    },
    metadata: {
      source: 'random',
      syntheticFields: [],
      generatedAt: new Date().toISOString(),
    },
  };
}

describe('Score Calculator', () => {
  describe('normalizeCategoryScore', () => {
    it('should return a value between 0 and 100 for condition', () => {
      const features = makeFeatureVector();
      const score = normalizeCategoryScore(features, 'condition');
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    });

    it('should return a value between 0 and 100 for demand', () => {
      const features = makeFeatureVector();
      const score = normalizeCategoryScore(features, 'demand');
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    });

    it('should return a value between 0 and 100 for financial', () => {
      const features = makeFeatureVector();
      const score = normalizeCategoryScore(features, 'financial');
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    });

    it('should return a value between 0 and 100 for location', () => {
      const features = makeFeatureVector();
      const score = normalizeCategoryScore(features, 'location');
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    });

    it('should give higher condition score for grade A than grade F', () => {
      const featuresA = makeFeatureVector({ condition: { inspectionGrade: 'A' } });
      const featuresF = makeFeatureVector({ condition: { inspectionGrade: 'F' } });
      expect(normalizeCategoryScore(featuresA, 'condition')).toBeGreaterThan(
        normalizeCategoryScore(featuresF, 'condition')
      );
    });

    it('should give higher demand score for higher wishlist counts', () => {
      const featuresHigh = makeFeatureVector({ demand: { wishlistCount: 500 } });
      const featuresLow = makeFeatureVector({ demand: { wishlistCount: 0 } });
      expect(normalizeCategoryScore(featuresHigh, 'demand')).toBeGreaterThan(
        normalizeCategoryScore(featuresLow, 'demand')
      );
    });

    it('should give higher location score for closer buyers', () => {
      const featuresClose = makeFeatureVector({ location: { distanceToBuyers: 1 } });
      const featuresFar = makeFeatureVector({ location: { distanceToBuyers: 90 } });
      expect(normalizeCategoryScore(featuresClose, 'location')).toBeGreaterThan(
        normalizeCategoryScore(featuresFar, 'location')
      );
    });

    it('should correctly compute condition score for known values', () => {
      // Grade A = 100, Original = 100, damageScore 0 → inverted = 100, batteryHealth 100
      // Average = (100 + 100 + 100 + 100) / 4 = 100
      const features = makeFeatureVector({
        condition: {
          inspectionGrade: 'A',
          packagingCondition: 'Original',
          damageScore: 0,
          batteryHealth: 100,
        },
      });
      const score = normalizeCategoryScore(features, 'condition');
      expect(score).toBe(100);
    });
  });

  describe('computeScore', () => {
    it('should return an integer between 0 and 100', () => {
      const features = makeFeatureVector();
      const result = computeScore(features);
      expect(result.flashDealScore).toBeGreaterThanOrEqual(0);
      expect(result.flashDealScore).toBeLessThanOrEqual(100);
      expect(Number.isInteger(result.flashDealScore)).toBe(true);
    });

    it('should return correct weights from config', () => {
      const features = makeFeatureVector();
      const result = computeScore(features);
      expect(result.weights.condition).toBe(0.30);
      expect(result.weights.demand).toBe(0.30);
      expect(result.weights.financial).toBe(0.25);
      expect(result.weights.location).toBe(0.15);
    });

    it('should include all category scores in result', () => {
      const features = makeFeatureVector();
      const result = computeScore(features);
      expect(result.categoryScores).toHaveProperty('condition');
      expect(result.categoryScores).toHaveProperty('demand');
      expect(result.categoryScores).toHaveProperty('financial');
      expect(result.categoryScores).toHaveProperty('location');
    });

    it('should return a higher score for excellent features', () => {
      const excellentFeatures = makeFeatureVector({
        condition: { inspectionGrade: 'A', packagingCondition: 'Original', damageScore: 0, batteryHealth: 100 },
        demand: { wishlistCount: 500, cartCount: 200, nearbyInterestedBuyers: 50, historicalConversionRate: 1.0 },
        financial: { expectedRecoveryValue: 140000, warehouseCostAvoided: 500, deliveryCostSaved: 300 },
        location: { demandDensity: 100, distanceToBuyers: 0.5 },
      });
      const poorFeatures = makeFeatureVector({
        condition: { inspectionGrade: 'F', packagingCondition: 'Missing', damageScore: 100, batteryHealth: 0 },
        demand: { wishlistCount: 0, cartCount: 0, nearbyInterestedBuyers: 0, historicalConversionRate: 0 },
        financial: { expectedRecoveryValue: 100, warehouseCostAvoided: 50, deliveryCostSaved: 20 },
        location: { demandDensity: 0, distanceToBuyers: 100 },
      });

      const excellentResult = computeScore(excellentFeatures);
      const poorResult = computeScore(poorFeatures);

      expect(excellentResult.flashDealScore).toBeGreaterThan(poorResult.flashDealScore);
    });

    it('should compute maximum score of 100 for all-perfect features', () => {
      const perfectFeatures = makeFeatureVector({
        condition: { inspectionGrade: 'A', packagingCondition: 'Original', damageScore: 0, batteryHealth: 100 },
        demand: { wishlistCount: 500, cartCount: 200, nearbyInterestedBuyers: 50, historicalConversionRate: 1.0 },
        financial: { expectedRecoveryValue: 140000, warehouseCostAvoided: 500, deliveryCostSaved: 300 },
        location: { demandDensity: 100, distanceToBuyers: 0.5 },
      });
      const result = computeScore(perfectFeatures);
      expect(result.flashDealScore).toBe(100);
    });
  });

  describe('computeConfidence', () => {
    it('should return an integer between 0 and 100', () => {
      const features = makeFeatureVector();
      const result = computeScore(features);
      expect(result.confidenceScore).toBeGreaterThanOrEqual(0);
      expect(result.confidenceScore).toBeLessThanOrEqual(100);
      expect(Number.isInteger(result.confidenceScore)).toBe(true);
    });

    it('should return high confidence when all features are present and consistent', () => {
      // All features present (completeness = 100%) and similar category scores
      const features = makeFeatureVector({
        condition: { inspectionGrade: 'B', packagingCondition: 'Original', damageScore: 30, batteryHealth: 70 },
        demand: { wishlistCount: 250, cartCount: 100, nearbyInterestedBuyers: 25, historicalConversionRate: 0.5 },
        financial: { expectedRecoveryValue: 70000, warehouseCostAvoided: 275, deliveryCostSaved: 160 },
        location: { demandDensity: 50, distanceToBuyers: 50 },
      });
      const result = computeScore(features);
      expect(result.confidenceScore).toBeGreaterThan(50);
    });

    it('should give lower confidence when category scores deviate significantly', () => {
      // Create features where one category is much higher than others
      const unevenFeatures = makeFeatureVector({
        condition: { inspectionGrade: 'A', packagingCondition: 'Original', damageScore: 0, batteryHealth: 100 },
        demand: { wishlistCount: 0, cartCount: 0, nearbyInterestedBuyers: 0, historicalConversionRate: 0 },
        financial: { expectedRecoveryValue: 100, warehouseCostAvoided: 50, deliveryCostSaved: 20 },
        location: { demandDensity: 0, distanceToBuyers: 100 },
      });
      const evenFeatures = makeFeatureVector({
        condition: { inspectionGrade: 'B', packagingCondition: 'Original', damageScore: 30, batteryHealth: 70 },
        demand: { wishlistCount: 250, cartCount: 100, nearbyInterestedBuyers: 25, historicalConversionRate: 0.5 },
        financial: { expectedRecoveryValue: 70000, warehouseCostAvoided: 275, deliveryCostSaved: 160 },
        location: { demandDensity: 50, distanceToBuyers: 50 },
      });

      const unevenResult = computeScore(unevenFeatures);
      const evenResult = computeScore(evenFeatures);

      expect(evenResult.confidenceScore).toBeGreaterThan(unevenResult.confidenceScore);
    });
  });
});
