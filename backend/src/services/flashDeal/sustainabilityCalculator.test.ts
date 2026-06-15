import { describe, it, expect } from 'vitest';
import { calculate, calculateAggregate, AggregateSustainability } from './sustainabilityCalculator';
import type { DispositionDecision } from './types';

describe('sustainabilityCalculator', () => {
  describe('calculate', () => {
    it('returns all zeros for WAREHOUSE_RETURN disposition', () => {
      const result = calculate(25, 'WAREHOUSE_RETURN');
      expect(result).toEqual({
        traditionalDistance: 0,
        flashDealDistance: 0,
        distanceSaved: 0,
        co2Saved: 0,
      });
    });

    it('computes correct metrics for FLASH_DEAL disposition', () => {
      const distanceToBuyers = 15;
      const result = calculate(distanceToBuyers, 'FLASH_DEAL');

      // traditionalDistance = 15 + 100 = 115
      expect(result.traditionalDistance).toBe(115);
      // flashDealDistance = 15
      expect(result.flashDealDistance).toBe(15);
      // distanceSaved = 115 - 15 = 100
      expect(result.distanceSaved).toBe(100);
      // co2Saved = 100 * 0.027 = 2.7
      expect(result.co2Saved).toBe(2.7);
    });

    it('computes correct metrics for AMAZON_RENEWED disposition', () => {
      const result = calculate(30, 'AMAZON_RENEWED');

      expect(result.traditionalDistance).toBe(130);
      expect(result.flashDealDistance).toBe(30);
      expect(result.distanceSaved).toBe(100);
      expect(result.co2Saved).toBe(2.7);
    });

    it('computes correct metrics for NORMAL_RESALE disposition', () => {
      const result = calculate(50.5, 'NORMAL_RESALE');

      expect(result.traditionalDistance).toBe(150.5);
      expect(result.flashDealDistance).toBe(50.5);
      expect(result.distanceSaved).toBe(100);
      expect(result.co2Saved).toBe(2.7);
    });

    it('computes correct metrics for CIRCULAR_ROUTING disposition', () => {
      const result = calculate(0.5, 'CIRCULAR_ROUTING');

      expect(result.traditionalDistance).toBe(100.5);
      expect(result.flashDealDistance).toBe(0.5);
      expect(result.distanceSaved).toBe(100);
      expect(result.co2Saved).toBe(2.7);
    });

    it('rounds all values to 2 decimal places', () => {
      // distanceToBuyers = 33.333 should round to 33.33
      const result = calculate(33.333, 'FLASH_DEAL');

      expect(result.flashDealDistance).toBe(33.33);
      expect(result.traditionalDistance).toBe(133.33);
      expect(result.distanceSaved).toBe(100);
      expect(result.co2Saved).toBe(2.7);
    });

    it('handles zero distance to buyers', () => {
      const result = calculate(0, 'FLASH_DEAL');

      expect(result.traditionalDistance).toBe(100);
      expect(result.flashDealDistance).toBe(0);
      expect(result.distanceSaved).toBe(100);
      expect(result.co2Saved).toBe(2.7);
    });

    it('all non-WAREHOUSE_RETURN dispositions produce positive savings', () => {
      const dispositions: DispositionDecision[] = [
        'FLASH_DEAL',
        'AMAZON_RENEWED',
        'NORMAL_RESALE',
        'CIRCULAR_ROUTING',
      ];

      for (const disposition of dispositions) {
        const result = calculate(10, disposition);
        expect(result.distanceSaved).toBeGreaterThan(0);
        expect(result.co2Saved).toBeGreaterThan(0);
      }
    });
  });
});
