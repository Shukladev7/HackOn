import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  computeMetricsFromRecords,
  computeChange,
  MetricsService,
  SystemMetrics,
  AnomalyAlert,
  calculateMean,
  calculateStdDev,
  detectAnomaly,
  checkAllAnomalies,
  ANOMALY_MIN_DATA_POINTS,
  ANOMALY_DEVIATION_THRESHOLD,
} from './metricsService';
import { DecisionRecord } from '../models/DecisionRecord';
import { ReallocationEvent } from '../models/ReallocationEvent';

describe('metricsService', () => {
  describe('computeMetricsFromRecords', () => {
    it('should return zero metrics when no decisions exist', () => {
      const result = computeMetricsFromRecords([], 0, 0);

      expect(result.rtoReductionRate).toBe(0);
      expect(result.reverseLogisticsSavings).toBe(0);
      expect(result.deliverySuccessRate).toBe(0);
      expect(result.inventoryRecoveryRate).toBe(0);
      expect(result.co2Reduction).toBe(0);
      expect(result.customerSatisfaction).toBe(3.5);
    });

    it('should compute 100% RTO reduction rate when all events avoid warehouse return', () => {
      const decisions = [
        { action: 'redeliver' as const },
        { action: 'reallocate' as const },
        { action: 'redeliver' as const },
      ];

      const result = computeMetricsFromRecords(decisions, 1, 2);

      expect(result.rtoReductionRate).toBe(100);
    });

    it('should compute 0% RTO reduction rate when all events go to warehouse', () => {
      const decisions = [
        { action: 'warehouse_return' as const },
        { action: 'warehouse_return' as const },
      ];

      const result = computeMetricsFromRecords(decisions, 0, 0);

      expect(result.rtoReductionRate).toBe(0);
    });

    it('should compute correct RTO reduction rate for mixed decisions', () => {
      const decisions = [
        { action: 'redeliver' as const },
        { action: 'reallocate' as const },
        { action: 'warehouse_return' as const },
        { action: 'redeliver' as const },
      ];

      const result = computeMetricsFromRecords(decisions, 1, 2);

      // 3 out of 4 are non-warehouse = 75%
      expect(result.rtoReductionRate).toBe(75);
    });

    it('should compute positive reverse logistics savings for non-warehouse decisions', () => {
      const decisions = [
        { action: 'redeliver' as const },
        { action: 'reallocate' as const },
      ];

      const result = computeMetricsFromRecords(decisions, 1, 1);

      // Without system: 2 * 150 = 300
      // Actual: 1 * 60 + 1 * 40 = 100
      // Savings per package: (300 - 100) / 2 = 100
      expect(result.reverseLogisticsSavings).toBe(100);
    });

    it('should compute zero savings when all go to warehouse', () => {
      const decisions = [
        { action: 'warehouse_return' as const },
        { action: 'warehouse_return' as const },
      ];

      const result = computeMetricsFromRecords(decisions, 0, 0);

      expect(result.reverseLogisticsSavings).toBe(0);
    });

    it('should compute delivery success rate from redelivery and successful reallocations', () => {
      const decisions = [
        { action: 'redeliver' as const },
        { action: 'redeliver' as const },
        { action: 'reallocate' as const },
        { action: 'reallocate' as const },
        { action: 'warehouse_return' as const },
      ];

      // 2 redeliveries + 1 successful reallocation out of 4 interventions (2 redeliver + 2 reallocate)
      const result = computeMetricsFromRecords(decisions, 1, 3);

      // (2 + 1) / (2 + 2) * 100 = 75%
      expect(result.deliverySuccessRate).toBe(75);
    });

    it('should compute 0% delivery success rate when no interventions', () => {
      const decisions = [
        { action: 'warehouse_return' as const },
      ];

      const result = computeMetricsFromRecords(decisions, 0, 0);

      expect(result.deliverySuccessRate).toBe(0);
    });

    it('should compute inventory recovery rate from successful reallocations over eligible', () => {
      const decisions = [
        { action: 'reallocate' as const },
        { action: 'reallocate' as const },
        { action: 'redeliver' as const },
      ];

      // 2 successful reallocations out of 5 eligible
      const result = computeMetricsFromRecords(decisions, 2, 5);

      expect(result.inventoryRecoveryRate).toBe(40);
    });

    it('should compute 0% inventory recovery rate when no eligible packages', () => {
      const decisions = [
        { action: 'warehouse_return' as const },
      ];

      const result = computeMetricsFromRecords(decisions, 0, 0);

      expect(result.inventoryRecoveryRate).toBe(0);
    });

    it('should compute positive CO₂ reduction for non-warehouse decisions', () => {
      const decisions = [
        { action: 'reallocate' as const },
      ];

      const result = computeMetricsFromRecords(decisions, 1, 1);

      // Reallocation: (200 - 25) * 0.12 = 21.0 kg CO₂ saved
      // Per package: 21.0 / 1 = 21.0
      expect(result.co2Reduction).toBe(21);
    });

    it('should compute CO₂ reduction for redelivery with partial savings', () => {
      const decisions = [
        { action: 'redeliver' as const },
      ];

      const result = computeMetricsFromRecords(decisions, 0, 1);

      // Redelivery: 200 * 0.5 * 0.12 = 12.0 kg CO₂ saved
      expect(result.co2Reduction).toBe(12);
    });

    it('should compute customer satisfaction between 1 and 5', () => {
      const decisions = [
        { action: 'redeliver' as const },
        { action: 'reallocate' as const },
        { action: 'warehouse_return' as const },
      ];

      const result = computeMetricsFromRecords(decisions, 1, 2);

      expect(result.customerSatisfaction).toBeGreaterThanOrEqual(1);
      expect(result.customerSatisfaction).toBeLessThanOrEqual(5);
    });

    it('should cap customer satisfaction at 5', () => {
      const decisions = [
        { action: 'redeliver' as const },
        { action: 'reallocate' as const },
      ];

      const result = computeMetricsFromRecords(decisions, 1, 1);

      // 100% reduction rate → base 3.0 + bonus 2.0 = 5.0
      expect(result.customerSatisfaction).toBe(5);
    });

    it('should produce minimum satisfaction of 3.0 when all warehouse return', () => {
      const decisions = [
        { action: 'warehouse_return' as const },
        { action: 'warehouse_return' as const },
      ];

      const result = computeMetricsFromRecords(decisions, 0, 0);

      // 0% reduction → base 3.0 + 0 = 3.0
      expect(result.customerSatisfaction).toBe(3);
    });

    it('should return all metrics rounded to 2 decimal places', () => {
      const decisions = [
        { action: 'redeliver' as const },
        { action: 'reallocate' as const },
        { action: 'warehouse_return' as const },
      ];

      const result = computeMetricsFromRecords(decisions, 1, 2);

      const decimalPlaces = (n: number) => {
        const str = n.toString();
        const idx = str.indexOf('.');
        return idx === -1 ? 0 : str.length - idx - 1;
      };

      expect(decimalPlaces(result.rtoReductionRate)).toBeLessThanOrEqual(2);
      expect(decimalPlaces(result.reverseLogisticsSavings)).toBeLessThanOrEqual(2);
      expect(decimalPlaces(result.deliverySuccessRate)).toBeLessThanOrEqual(2);
      expect(decimalPlaces(result.inventoryRecoveryRate)).toBeLessThanOrEqual(2);
      expect(decimalPlaces(result.co2Reduction)).toBeLessThanOrEqual(2);
      expect(decimalPlaces(result.customerSatisfaction)).toBeLessThanOrEqual(2);
    });
  });

  describe('computeChange', () => {
    it('should compute 0% change when current equals previous', () => {
      const metrics: SystemMetrics = {
        rtoReductionRate: 50,
        reverseLogisticsSavings: 100,
        deliverySuccessRate: 75,
        inventoryRecoveryRate: 40,
        co2Reduction: 15,
        customerSatisfaction: 4.2,
      };

      const change = computeChange(metrics, metrics);

      expect(change.rtoReductionRate).toBe(0);
      expect(change.reverseLogisticsSavings).toBe(0);
      expect(change.deliverySuccessRate).toBe(0);
      expect(change.inventoryRecoveryRate).toBe(0);
      expect(change.co2Reduction).toBe(0);
      expect(change.customerSatisfaction).toBe(0);
    });

    it('should compute positive change when current is greater than previous', () => {
      const current: SystemMetrics = {
        rtoReductionRate: 60,
        reverseLogisticsSavings: 120,
        deliverySuccessRate: 80,
        inventoryRecoveryRate: 50,
        co2Reduction: 20,
        customerSatisfaction: 4.5,
      };
      const previous: SystemMetrics = {
        rtoReductionRate: 50,
        reverseLogisticsSavings: 100,
        deliverySuccessRate: 75,
        inventoryRecoveryRate: 40,
        co2Reduction: 15,
        customerSatisfaction: 4.0,
      };

      const change = computeChange(current, previous);

      // (60-50)/50 * 100 = 20%
      expect(change.rtoReductionRate).toBe(20);
      // (120-100)/100 * 100 = 20%
      expect(change.reverseLogisticsSavings).toBe(20);
      // (80-75)/75 * 100 = 6.67%
      expect(change.deliverySuccessRate).toBeCloseTo(6.67, 1);
      // (50-40)/40 * 100 = 25%
      expect(change.inventoryRecoveryRate).toBe(25);
      // (20-15)/15 * 100 = 33.33%
      expect(change.co2Reduction).toBeCloseTo(33.33, 1);
      // (4.5-4.0)/4.0 * 100 = 12.5%
      expect(change.customerSatisfaction).toBe(12.5);
    });

    it('should compute negative change when current is less than previous', () => {
      const current: SystemMetrics = {
        rtoReductionRate: 40,
        reverseLogisticsSavings: 80,
        deliverySuccessRate: 60,
        inventoryRecoveryRate: 30,
        co2Reduction: 10,
        customerSatisfaction: 3.5,
      };
      const previous: SystemMetrics = {
        rtoReductionRate: 50,
        reverseLogisticsSavings: 100,
        deliverySuccessRate: 75,
        inventoryRecoveryRate: 40,
        co2Reduction: 15,
        customerSatisfaction: 4.0,
      };

      const change = computeChange(current, previous);

      expect(change.rtoReductionRate).toBe(-20);
      expect(change.reverseLogisticsSavings).toBe(-20);
    });

    it('should return 100% when previous was 0 and current is positive', () => {
      const current: SystemMetrics = {
        rtoReductionRate: 50,
        reverseLogisticsSavings: 100,
        deliverySuccessRate: 75,
        inventoryRecoveryRate: 40,
        co2Reduction: 15,
        customerSatisfaction: 4.2,
      };
      const previous: SystemMetrics = {
        rtoReductionRate: 0,
        reverseLogisticsSavings: 0,
        deliverySuccessRate: 0,
        inventoryRecoveryRate: 0,
        co2Reduction: 0,
        customerSatisfaction: 0,
      };

      const change = computeChange(current, previous);

      expect(change.rtoReductionRate).toBe(100);
      expect(change.reverseLogisticsSavings).toBe(100);
    });

    it('should return 0% when both current and previous are 0', () => {
      const zero: SystemMetrics = {
        rtoReductionRate: 0,
        reverseLogisticsSavings: 0,
        deliverySuccessRate: 0,
        inventoryRecoveryRate: 0,
        co2Reduction: 0,
        customerSatisfaction: 0,
      };

      const change = computeChange(zero, zero);

      expect(change.rtoReductionRate).toBe(0);
      expect(change.reverseLogisticsSavings).toBe(0);
    });
  });

  describe('MetricsService class', () => {
    let service: MetricsService;

    beforeEach(() => {
      service = new MetricsService();
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-06-15T12:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    describe('getCurrentMetrics', () => {
      it('should query database with correct date range for weekly window', async () => {
        const findSpy = vi.spyOn(DecisionRecord, 'find').mockReturnValue({
          lean: () => Promise.resolve([
            { action: 'redeliver' },
            { action: 'reallocate' },
            { action: 'warehouse_return' },
          ]),
        } as any);

        const countDocsSpy = vi.spyOn(ReallocationEvent, 'countDocuments')
          .mockResolvedValue(1);
        vi.spyOn(DecisionRecord, 'countDocuments').mockResolvedValue(2);

        const result = await service.getCurrentMetrics('weekly');

        expect(findSpy).toHaveBeenCalledWith(
          {
            decidedAt: {
              $gte: expect.any(Date),
              $lte: expect.any(Date),
            },
          },
          { action: 1 }
        );

        // Verify the date range is 7 days
        const call = findSpy.mock.calls[0][0] as any;
        const start = call.decidedAt.$gte as Date;
        const end = call.decidedAt.$lte as Date;
        const diffDays = (end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000);
        expect(diffDays).toBeCloseTo(7, 0);

        // 2 out of 3 non-warehouse = 66.67%
        expect(result.rtoReductionRate).toBeCloseTo(66.67, 1);
      });

      it('should query database with correct date range for daily window', async () => {
        vi.spyOn(DecisionRecord, 'find').mockReturnValue({
          lean: () => Promise.resolve([]),
        } as any);
        vi.spyOn(ReallocationEvent, 'countDocuments').mockResolvedValue(0);
        vi.spyOn(DecisionRecord, 'countDocuments').mockResolvedValue(0);

        const result = await service.getCurrentMetrics('daily');

        expect(result.rtoReductionRate).toBe(0);
      });

      it('should query database with correct date range for monthly window', async () => {
        const findSpy = vi.spyOn(DecisionRecord, 'find').mockReturnValue({
          lean: () => Promise.resolve([
            { action: 'redeliver' },
          ]),
        } as any);
        vi.spyOn(ReallocationEvent, 'countDocuments').mockResolvedValue(0);
        vi.spyOn(DecisionRecord, 'countDocuments').mockResolvedValue(1);

        const result = await service.getCurrentMetrics('monthly');

        const call = findSpy.mock.calls[0][0] as any;
        const start = call.decidedAt.$gte as Date;
        const end = call.decidedAt.$lte as Date;
        const diffDays = (end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000);
        expect(diffDays).toBeCloseTo(30, 0);

        expect(result.rtoReductionRate).toBe(100);
      });

      it('should default to weekly window when no parameter provided', async () => {
        const findSpy = vi.spyOn(DecisionRecord, 'find').mockReturnValue({
          lean: () => Promise.resolve([]),
        } as any);
        vi.spyOn(ReallocationEvent, 'countDocuments').mockResolvedValue(0);
        vi.spyOn(DecisionRecord, 'countDocuments').mockResolvedValue(0);

        await service.getCurrentMetrics();

        const call = findSpy.mock.calls[0][0] as any;
        const start = call.decidedAt.$gte as Date;
        const end = call.decidedAt.$lte as Date;
        const diffDays = (end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000);
        expect(diffDays).toBeCloseTo(7, 0);
      });
    });

    describe('getHistoricalComparison', () => {
      it('should return current, previous, and change for daily comparison', async () => {
        let callCount = 0;
        vi.spyOn(DecisionRecord, 'find').mockImplementation(() => {
          callCount++;
          // First call is current, second is previous
          if (callCount === 1) {
            return { lean: () => Promise.resolve([
              { action: 'redeliver' },
              { action: 'reallocate' },
            ]) } as any;
          }
          return { lean: () => Promise.resolve([
            { action: 'warehouse_return' },
            { action: 'redeliver' },
          ]) } as any;
        });

        let reallocationCallCount = 0;
        vi.spyOn(ReallocationEvent, 'countDocuments').mockImplementation(() => {
          reallocationCallCount++;
          return Promise.resolve(reallocationCallCount === 1 ? 1 : 0) as any;
        });

        let decisionCountCallCount = 0;
        vi.spyOn(DecisionRecord, 'countDocuments').mockImplementation(() => {
          decisionCountCallCount++;
          return Promise.resolve(decisionCountCallCount === 1 ? 2 : 1) as any;
        });

        const result = await service.getHistoricalComparison('daily');

        expect(result.current).toBeDefined();
        expect(result.previous).toBeDefined();
        expect(result.change).toBeDefined();

        // Current: 2/2 non-warehouse = 100%
        expect(result.current.rtoReductionRate).toBe(100);
        // Previous: 1/2 non-warehouse = 50%
        expect(result.previous.rtoReductionRate).toBe(50);
        // Change: (100 - 50) / 50 * 100 = 100%
        expect(result.change.rtoReductionRate).toBe(100);
      });

      it('should handle period parameter for weekly comparison', async () => {
        vi.spyOn(DecisionRecord, 'find').mockReturnValue({
          lean: () => Promise.resolve([]),
        } as any);
        vi.spyOn(ReallocationEvent, 'countDocuments').mockResolvedValue(0);
        vi.spyOn(DecisionRecord, 'countDocuments').mockResolvedValue(0);

        const result = await service.getHistoricalComparison('weekly');

        expect(result.current.rtoReductionRate).toBe(0);
        expect(result.previous.rtoReductionRate).toBe(0);
        expect(result.change.rtoReductionRate).toBe(0);
      });

      it('should handle period parameter for monthly comparison', async () => {
        vi.spyOn(DecisionRecord, 'find').mockReturnValue({
          lean: () => Promise.resolve([{ action: 'redeliver' }]),
        } as any);
        vi.spyOn(ReallocationEvent, 'countDocuments').mockResolvedValue(0);
        vi.spyOn(DecisionRecord, 'countDocuments').mockResolvedValue(1);

        const result = await service.getHistoricalComparison('monthly');

        expect(result.current.rtoReductionRate).toBe(100);
        expect(result.previous.rtoReductionRate).toBe(100);
        expect(result.change.rtoReductionRate).toBe(0);
      });
    });
  });
});


describe('Anomaly Detection', () => {
  describe('calculateMean', () => {
    it('should return 0 for empty array', () => {
      expect(calculateMean([])).toBe(0);
    });

    it('should return the value itself for single-element array', () => {
      expect(calculateMean([5])).toBe(5);
    });

    it('should compute correct mean for multiple values', () => {
      expect(calculateMean([1, 2, 3, 4, 5])).toBe(3);
    });

    it('should handle negative values', () => {
      expect(calculateMean([-2, 0, 2])).toBe(0);
    });

    it('should handle decimal values', () => {
      expect(calculateMean([1.5, 2.5, 3.0])).toBeCloseTo(2.333, 2);
    });
  });

  describe('calculateStdDev', () => {
    it('should return 0 for empty array', () => {
      expect(calculateStdDev([])).toBe(0);
    });

    it('should return 0 for single-element array', () => {
      expect(calculateStdDev([5])).toBe(0);
    });

    it('should return 0 when all values are identical', () => {
      expect(calculateStdDev([3, 3, 3, 3])).toBe(0);
    });

    it('should compute correct population standard deviation', () => {
      // Mean = 3, variance = ((1-3)^2 + (2-3)^2 + (3-3)^2 + (4-3)^2 + (5-3)^2) / 5 = 10/5 = 2
      // stddev = sqrt(2) ≈ 1.414
      expect(calculateStdDev([1, 2, 3, 4, 5])).toBeCloseTo(Math.sqrt(2), 5);
    });

    it('should use provided mean if given', () => {
      const values = [1, 2, 3, 4, 5];
      const mean = 3;
      expect(calculateStdDev(values, mean)).toBeCloseTo(Math.sqrt(2), 5);
    });
  });

  describe('detectAnomaly', () => {
    it('should return null when fewer than 30 data points (Requirement 13.5)', () => {
      const history = Array(29).fill(50);
      const result = detectAnomaly('rtoReductionRate', 50, history);
      expect(result).toBeNull();
    });

    it('should return null for exactly 0 data points', () => {
      const result = detectAnomaly('rtoReductionRate', 50, []);
      expect(result).toBeNull();
    });

    it('should return null when value is within 2 standard deviations', () => {
      // 30 data points with mean=50, stddev≈2.87
      const history = Array.from({ length: 30 }, (_, i) => 45 + i % 10);
      const mean = calculateMean(history);
      const stdDev = calculateStdDev(history);

      // A value within 2σ of the mean
      const withinRange = mean + stdDev; // Only 1σ away
      const result = detectAnomaly('rtoReductionRate', withinRange, history);
      expect(result).toBeNull();
    });

    it('should generate alert when value exceeds 2 standard deviations above mean (Requirement 13.4)', () => {
      // Create 30 data points with known distribution
      const history = Array(30).fill(50); // Mean=50, stdDev=0... need variation
      // Use values with some variation
      const historyWithVariation = Array.from({ length: 30 }, (_, i) => 50 + (i % 3) - 1);
      // Mean ≈ 50, stdDev is small
      const mean = calculateMean(historyWithVariation);
      const stdDev = calculateStdDev(historyWithVariation);

      // Value far above mean
      const anomalousValue = mean + 3 * stdDev;
      const result = detectAnomaly('rtoReductionRate', anomalousValue, historyWithVariation);

      expect(result).not.toBeNull();
      expect(result!.metricName).toBe('rtoReductionRate');
      expect(result!.currentValue).toBe(anomalousValue);
      expect(result!.deviationMagnitude).toBeGreaterThan(2);
      expect(result!.expectedRange.low).toBeLessThan(anomalousValue);
      expect(result!.expectedRange.high).toBeLessThan(anomalousValue);
    });

    it('should generate alert when value exceeds 2 standard deviations below mean', () => {
      const historyWithVariation = Array.from({ length: 30 }, (_, i) => 50 + (i % 5) - 2);
      const mean = calculateMean(historyWithVariation);
      const stdDev = calculateStdDev(historyWithVariation);

      // Value far below mean
      const anomalousValue = mean - 3 * stdDev;
      const result = detectAnomaly('deliverySuccessRate', anomalousValue, historyWithVariation);

      expect(result).not.toBeNull();
      expect(result!.metricName).toBe('deliverySuccessRate');
      expect(result!.currentValue).toBe(anomalousValue);
      expect(result!.deviationMagnitude).toBeGreaterThan(2);
      expect(result!.expectedRange.low).toBeGreaterThan(anomalousValue);
    });

    it('should return null when value equals the mean exactly', () => {
      const history = Array.from({ length: 30 }, (_, i) => 50 + (i % 4) - 1.5);
      const mean = calculateMean(history);

      const result = detectAnomaly('co2Reduction', mean, history);
      expect(result).toBeNull();
    });

    it('should handle stdDev of 0 - same value as history returns null', () => {
      const history = Array(30).fill(42);
      const result = detectAnomaly('customerSatisfaction', 42, history);
      expect(result).toBeNull();
    });

    it('should handle stdDev of 0 - different value generates alert', () => {
      const history = Array(30).fill(42);
      const result = detectAnomaly('customerSatisfaction', 50, history);

      expect(result).not.toBeNull();
      expect(result!.metricName).toBe('customerSatisfaction');
      expect(result!.currentValue).toBe(50);
      expect(result!.expectedRange.low).toBe(42);
      expect(result!.expectedRange.high).toBe(42);
      expect(result!.deviationMagnitude).toBe(8); // |50 - 42| = 8
    });

    it('should use only the most recent 30 data points when more are provided', () => {
      // First 20 points are very high (should be ignored)
      const oldPoints = Array(20).fill(100);
      // Most recent 30 points are around 50
      const recentPoints = Array.from({ length: 30 }, (_, i) => 50 + (i % 3) - 1);
      const allPoints = [...oldPoints, ...recentPoints];

      const mean = calculateMean(recentPoints);
      const stdDev = calculateStdDev(recentPoints);

      // Value within range of recent points but far from old points
      const result = detectAnomaly('rtoReductionRate', mean, allPoints);
      expect(result).toBeNull(); // Should be normal relative to recent 30 points
    });

    it('should include correct expected range in alert (mean ± 2σ)', () => {
      const history = Array.from({ length: 30 }, (_, i) => 50 + (i % 6) - 2.5);
      const mean = calculateMean(history);
      const stdDev = calculateStdDev(history);

      const anomalousValue = mean + 5 * stdDev; // Way out of range
      const result = detectAnomaly('inventoryRecoveryRate', anomalousValue, history);

      expect(result).not.toBeNull();
      const expectedLow = mean - 2 * stdDev;
      const expectedHigh = mean + 2 * stdDev;
      expect(result!.expectedRange.low).toBeCloseTo(expectedLow, 1);
      expect(result!.expectedRange.high).toBeCloseTo(expectedHigh, 1);
    });

    it('should include detectedAt timestamp in ISO format', () => {
      const history = Array(30).fill(50);
      const result = detectAnomaly('rtoReductionRate', 100, history);

      expect(result).not.toBeNull();
      expect(result!.detectedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('should not alert when deviation is exactly 2 standard deviations (boundary)', () => {
      // Create data with known mean and stdDev
      // 15 values of 48, 15 values of 52 -> mean=50, stdDev=2
      const history = [...Array(15).fill(48), ...Array(15).fill(52)];
      const mean = calculateMean(history);
      const stdDev = calculateStdDev(history);

      // Exactly 2σ away - should NOT alert (requirement says > 2σ)
      const boundaryValue = mean + 2 * stdDev;
      const result = detectAnomaly('rtoReductionRate', boundaryValue, history);
      expect(result).toBeNull();
    });

    it('should alert when deviation is just above 2 standard deviations', () => {
      const history = [...Array(15).fill(48), ...Array(15).fill(52)];
      const mean = calculateMean(history);
      const stdDev = calculateStdDev(history);

      // Slightly more than 2σ away
      const justAbove = mean + 2.01 * stdDev;
      const result = detectAnomaly('rtoReductionRate', justAbove, history);
      expect(result).not.toBeNull();
    });
  });

  describe('checkAllAnomalies', () => {
    it('should return empty array when no metrics have anomalies', () => {
      const currentMetrics: SystemMetrics = {
        rtoReductionRate: 50,
        reverseLogisticsSavings: 100,
        deliverySuccessRate: 75,
        inventoryRecoveryRate: 40,
        co2Reduction: 15,
        customerSatisfaction: 4.0,
      };

      const historicalData = new Map<string, number[]>();
      historicalData.set('rtoReductionRate', Array.from({ length: 30 }, () => 50 + Math.random() * 2 - 1));
      historicalData.set('reverseLogisticsSavings', Array.from({ length: 30 }, () => 100 + Math.random() * 5 - 2.5));
      historicalData.set('deliverySuccessRate', Array.from({ length: 30 }, () => 75 + Math.random() * 3 - 1.5));
      historicalData.set('inventoryRecoveryRate', Array.from({ length: 30 }, () => 40 + Math.random() * 2 - 1));
      historicalData.set('co2Reduction', Array.from({ length: 30 }, () => 15 + Math.random() * 1 - 0.5));
      historicalData.set('customerSatisfaction', Array.from({ length: 30 }, () => 4.0 + Math.random() * 0.2 - 0.1));

      const alerts = checkAllAnomalies(currentMetrics, historicalData);
      expect(alerts).toEqual([]);
    });

    it('should return alerts only for metrics that exceed threshold', () => {
      const currentMetrics: SystemMetrics = {
        rtoReductionRate: 90, // Anomalous - way above normal 50
        reverseLogisticsSavings: 100,
        deliverySuccessRate: 75,
        inventoryRecoveryRate: 40,
        co2Reduction: 15,
        customerSatisfaction: 4.0,
      };

      const historicalData = new Map<string, number[]>();
      historicalData.set('rtoReductionRate', Array(30).fill(50)); // σ=0, 90≠50 → alert
      historicalData.set('reverseLogisticsSavings', Array(30).fill(100)); // σ=0, 100=100 → no alert
      historicalData.set('deliverySuccessRate', Array(30).fill(75)); // σ=0, 75=75 → no alert
      historicalData.set('inventoryRecoveryRate', Array(30).fill(40)); // σ=0, 40=40 → no alert
      historicalData.set('co2Reduction', Array(30).fill(15)); // σ=0, 15=15 → no alert
      historicalData.set('customerSatisfaction', Array(30).fill(4.0)); // σ=0, 4=4 → no alert

      const alerts = checkAllAnomalies(currentMetrics, historicalData);
      expect(alerts).toHaveLength(1);
      expect(alerts[0].metricName).toBe('rtoReductionRate');
      expect(alerts[0].currentValue).toBe(90);
    });

    it('should return empty array when historical data has fewer than 30 points for all metrics', () => {
      const currentMetrics: SystemMetrics = {
        rtoReductionRate: 90,
        reverseLogisticsSavings: 200,
        deliverySuccessRate: 10,
        inventoryRecoveryRate: 5,
        co2Reduction: 50,
        customerSatisfaction: 1.0,
      };

      const historicalData = new Map<string, number[]>();
      // Only 20 points — insufficient for anomaly detection
      historicalData.set('rtoReductionRate', Array(20).fill(50));
      historicalData.set('reverseLogisticsSavings', Array(20).fill(100));
      historicalData.set('deliverySuccessRate', Array(20).fill(75));
      historicalData.set('inventoryRecoveryRate', Array(20).fill(40));
      historicalData.set('co2Reduction', Array(20).fill(15));
      historicalData.set('customerSatisfaction', Array(20).fill(4.0));

      const alerts = checkAllAnomalies(currentMetrics, historicalData);
      expect(alerts).toEqual([]);
    });

    it('should handle missing metrics in historical data gracefully', () => {
      const currentMetrics: SystemMetrics = {
        rtoReductionRate: 90,
        reverseLogisticsSavings: 100,
        deliverySuccessRate: 75,
        inventoryRecoveryRate: 40,
        co2Reduction: 15,
        customerSatisfaction: 4.0,
      };

      // Empty map — no history for any metric
      const historicalData = new Map<string, number[]>();

      const alerts = checkAllAnomalies(currentMetrics, historicalData);
      expect(alerts).toEqual([]);
    });

    it('should detect multiple anomalies across different metrics', () => {
      const currentMetrics: SystemMetrics = {
        rtoReductionRate: 90,  // Anomalous (history is 50)
        reverseLogisticsSavings: 100,
        deliverySuccessRate: 10, // Anomalous (history is 75)
        inventoryRecoveryRate: 40,
        co2Reduction: 15,
        customerSatisfaction: 4.0,
      };

      const historicalData = new Map<string, number[]>();
      historicalData.set('rtoReductionRate', Array(30).fill(50));
      historicalData.set('reverseLogisticsSavings', Array(30).fill(100));
      historicalData.set('deliverySuccessRate', Array(30).fill(75));
      historicalData.set('inventoryRecoveryRate', Array(30).fill(40));
      historicalData.set('co2Reduction', Array(30).fill(15));
      historicalData.set('customerSatisfaction', Array(30).fill(4.0));

      const alerts = checkAllAnomalies(currentMetrics, historicalData);
      expect(alerts).toHaveLength(2);

      const metricNames = alerts.map(a => a.metricName);
      expect(metricNames).toContain('rtoReductionRate');
      expect(metricNames).toContain('deliverySuccessRate');
    });
  });

  describe('MetricsService.checkAnomalies', () => {
    let service: MetricsService;

    beforeEach(() => {
      service = new MetricsService();
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-06-15T12:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    it('should accept pre-computed metrics and historical data', async () => {
      const currentMetrics: SystemMetrics = {
        rtoReductionRate: 90, // Anomalous
        reverseLogisticsSavings: 100,
        deliverySuccessRate: 75,
        inventoryRecoveryRate: 40,
        co2Reduction: 15,
        customerSatisfaction: 4.0,
      };

      const historicalData = new Map<string, number[]>();
      historicalData.set('rtoReductionRate', Array(30).fill(50));
      historicalData.set('reverseLogisticsSavings', Array(30).fill(100));
      historicalData.set('deliverySuccessRate', Array(30).fill(75));
      historicalData.set('inventoryRecoveryRate', Array(30).fill(40));
      historicalData.set('co2Reduction', Array(30).fill(15));
      historicalData.set('customerSatisfaction', Array(30).fill(4.0));

      const alerts = await service.checkAnomalies(currentMetrics, historicalData);
      expect(alerts).toHaveLength(1);
      expect(alerts[0].metricName).toBe('rtoReductionRate');
    });

    it('should return empty alerts when data is insufficient', async () => {
      const currentMetrics: SystemMetrics = {
        rtoReductionRate: 90,
        reverseLogisticsSavings: 200,
        deliverySuccessRate: 10,
        inventoryRecoveryRate: 5,
        co2Reduction: 50,
        customerSatisfaction: 1.0,
      };

      // Only 10 data points — insufficient
      const historicalData = new Map<string, number[]>();
      historicalData.set('rtoReductionRate', Array(10).fill(50));
      historicalData.set('reverseLogisticsSavings', Array(10).fill(100));
      historicalData.set('deliverySuccessRate', Array(10).fill(75));
      historicalData.set('inventoryRecoveryRate', Array(10).fill(40));
      historicalData.set('co2Reduction', Array(10).fill(15));
      historicalData.set('customerSatisfaction', Array(10).fill(4.0));

      const alerts = await service.checkAnomalies(currentMetrics, historicalData);
      expect(alerts).toEqual([]);
    });

    it('should fetch metrics from DB when currentMetrics not provided', async () => {
      vi.spyOn(DecisionRecord, 'find').mockReturnValue({
        lean: () => Promise.resolve([
          { action: 'redeliver' },
          { action: 'reallocate' },
        ]),
      } as any);
      vi.spyOn(ReallocationEvent, 'countDocuments').mockResolvedValue(1);
      vi.spyOn(DecisionRecord, 'countDocuments').mockResolvedValue(2);

      const historicalData = new Map<string, number[]>();
      // All metrics at same values as what the mocked data returns
      historicalData.set('rtoReductionRate', Array(30).fill(100));
      historicalData.set('reverseLogisticsSavings', Array(30).fill(100));
      historicalData.set('deliverySuccessRate', Array(30).fill(100));
      historicalData.set('inventoryRecoveryRate', Array(30).fill(50));
      historicalData.set('co2Reduction', Array(30).fill(16.5));
      historicalData.set('customerSatisfaction', Array(30).fill(5));

      const alerts = await service.checkAnomalies(undefined, historicalData);
      // Should not throw, and result depends on the computed current metrics vs history
      expect(Array.isArray(alerts)).toBe(true);
    });
  });

  describe('ANOMALY_MIN_DATA_POINTS constant', () => {
    it('should be 30', () => {
      expect(ANOMALY_MIN_DATA_POINTS).toBe(30);
    });
  });

  describe('ANOMALY_DEVIATION_THRESHOLD constant', () => {
    it('should be 2', () => {
      expect(ANOMALY_DEVIATION_THRESHOLD).toBe(2);
    });
  });
});
