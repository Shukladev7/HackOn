/**
 * Sustainability Calculator for the Flash Deal Eligibility Engine.
 *
 * Computes environmental impact metrics including distance saved and CO2 reduction
 * for flash deal evaluations compared to traditional return logistics.
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5
 */

import { SustainabilityMetrics, DispositionDecision } from './types';
import { config } from '../../config';
import { FlashDealEvaluation } from '../../models/FlashDealEvaluation';

export interface AggregateSustainability {
  totalCo2Saved: number;
  totalDistanceAvoided: number;
  totalProductsGivenSecondLife: number;
  totalEvaluations: number;
}

/**
 * Rounds a number to 2 decimal places.
 */
function roundTo2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Calculates sustainability metrics for a single evaluation.
 *
 * For WAREHOUSE_RETURN dispositions, all metrics are zero since the product
 * follows the traditional return path and provides no environmental benefit.
 *
 * For other dispositions:
 * - traditionalDistance = distanceToBuyers + warehouseReturnDistance (default 100 km)
 * - flashDealDistance = distanceToBuyers
 * - distanceSaved = traditionalDistance - flashDealDistance
 * - co2Saved = distanceSaved × emissionFactor (default 0.027 kg CO2/km)
 */
export function calculate(
  distanceToBuyers: number,
  disposition: DispositionDecision
): SustainabilityMetrics {
  // WAREHOUSE_RETURN: all metrics zero
  if (disposition === 'WAREHOUSE_RETURN') {
    return {
      traditionalDistance: 0,
      flashDealDistance: 0,
      distanceSaved: 0,
      co2Saved: 0,
    };
  }

  const warehouseReturnDistance = config.flashDeal.warehouseReturnDistance;
  const emissionFactor = config.flashDeal.emissionFactor;

  const traditionalDistance = roundTo2(distanceToBuyers + warehouseReturnDistance);
  const flashDealDistance = roundTo2(distanceToBuyers);
  const distanceSaved = roundTo2(traditionalDistance - flashDealDistance);
  const co2Saved = roundTo2(distanceSaved * emissionFactor);

  return {
    traditionalDistance,
    flashDealDistance,
    distanceSaved,
    co2Saved,
  };
}

/**
 * Calculates aggregate sustainability metrics across all completed evaluations.
 *
 * Queries the FlashDealEvaluation collection and computes:
 * - totalCo2Saved: sum of all co2Saved values
 * - totalDistanceAvoided: sum of all distanceSaved values
 * - totalProductsGivenSecondLife: count of evaluations where disposition is NOT WAREHOUSE_RETURN
 * - totalEvaluations: count of all completed evaluations
 */
export async function calculateAggregate(): Promise<AggregateSustainability> {
  const completedEvaluations = await FlashDealEvaluation.find({
    status: 'completed',
  }).lean();

  let totalCo2Saved = 0;
  let totalDistanceAvoided = 0;
  let totalProductsGivenSecondLife = 0;
  const totalEvaluations = completedEvaluations.length;

  for (const evaluation of completedEvaluations) {
    if (evaluation.sustainability) {
      totalCo2Saved += evaluation.sustainability.co2Saved || 0;
      totalDistanceAvoided += evaluation.sustainability.distanceSaved || 0;
    }

    if (
      evaluation.result &&
      evaluation.result.dispositionDecision !== 'WAREHOUSE_RETURN'
    ) {
      totalProductsGivenSecondLife++;
    }
  }

  return {
    totalCo2Saved: roundTo2(totalCo2Saved),
    totalDistanceAvoided: roundTo2(totalDistanceAvoided),
    totalProductsGivenSecondLife,
    totalEvaluations,
  };
}

export const sustainabilityCalculator = {
  calculate,
  calculateAggregate,
};

export default sustainabilityCalculator;
