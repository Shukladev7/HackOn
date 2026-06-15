/**
 * Business Impact Calculator
 *
 * Computes cost savings, revenue recovery, and operational metrics for each evaluation.
 * Also provides aggregate impact totals across all completed evaluations.
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7
 */

import { BusinessImpact, FeatureVector } from './types';
import { config } from '../../config';
import { FlashDealEvaluation } from '../../models/FlashDealEvaluation';

/**
 * Grade depreciation factors for recovery value calculation.
 * Maps inspection grade to the fraction of current market price retained.
 */
const GRADE_DEPRECIATION: Record<string, number> = {
  A: 1.0,
  B: 0.85,
  C: 0.70,
  D: 0.50,
  F: 0.50,
};

/**
 * Aggregate business impact totals across all completed evaluations.
 */
export interface AggregateImpact {
  totalSavings: number;
  averageCostReductionPercentage: number;
  totalRevenueRecovered: number;
  averageRecoveryRate: number;
  totalEvaluations: number;
}

/**
 * Calculates business impact metrics for a single evaluation.
 *
 * @param features - The feature vector from the evaluation
 * @returns BusinessImpact with cost savings, recovery value, and operational metrics
 */
export function calculate(features: FeatureVector): BusinessImpact {
  const {
    reversePickupCost,
    hubProcessingCost,
    warehouseInboundCost,
    reListingCost,
    localDeliveryCost,
    inspectionCost,
  } = config.flashDeal;

  // Traditional Return Cost = sum of all reverse logistics costs
  const traditionalReturnCost = roundTo2(
    reversePickupCost + hubProcessingCost + warehouseInboundCost + reListingCost
  );

  // Flash Deal Route Cost = local delivery + inspection only
  const flashDealRouteCost = roundTo2(localDeliveryCost + inspectionCost);

  // Savings = traditional - flash deal route
  const savingsAmount = roundTo2(traditionalReturnCost - flashDealRouteCost);

  // Cost Reduction Percentage = (savings / traditional) × 100, rounded to 1 decimal
  const costReductionPercentage = roundTo1(
    (savingsAmount / traditionalReturnCost) * 100
  );

  // Warehouse touches avoided: hub processing, warehouse inbound, re-listing = 3 steps
  const warehouseTouchesAvoided = 3;

  // Track missing inputs for recovery calculations
  const missingInputs: string[] = [];

  // Estimated Recovery Value = currentMarketPrice × GRADE_DEPRECIATION[inspectionGrade]
  let estimatedRecoveryValue: number | null = null;
  const currentMarketPrice = features.product?.currentMarketPrice;
  const inspectionGrade = features.condition?.inspectionGrade;

  if (
    currentMarketPrice == null ||
    currentMarketPrice === undefined ||
    inspectionGrade == null ||
    inspectionGrade === undefined ||
    !(inspectionGrade in GRADE_DEPRECIATION)
  ) {
    if (currentMarketPrice == null || currentMarketPrice === undefined) {
      missingInputs.push('currentMarketPrice');
    }
    if (
      inspectionGrade == null ||
      inspectionGrade === undefined ||
      !(inspectionGrade in GRADE_DEPRECIATION)
    ) {
      missingInputs.push('inspectionGrade');
    }
  } else {
    estimatedRecoveryValue = roundTo2(
      currentMarketPrice * (GRADE_DEPRECIATION[inspectionGrade] ?? 0.5)
    );
  }

  // Revenue Recovery Rate = (estimatedRecoveryValue / mrp) × 100
  let revenueRecoveryRate: number | null = null;
  const mrp = features.product?.mrp;

  if (estimatedRecoveryValue != null && mrp != null && mrp > 0) {
    revenueRecoveryRate = roundTo1((estimatedRecoveryValue / mrp) * 100);
  } else {
    if (estimatedRecoveryValue == null) {
      // Already tracked missing inputs above
    } else if (mrp == null || mrp === undefined) {
      if (!missingInputs.includes('mrp')) {
        missingInputs.push('mrp');
      }
    } else if (mrp === 0) {
      if (!missingInputs.includes('mrp')) {
        missingInputs.push('mrp');
      }
    }
  }

  const result: BusinessImpact = {
    traditionalReturnCost,
    flashDealRouteCost,
    savingsAmount,
    costReductionPercentage,
    warehouseTouchesAvoided,
    estimatedRecoveryValue,
    revenueRecoveryRate,
  };

  if (missingInputs.length > 0) {
    result.missingInputs = missingInputs;
  }

  return result;
}

/**
 * Calculates aggregate business impact across all completed evaluations.
 *
 * Queries all FlashDealEvaluation records with status 'completed' and computes:
 * - totalSavings: sum of all savingsAmount
 * - averageCostReductionPercentage: average of all costReductionPercentage
 * - totalRevenueRecovered: sum of all non-null estimatedRecoveryValue
 * - averageRecoveryRate: average of all non-null revenueRecoveryRate
 * - totalEvaluations: count of completed evaluations
 *
 * @returns AggregateImpact with cumulative totals
 */
export async function calculateAggregate(): Promise<AggregateImpact> {
  const evaluations = await FlashDealEvaluation.find({
    status: 'completed',
    businessImpact: { $ne: null },
  }).lean();

  if (evaluations.length === 0) {
    return {
      totalSavings: 0,
      averageCostReductionPercentage: 0,
      totalRevenueRecovered: 0,
      averageRecoveryRate: 0,
      totalEvaluations: 0,
    };
  }

  let totalSavings = 0;
  let totalCostReductionPercentage = 0;
  let totalRevenueRecovered = 0;
  let totalRecoveryRate = 0;
  let recoveryValueCount = 0;
  let recoveryRateCount = 0;

  for (const evaluation of evaluations) {
    const impact = evaluation.businessImpact;
    if (!impact) continue;

    totalSavings += impact.savingsAmount;
    totalCostReductionPercentage += impact.costReductionPercentage;

    if (impact.estimatedRecoveryValue != null) {
      totalRevenueRecovered += impact.estimatedRecoveryValue;
      recoveryValueCount++;
    }

    if (impact.revenueRecoveryRate != null) {
      totalRecoveryRate += impact.revenueRecoveryRate;
      recoveryRateCount++;
    }
  }

  return {
    totalSavings: roundTo2(totalSavings),
    averageCostReductionPercentage: roundTo1(
      totalCostReductionPercentage / evaluations.length
    ),
    totalRevenueRecovered: roundTo2(totalRevenueRecovered),
    averageRecoveryRate:
      recoveryRateCount > 0
        ? roundTo1(totalRecoveryRate / recoveryRateCount)
        : 0,
    totalEvaluations: evaluations.length,
  };
}

/**
 * Round a number to 2 decimal places.
 */
function roundTo2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Round a number to 1 decimal place.
 */
function roundTo1(value: number): number {
  return Math.round(value * 10) / 10;
}
