import { DecisionRecord, IDecisionRecord } from '../models/DecisionRecord';
import { ReallocationEvent } from '../models/ReallocationEvent';

/**
 * Anomaly alert interface as per design document.
 * Generated when a metric value deviates > 2 standard deviations from its 30-day moving average.
 *
 * Requirements: 13.4, 13.5
 */
export interface AnomalyAlert {
  metricName: string;
  currentValue: number;
  expectedRange: { low: number; high: number };
  deviationMagnitude: number; // in standard deviations
  detectedAt: string;
}

/**
 * Represents a single data point in a metric time series.
 */
export interface MetricDataPoint {
  value: number;
  recordedAt: Date;
}

/**
 * System metrics interface representing the key business KPIs
 * tracked by the RTO Reallocation Engine.
 */
export interface SystemMetrics {
  /** Percentage of RTO events resolved without warehouse return (7-day rolling) */
  rtoReductionRate: number;
  /** INR saved per package compared to full warehouse return */
  reverseLogisticsSavings: number;
  /** Percentage of redelivery + reallocation attempts resulting in successful delivery */
  deliverySuccessRate: number;
  /** Percentage of eligible packages successfully reallocated to new buyers */
  inventoryRecoveryRate: number;
  /** Estimated kg of CO₂ saved per package (based on distance not traveled) */
  co2Reduction: number;
  /** Customer satisfaction score (1-5 scale) collected post-delivery */
  customerSatisfaction: number;
}

export interface HistoricalComparison {
  current: SystemMetrics;
  previous: SystemMetrics;
  change: Record<keyof SystemMetrics, number>;
}

type MetricsPeriod = 'daily' | 'weekly' | 'monthly';

// Constants for metrics computation
const WAREHOUSE_RETURN_COST_INR = 150; // Average cost of full warehouse return per package
const REALLOCATION_COST_INR = 40; // Average cost of reallocation per package
const REDELIVERY_COST_INR = 60; // Average cost of redelivery per package
const CO2_PER_KM = 0.12; // kg CO₂ per km for logistics vehicles
const AVG_WAREHOUSE_RETURN_DISTANCE_KM = 200; // Average distance for warehouse return
const AVG_REALLOCATION_DISTANCE_KM = 25; // Average distance for reallocation
const DEFAULT_SATISFACTION_SCORE = 3.5; // Default when no data available

/**
 * Minimum number of data points required for anomaly detection.
 * When fewer than this threshold, anomaly detection is omitted (Requirement 13.5).
 */
export const ANOMALY_MIN_DATA_POINTS = 30;

/**
 * Standard deviation threshold for anomaly alerting (Requirement 13.4).
 * Alert when value deviates more than this many standard deviations from the mean.
 */
export const ANOMALY_DEVIATION_THRESHOLD = 2;

/**
 * Returns the start date for the given time window period.
 */
function getWindowStart(period: MetricsPeriod): Date {
  const now = new Date();
  switch (period) {
    case 'daily':
      return new Date(now.getTime() - 24 * 60 * 60 * 1000);
    case 'weekly':
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case 'monthly':
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }
}

/**
 * Returns the previous period's date range for historical comparison.
 */
function getPreviousPeriodRange(period: MetricsPeriod): { start: Date; end: Date } {
  const currentStart = getWindowStart(period);
  const now = new Date();
  const durationMs = now.getTime() - currentStart.getTime();
  return {
    start: new Date(currentStart.getTime() - durationMs),
    end: currentStart,
  };
}

function roundTo2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Computes metrics from a set of decision records and reallocation events.
 */
