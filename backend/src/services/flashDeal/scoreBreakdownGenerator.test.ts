import { describe, it, expect } from 'vitest';
import { generateBreakdown, distributePoints, CONTRIBUTOR_MAXIMUMS } from './scoreBreakdownGenerator';
import { CategoryScores, FeatureVector } from './types';

// ─── Test Helpers ────────────────────────────────────────────────────────────

function createTestFeatures(overrides?: Partial<FeatureVector>): FeatureVector {
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
    },
    demand: {
      wishlistCount: 250,
      cartCount: 100,
      nearbyInterestedBuyers: 25,
      historicalConversionRate: 0.5,
    },
    location: {
      city: 'Mumbai',
      demandDensity: 80,
      distanceToBuyers: 10,
    },
    financial: {
      expectedRecoveryValue: 35000,
      warehouseCostAvoided: 250,
      deliveryCostSaved: 150,
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

describe('scoreBreakdownGenerator', () => {
  describe('CONTRIBUTOR_MAXIMUMS', () => {
    it('should have exactly 5 contributors', () => {
      expect(Object.keys(CONTRIBUTOR_MAXIMUMS)).toHaveLength(5);
    });

    it('should sum to exactly 100', () => {
      const sum = Object.values(CONTRIBUTOR_MAXIMUMS).reduce((s, v) => s + v, 0);
      expect(sum).toBe(100);
    });

    it('should have correct individual maximums', () => {
      expect(CONTRIBUTOR_MAXIMUMS['Condition Grade']).toBe(30);
      expect(CONTRIBUTOR_MAXIMUMS['Local Demand']).toBe(15);
      expect(CONTRIBUTOR_MAXIMUMS['Wishlist Activity']).toBe(15);
      expect(CONTRIBUTOR_MAXIMUMS['Margin Potential']).toBe(25);
      expect(CONTRIBUTOR_MAXIMUMS['Buyer Density']).toBe(15);
    });
  });

  describe('generateBreakdown', () => {
    it('should return exactly 5 contributors', () => {
      const features = createTestFeatures();
      const categoryScores: CategoryScores = { condition: 80, demand: 70, financial: 60, location: 75 };
      const result = generateBreakdown(72, categoryScores, features);
      expect(result).toHaveLength(5);
    });

    it('should produce contributors whose points sum to the flashDealScore', () => {
      const features = createTestFeatures();
      const categoryScores: CategoryScores = { condition: 80, demand: 70, financial: 60, location: 75 };
      const flashDealScore = 72;
      const result = generateBreakdown(flashDealScore, categoryScores, features);
      const sum = result.reduce((s, c) => s + c.points, 0);
      expect(sum).toBe(flashDealScore);
    });

    it('should keep each contributor within [0, maximum]', () => {
      const features = createTestFeatures();
      const categoryScores: CategoryScores = { condition: 100, demand: 100, financial: 100, location: 100 };
      const result = generateBreakdown(95, categoryScores, features);
      for (const contributor of result) {
        expect(contributor.points).toBeGreaterThanOrEqual(0);
        expect(contributor.points).toBeLessThanOrEqual(contributor.maximum);
      }
    });

    it('should order contributors from highest to lowest points', () => {
      const features = createTestFeatures();
      const categoryScores: CategoryScores = { condition: 80, demand: 70, financial: 60, location: 75 };
      const result = generateBreakdown(72, categoryScores, features);
      for (let i = 1; i < result.length; i++) {
        expect(result[i - 1].points).toBeGreaterThanOrEqual(result[i].points);
      }
    });

    it('should order alphabetically when points are tied', () => {
      const features = createTestFeatures({
        demand: {
          wishlistCount: 0,
          cartCount: 0,
          nearbyInterestedBuyers: 0,
          historicalConversionRate: 0,
        },
      });
      const categoryScores: CategoryScores = { condition: 0, demand: 0, financial: 0, location: 0 };
      const result = generateBreakdown(0, categoryScores, features);
      // All zeros, so should be alphabetical
      const names = result.map((c) => c.name);
      const sortedNames = [...names].sort();
      expect(names).toEqual(sortedNames);
    });

    it('should handle flashDealScore of 0', () => {
      const features = createTestFeatures({
        demand: {
          wishlistCount: 0,
          cartCount: 0,
          nearbyInterestedBuyers: 0,
          historicalConversionRate: 0,
        },
      });
      const categoryScores: CategoryScores = { condition: 0, demand: 0, financial: 0, location: 0 };
      const result = generateBreakdown(0, categoryScores, features);
      const sum = result.reduce((s, c) => s + c.points, 0);
      expect(sum).toBe(0);
    });

    it('should handle flashDealScore of 100 with max category scores', () => {
      const features = createTestFeatures({
        demand: {
          wishlistCount: 500,
          cartCount: 200,
          nearbyInterestedBuyers: 50,
          historicalConversionRate: 1.0,
        },
      });
      const categoryScores: CategoryScores = { condition: 100, demand: 100, financial: 100, location: 100 };
      const result = generateBreakdown(100, categoryScores, features);
      const sum = result.reduce((s, c) => s + c.points, 0);
      expect(sum).toBe(100);
    });
  });

  describe('distributePoints', () => {
    it('should distribute points so sum equals targetTotal', () => {
      const rawPoints = {
        'Condition Grade': 22.5,
        'Local Demand': 8.3,
        'Wishlist Activity': 7.1,
        'Margin Potential': 18.7,
        'Buyer Density': 10.4,
      };
      const result = distributePoints(rawPoints, 67);
      const sum = result.reduce((s, c) => s + c.points, 0);
      expect(sum).toBe(67);
    });

    it('should floor values and distribute remainder by largest fractional part', () => {
      const rawPoints = {
        'Condition Grade': 10.9,
        'Local Demand': 5.1,
        'Wishlist Activity': 5.5,
        'Margin Potential': 8.8,
        'Buyer Density': 5.7,
      };
      // Floored: 10 + 5 + 5 + 8 + 5 = 33, target = 36, remainder = 3
      // Fractionals sorted desc: CG(0.9), MP(0.8), BD(0.7), WA(0.5), LD(0.1)
      // Distribute 3: CG gets +1, MP gets +1, BD gets +1
      const result = distributePoints(rawPoints, 36);
      const sum = result.reduce((s, c) => s + c.points, 0);
      expect(sum).toBe(36);
    });

    it('should not exceed maximum for any contributor', () => {
      const rawPoints = {
        'Condition Grade': 30,
        'Local Demand': 15,
        'Wishlist Activity': 15,
        'Margin Potential': 25,
        'Buyer Density': 15,
      };
      const result = distributePoints(rawPoints, 100);
      for (const contributor of result) {
        expect(contributor.points).toBeLessThanOrEqual(CONTRIBUTOR_MAXIMUMS[contributor.name]);
      }
    });

    it('should handle all zero raw points with zero target', () => {
      const rawPoints = {
        'Condition Grade': 0,
        'Local Demand': 0,
        'Wishlist Activity': 0,
        'Margin Potential': 0,
        'Buyer Density': 0,
      };
      const result = distributePoints(rawPoints, 0);
      const sum = result.reduce((s, c) => s + c.points, 0);
      expect(sum).toBe(0);
    });
  });
});
