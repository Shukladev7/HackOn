/**
 * Unit tests for Feature Generator service.
 *
 * Tests: generateRandom, clampToRange, validate
 * (generateFromSeed and generateFromPassport require DB mocking - tested in integration)
 */

import { describe, it, expect } from 'vitest';
import {
  generateRandom,
  clampToRange,
  validate,
  FEATURE_BOUNDS,
  CATEGORIES,
  CITIES,
  INSPECTION_GRADES,
  PACKAGING_CONDITIONS,
} from './featureGenerator';

describe('featureGenerator', () => {
  describe('generateRandom', () => {
    it('should produce a complete feature vector with all required fields', () => {
      const features = generateRandom();

      expect(features.product).toBeDefined();
      expect(features.condition).toBeDefined();
      expect(features.demand).toBeDefined();
      expect(features.location).toBeDefined();
      expect(features.financial).toBeDefined();
      expect(features.metadata).toBeDefined();
    });

    it('should set metadata.source to "random"', () => {
      const features = generateRandom();
      expect(features.metadata.source).toBe('random');
    });

    it('should set metadata.generatedAt to a valid ISO 8601 timestamp', () => {
      const features = generateRandom();
      const parsed = new Date(features.metadata.generatedAt);
      expect(parsed.toISOString()).toBe(features.metadata.generatedAt);
    });

    it('should produce MRP within bounds', () => {
      const features = generateRandom();
      expect(features.product.mrp).toBeGreaterThanOrEqual(FEATURE_BOUNDS.mrp.min);
      expect(features.product.mrp).toBeLessThanOrEqual(FEATURE_BOUNDS.mrp.max);
    });

    it('should produce currentMarketPrice within bounds and not exceeding MRP', () => {
      const features = generateRandom();
      expect(features.product.currentMarketPrice).toBeGreaterThanOrEqual(
        FEATURE_BOUNDS.currentMarketPrice.min
      );
      expect(features.product.currentMarketPrice).toBeLessThanOrEqual(
        FEATURE_BOUNDS.currentMarketPrice.max
      );
      expect(features.product.currentMarketPrice).toBeLessThanOrEqual(features.product.mrp);
    });

    it('should pick category from allowed values', () => {
      const features = generateRandom();
      expect(CATEGORIES).toContain(features.product.category);
    });

    it('should pick city from allowed values', () => {
      const features = generateRandom();
      expect(CITIES).toContain(features.location.city);
    });

    it('should pick inspectionGrade from allowed values', () => {
      const features = generateRandom();
      expect(INSPECTION_GRADES).toContain(features.condition.inspectionGrade);
    });

    it('should pick packagingCondition from allowed values', () => {
      const features = generateRandom();
      expect(PACKAGING_CONDITIONS).toContain(features.condition.packagingCondition);
    });

    it('should produce all numeric fields within bounds', () => {
      const features = generateRandom();

      expect(features.product.brandPopularityScore).toBeGreaterThanOrEqual(FEATURE_BOUNDS.brandPopularityScore.min);
      expect(features.product.brandPopularityScore).toBeLessThanOrEqual(FEATURE_BOUNDS.brandPopularityScore.max);

      expect(features.condition.damageScore).toBeGreaterThanOrEqual(FEATURE_BOUNDS.damageScore.min);
      expect(features.condition.damageScore).toBeLessThanOrEqual(FEATURE_BOUNDS.damageScore.max);

      expect(features.condition.batteryHealth).toBeGreaterThanOrEqual(FEATURE_BOUNDS.batteryHealth.min);
      expect(features.condition.batteryHealth).toBeLessThanOrEqual(FEATURE_BOUNDS.batteryHealth.max);

      expect(features.demand.wishlistCount).toBeGreaterThanOrEqual(FEATURE_BOUNDS.wishlistCount.min);
      expect(features.demand.wishlistCount).toBeLessThanOrEqual(FEATURE_BOUNDS.wishlistCount.max);

      expect(features.demand.cartCount).toBeGreaterThanOrEqual(FEATURE_BOUNDS.cartCount.min);
      expect(features.demand.cartCount).toBeLessThanOrEqual(FEATURE_BOUNDS.cartCount.max);

      expect(features.demand.nearbyInterestedBuyers).toBeGreaterThanOrEqual(FEATURE_BOUNDS.nearbyInterestedBuyers.min);
      expect(features.demand.nearbyInterestedBuyers).toBeLessThanOrEqual(FEATURE_BOUNDS.nearbyInterestedBuyers.max);

      expect(features.demand.historicalConversionRate).toBeGreaterThanOrEqual(FEATURE_BOUNDS.historicalConversionRate.min);
      expect(features.demand.historicalConversionRate).toBeLessThanOrEqual(FEATURE_BOUNDS.historicalConversionRate.max);

      expect(features.location.demandDensity).toBeGreaterThanOrEqual(FEATURE_BOUNDS.demandDensity.min);
      expect(features.location.demandDensity).toBeLessThanOrEqual(FEATURE_BOUNDS.demandDensity.max);

      expect(features.location.distanceToBuyers).toBeGreaterThanOrEqual(FEATURE_BOUNDS.distanceToBuyers.min);
      expect(features.location.distanceToBuyers).toBeLessThanOrEqual(FEATURE_BOUNDS.distanceToBuyers.max);

      expect(features.financial.expectedRecoveryValue).toBeGreaterThanOrEqual(FEATURE_BOUNDS.expectedRecoveryValue.min);
      expect(features.financial.expectedRecoveryValue).toBeLessThanOrEqual(FEATURE_BOUNDS.expectedRecoveryValue.max);

      expect(features.financial.warehouseCostAvoided).toBeGreaterThanOrEqual(FEATURE_BOUNDS.warehouseCostAvoided.min);
      expect(features.financial.warehouseCostAvoided).toBeLessThanOrEqual(FEATURE_BOUNDS.warehouseCostAvoided.max);

      expect(features.financial.deliveryCostSaved).toBeGreaterThanOrEqual(FEATURE_BOUNDS.deliveryCostSaved.min);
      expect(features.financial.deliveryCostSaved).toBeLessThanOrEqual(FEATURE_BOUNDS.deliveryCostSaved.max);
    });
  });

  describe('clampToRange', () => {
    it('should return value unchanged when within range', () => {
      expect(clampToRange(50, 0, 100, 'test')).toBe(50);
    });

    it('should clamp to minimum when value is below range', () => {
      expect(clampToRange(-10, 0, 100, 'test')).toBe(0);
    });

    it('should clamp to maximum when value is above range', () => {
      expect(clampToRange(150, 0, 100, 'test')).toBe(100);
    });

    it('should return exact min when value equals min', () => {
      expect(clampToRange(0, 0, 100, 'test')).toBe(0);
    });

    it('should return exact max when value equals max', () => {
      expect(clampToRange(100, 0, 100, 'test')).toBe(100);
    });
  });

  describe('validate', () => {
    it('should return valid for a correct random feature vector', () => {
      const features = generateRandom();
      const result = validate(features);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should report missing product features', () => {
      const features = generateRandom();
      (features as any).product = undefined;
      const result = validate(features);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing product features');
    });

    it('should report missing condition features', () => {
      const features = generateRandom();
      (features as any).condition = undefined;
      const result = validate(features);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing condition features');
    });

    it('should report missing demand features', () => {
      const features = generateRandom();
      (features as any).demand = undefined;
      const result = validate(features);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing demand features');
    });

    it('should report missing location features', () => {
      const features = generateRandom();
      (features as any).location = undefined;
      const result = validate(features);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing location features');
    });

    it('should report missing financial features', () => {
      const features = generateRandom();
      (features as any).financial = undefined;
      const result = validate(features);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing financial features');
    });

    it('should report out-of-range values', () => {
      const features = generateRandom();
      features.product.mrp = 200000; // above max 150000
      const result = validate(features);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('product.mrp out of range'))).toBe(true);
    });

    it('should report currentMarketPrice exceeding MRP', () => {
      const features = generateRandom();
      features.product.mrp = 1000;
      features.product.currentMarketPrice = 2000;
      const result = validate(features);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('exceeds product.mrp'))).toBe(true);
    });

    it('should report missing metadata', () => {
      const features = generateRandom();
      (features as any).metadata = undefined;
      const result = validate(features);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing metadata');
    });
  });
});