export function computeMetricsFromRecords(
  decisions: Pick<IDecisionRecord, 'action'>[],
  successfulReallocations: number,
  totalEligibleForReallocation: number
): SystemMetrics {
  const totalEvents = decisions.length;

  if (totalEvents === 0) {
    return {
      rtoReductionRate: 0,
      reverseLogisticsSavings: 0,
      deliverySuccessRate: 0,
      inventoryRecoveryRate: 0,
      co2Reduction: 0,
      customerSatisfaction: DEFAULT_SATISFACTION_SCORE,
    };
  }

  // RTO reduction rate: percentage of events NOT resulting in warehouse return
  const nonWarehouseEvents = decisions.filter(d => d.action !== 'warehouse_return').length;
  const rtoReductionRate = (nonWarehouseEvents / totalEvents) * 100;

  // Reverse logistics savings: INR per package saved compared to full warehouse return
  const redeliveryCount = decisions.filter(d => d.action === 'redeliver').length;
  const reallocationCount = decisions.filter(d => d.action === 'reallocate').length;
  const warehouseCount = decisions.filter(d => d.action === 'warehouse_return').length;

  const totalCostWithoutSystem = totalEvents * WAREHOUSE_RETURN_COST_INR;
  const actualCost =
    redeliveryCount * REDELIVERY_COST_INR +
    reallocationCount * REALLOCATION_COST_INR +
    warehouseCount * WAREHOUSE_RETURN_COST_INR;
  const reverseLogisticsSavings = (totalCostWithoutSystem - actualCost) / totalEvents;

  // Delivery success rate: percentage of redelivery + reallocation that succeeded
  const interventionCount = redeliveryCount + reallocationCount;
  const deliverySuccessRate =
    interventionCount > 0
      ? ((redeliveryCount + successfulReallocations) / interventionCount) * 100
      : 0;

  // Inventory recovery rate: percentage of eligible packages successfully reallocated
  const inventoryRecoveryRate =
    totalEligibleForReallocation > 0
      ? (successfulReallocations / totalEligibleForReallocation) * 100
      : 0;

  // CO₂ reduction: kg saved per package (distance not traveled to warehouse)
  const distanceSavedPerReallocation = AVG_WAREHOUSE_RETURN_DISTANCE_KM - AVG_REALLOCATION_DISTANCE_KM;
  const distanceSavedPerRedelivery = AVG_WAREHOUSE_RETURN_DISTANCE_KM * 0.5; // Partial savings
  const totalCo2Saved =
    reallocationCount * distanceSavedPerReallocation * CO2_PER_KM +
    redeliveryCount * distanceSavedPerRedelivery * CO2_PER_KM;
  const co2Reduction = totalCo2Saved / totalEvents;

  // Customer satisfaction: simulated based on intervention success
  const satisfactionBase = 3.0;
  const satisfactionBonus = (rtoReductionRate / 100) * 2.0;
  const customerSatisfaction = Math.min(5, Math.max(1, satisfactionBase + satisfactionBonus));

  return {
    rtoReductionRate: roundTo2(rtoReductionRate),
    reverseLogisticsSavings: roundTo2(reverseLogisticsSavings),
    deliverySuccessRate: roundTo2(deliverySuccessRate),
    inventoryRecoveryRate: roundTo2(inventoryRecoveryRate),
    co2Reduction: roundTo2(co2Reduction),
    customerSatisfaction: roundTo2(customerSatisfaction),
  };
}

/**
 * Computes period-over-period percentage change for each metric.
 */
export function computeChange(
  current: SystemMetrics,
  previous: SystemMetrics
): Record<keyof SystemMetrics, number> {
  const keys: (keyof SystemMetrics)[] = [
    'rtoReductionRate',
    'reverseLogisticsSavings',
    'deliverySuccessRate',
    'inventoryRecoveryRate',
    'co2Reduction',
    'customerSatisfaction',
  ];

  const change: Record<string, number> = {};
  for (const key of keys) {
    const prev = previous[key];
    if (prev === 0) {
      change[key] = current[key] > 0 ? 100 : 0;
    } else {
      change[key] = roundTo2(((current[key] - prev) / Math.abs(prev)) * 100);
    }
  }
  return change as Record<keyof SystemMetrics, number>;
}

// ─── Anomaly Detection ───────────────────────────────────────────────────────

/**
 * Calculates the mean of an array of numbers.
 */
export function calculateMean(values: number[]): number {
  if (values.length === 0) return 0;
  const sum = values.reduce((acc, v) => acc + v, 0);
  return sum / values.length;
}

/**
 * Calculates the population standard deviation of an array of numbers.
 */
export function calculateStdDev(values: number[], mean?: number): number {
  if (values.length === 0) return 0;
  const avg = mean ?? calculateMean(values);
  const squaredDiffs = values.map(v => (v - avg) ** 2);
  const variance = squaredDiffs.reduce((acc, v) => acc + v, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Detects anomalies for a single metric given its historical data points and current value.
 *
 * Returns an AnomalyAlert if the current value deviates more than 2 standard deviations
 * from the 30-day moving average. Returns null if no anomaly is detected or if there
 * are fewer than 30 data points (Requirement 13.5).
 *
 * Requirements: 13.4, 13.5
 */
export function detectAnomaly(
  metricName: string,
  currentValue: number,
  historicalDataPoints: number[]
): AnomalyAlert | null {
  // Omit anomaly detection when fewer than 30 data points available (Requirement 13.5)
  if (historicalDataPoints.length < ANOMALY_MIN_DATA_POINTS) {
    return null;
  }

  // Use the most recent 30 data points for the moving average
  const recentPoints = historicalDataPoints.slice(-ANOMALY_MIN_DATA_POINTS);

  const mean = calculateMean(recentPoints);
  const stdDev = calculateStdDev(recentPoints, mean);

  // If stdDev is 0, all values are identical — any different value is technically infinite deviation
  if (stdDev === 0) {
    if (currentValue === mean) {
      return null;
    }
    // When all historical values are the same but current differs, report as anomaly
    // Use the absolute difference as the deviation magnitude (since σ=0, this signals unusual behavior)
    return {
      metricName,
      currentValue,
      expectedRange: { low: roundTo2(mean), high: roundTo2(mean) },
      deviationMagnitude: roundTo2(Math.abs(currentValue - mean)),
      detectedAt: new Date().toISOString(),
    };
  }

  // Calculate how many standard deviations the current value is from the mean
  const deviationMagnitude = Math.abs(currentValue - mean) / stdDev;

  // Alert when deviation exceeds threshold (Requirement 13.4)
  if (deviationMagnitude > ANOMALY_DEVIATION_THRESHOLD) {
    const low = mean - ANOMALY_DEVIATION_THRESHOLD * stdDev;
    const high = mean + ANOMALY_DEVIATION_THRESHOLD * stdDev;

    return {
      metricName,
      currentValue,
      expectedRange: { low: roundTo2(low), high: roundTo2(high) },
      deviationMagnitude: roundTo2(deviationMagnitude),
      detectedAt: new Date().toISOString(),
    };
  }

  return null;
}

/**
 * Checks all system metrics for anomalies based on the 30-day moving average.
 * Returns a list of AnomalyAlert objects for any metrics that deviate > 2σ from the mean.
 *
 * Requirements: 13.4, 13.5
 *
 * @param currentMetrics - The current metrics snapshot
 * @param historicalData - Map of metric name to array of historical data point values (ordered oldest to newest)
 */
export function checkAllAnomalies(
  currentMetrics: SystemMetrics,
  historicalData: Map<string, number[]>
): AnomalyAlert[] {
  const alerts: AnomalyAlert[] = [];
  const metricNames: (keyof SystemMetrics)[] = [
    'rtoReductionRate',
    'reverseLogisticsSavings',
    'deliverySuccessRate',
    'inventoryRecoveryRate',
    'co2Reduction',
    'customerSatisfaction',
  ];

  for (const metricName of metricNames) {
    const history = historicalData.get(metricName) ?? [];
    const currentValue = currentMetrics[metricName];
    const alert = detectAnomaly(metricName, currentValue, history);
    if (alert) {
      alerts.push(alert);
    }
  }

  return alerts;
}

// ─── Database Queries ────────────────────────────────────────────────────────

/**
 * Fetches decision records for a given time window from the database.
 */
async function fetchDecisionRecords(start: Date, end: Date): Promise<Pick<IDecisionRecord, 'action'>[]> {
  return DecisionRecord.find(
    { decidedAt: { $gte: start, $lte: end } },
    { action: 1 }
  ).lean();
}

/**
 * Counts successful reallocations (completed status) in a time window.
 */
async function countSuccessfulReallocations(start: Date, end: Date): Promise<number> {
  return ReallocationEvent.countDocuments({
    status: 'completed',
    completedAt: { $gte: start, $lte: end },
  });
}

/**
 * Counts total packages eligible for reallocation (those that went through demand matching).
 */
async function countEligibleForReallocation(start: Date, end: Date): Promise<number> {
  return DecisionRecord.countDocuments({
    action: { $in: ['reallocate', 'redeliver'] },
    decidedAt: { $gte: start, $lte: end },
  });
}

// ─── MetricsService Class ────────────────────────────────────────────────────

/**
 * MetricsService provides business metrics for the RTO Reallocation Engine.
 * Computes RTO reduction rate, reverse logistics savings, delivery success rate,
 * inventory recovery rate, CO₂ reduction, and customer satisfaction.
 *
 * Requirements: 13.1, 13.2, 13.3, 13.4, 13.5
 */
export class MetricsService {
  /**
   * Get current system metrics for the specified time window.
   * Defaults to 'weekly' (7-day rolling window per requirement 13.1).
   */
  async getCurrentMetrics(window: MetricsPeriod = 'weekly'): Promise<SystemMetrics> {
    const start = getWindowStart(window);
    const end = new Date();

    const [decisions, successfulReallocations, eligibleForReallocation] = await Promise.all([
      fetchDecisionRecords(start, end),
      countSuccessfulReallocations(start, end),
      countEligibleForReallocation(start, end),
    ]);

    return computeMetricsFromRecords(decisions, successfulReallocations, eligibleForReallocation);
  }

  /**
   * Get historical comparison between the current period and the previous equivalent period.
   * Returns current metrics, previous metrics, and percentage change.
   *
   * Requirement 13.3: period-over-period percentage changes for daily, weekly, monthly.
   */
  async getHistoricalComparison(period: MetricsPeriod): Promise<HistoricalComparison> {
    const currentStart = getWindowStart(period);
    const currentEnd = new Date();
    const { start: prevStart, end: prevEnd } = getPreviousPeriodRange(period);

    const [
      currentDecisions,
      currentSuccessful,
      currentEligible,
      previousDecisions,
      previousSuccessful,
      previousEligible,
    ] = await Promise.all([
      fetchDecisionRecords(currentStart, currentEnd),
      countSuccessfulReallocations(currentStart, currentEnd),
      countEligibleForReallocation(currentStart, currentEnd),
      fetchDecisionRecords(prevStart, prevEnd),
      countSuccessfulReallocations(prevStart, prevEnd),
      countEligibleForReallocation(prevStart, prevEnd),
    ]);

    const current = computeMetricsFromRecords(currentDecisions, currentSuccessful, currentEligible);
    const previous = computeMetricsFromRecords(previousDecisions, previousSuccessful, previousEligible);
    const change = computeChange(current, previous);

    return { current, previous, change };
  }

  /**
   * Check all metrics for anomalies based on 30-day moving averages.
   * Returns anomaly alerts for metrics that deviate > 2 standard deviations from the mean.
   * Omits anomaly detection for metrics with fewer than 30 data points (Requirement 13.5).
   *
   * Requirements: 13.4, 13.5
   *
   * @param currentMetrics - Current metrics (if not provided, will be fetched)
   * @param historicalData - Map of metric name to historical values (if not provided, will be fetched from DB)
   */
  async checkAnomalies(
    currentMetrics?: SystemMetrics,
    historicalData?: Map<string, number[]>
  ): Promise<AnomalyAlert[]> {
    const metrics = currentMetrics ?? await this.getCurrentMetrics();
    const history = historicalData ?? await this.fetchHistoricalMetricData();

    return checkAllAnomalies(metrics, history);
  }

  /**
   * Fetches historical metric data from the database for anomaly detection.
   * Returns the 30 most recent daily metric snapshots per metric.
   */
  private async fetchHistoricalMetricData(): Promise<Map<string, number[]>> {
    const history = new Map<string, number[]>();
    const metricNames: (keyof SystemMetrics)[] = [
      'rtoReductionRate',
      'reverseLogisticsSavings',
      'deliverySuccessRate',
      'inventoryRecoveryRate',
      'co2Reduction',
      'customerSatisfaction',
    ];

    // Initialize empty arrays
    for (const name of metricNames) {
      history.set(name, []);
    }

    // Fetch daily metrics for the past 30 days (oldest first)
    const now = new Date();
    for (let i = 30; i >= 1; i--) {
      const dayEnd = new Date(now.getTime() - (i - 1) * 24 * 60 * 60 * 1000);
      const dayStart = new Date(dayEnd.getTime() - 24 * 60 * 60 * 1000);

      const [decisions, successfulReallocations, eligibleForReallocation] = await Promise.all([
        fetchDecisionRecords(dayStart, dayEnd),
        countSuccessfulReallocations(dayStart, dayEnd),
        countEligibleForReallocation(dayStart, dayEnd),
      ]);

      const dayMetrics = computeMetricsFromRecords(
        decisions,
        successfulReallocations,
        eligibleForReallocation
      );

      for (const name of metricNames) {
        history.get(name)!.push(dayMetrics[name]);
      }
    }

    return history;
  }
}

export const metricsService = new MetricsService();
