/**
 * Score Calculator Service for Flash Deal Eligibility Engine.
 *
 * Computes Flash Deal Score as a weighted sum of normalized category scores,
 * and Confidence Score based on feature completeness and consistency.
 *
 * Requirements: 3.1, 3.2, 3.7
 */

import { FeatureVector, CategoryScores, ScoreWeights, ScoreResult } from './types';
import { config } from '../../config';

// ─── Constants ───────────────────────────────────────────────────────────────

const INSPECTION_GRADE_SCORES: Record<string, number> = {
  A: 100,
  B: 80,
  C: 60,
  D: 40,
  F: 20,
};

const PACKAGING_CONDITION_SCORES: Record<string, number> = {
  Original: 100,
  Damaged: 50,
  Missing: 20,
};

// ─── Normalization Helpers ───────────────────────────────────────────────────

/**
 * Normalizes a numeric value from [min, max] to [0, 100].
 * Values outside range are clamped.
 */
function normalize(value: number, min: number, max: number): number {
  if (max === min) return 50;
  const clamped = Math.max(min, Math.min(max, value));
  return ((clamped - min) / (max - min)) * 100;
}

/**
 * Normalizes a numeric value from [min, max] to [0, 100] with inversion
 * (lower input = higher score).
 */
function normalizeInverted(value: number, min: number, max: number): number {
  return 100 - normalize(value, min, max);
}

// ─── Category Score Normalization ────────────────────────────────────────────

/**
 * Normalizes the condition category features to a 0–100 score.
 * Sub-scores: inspectionGrade, packagingCondition, damageScore (inverted), batteryHealth.
 * Returns the average of the 4 sub-scores.
 */
function normalizeConditionScore(features: FeatureVector): number {
  const gradeScore = INSPECTION_GRADE_SCORES[features.condition.inspectionGrade] ?? 50;
  const packagingScore = PACKAGING_CONDITION_SCORES[features.condition.packagingCondition] ?? 50;
  const damageScore = 100 - features.condition.damageScore; // invert: lower damage = higher score
  const batteryScore = features.condition.batteryHealth;

  return (gradeScore + packagingScore + damageScore + batteryScore) / 4;
}

/**
 * Normalizes the demand category features to a 0–100 score.
 * Sub-scores: wishlistCount (0-500→0-100), cartCount (0-200→0-100),
 * nearbyInterestedBuyers (0-50→0-100), historicalConversionRate (0-1→0-100).
 * Returns the average of the 4 sub-scores.
 */
function normalizeDemandScore(features: FeatureVector): number {
  const wishlistScore = normalize(features.demand.wishlistCount, 0, 500);
  const cartScore = normalize(features.demand.cartCount, 0, 200);
  const buyersScore = normalize(features.demand.nearbyInterestedBuyers, 0, 50);
  const conversionScore = normalize(features.demand.historicalConversionRate, 0, 1.0);

  return (wishlistScore + cartScore + buyersScore + conversionScore) / 4;
}

/**
 * Normalizes the financial category features to a 0–100 score.
 * Sub-scores: expectedRecoveryValue (100-140000→0-100),
 * warehouseCostAvoided (50-500→0-100), deliveryCostSaved (20-300→0-100).
 * Returns the average of the 3 sub-scores.
 */
function normalizeFinancialScore(features: FeatureVector): number {
  const recoveryScore = normalize(features.financial.expectedRecoveryValue, 100, 140000);
  const warehouseScore = normalize(features.financial.warehouseCostAvoided, 50, 500);
  const deliveryScore = normalize(features.financial.deliveryCostSaved, 20, 300);

  return (recoveryScore + warehouseScore + deliveryScore) / 3;
}

/**
 * Normalizes the location category features to a 0–100 score.
 * Sub-scores: demandDensity (0-100→0-100), distanceToBuyers (0.5-100→inverted).
 * Returns the average of the 2 sub-scores.
 */
function normalizeLocationScore(features: FeatureVector): number {
  const densityScore = normalize(features.location.demandDensity, 0, 100);
  const distanceScore = normalizeInverted(features.location.distanceToBuyers, 0.5, 100);

  return (densityScore + distanceScore) / 2;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Normalizes raw feature values to a 0–100 score for a given category.
 */
export function normalizeCategoryScore(features: FeatureVector, category: keyof CategoryScores): number {
  switch (category) {
    case 'condition':
      return normalizeConditionScore(features);
    case 'demand':
      return normalizeDemandScore(features);
    case 'financial':
      return normalizeFinancialScore(features);
    case 'location':
      return normalizeLocationScore(features);
    default:
      return 0;
  }
}

/**
 * Computes the Flash Deal Score as a weighted sum of normalized category scores.
 * Returns an integer in [0, 100].
 *
 * Requirements: 3.1
 */
export function computeScore(features: FeatureVector): ScoreResult {
  const weights: ScoreWeights = {
    condition: config.flashDeal.conditionWeight,
    demand: config.flashDeal.demandWeight,
    financial: config.flashDeal.financialWeight,
    location: config.flashDeal.locationWeight,
  };

  const categoryScores: CategoryScores = {
    condition: normalizeCategoryScore(features, 'condition'),
    demand: normalizeCategoryScore(features, 'demand'),
    financial: normalizeCategoryScore(features, 'financial'),
    location: normalizeCategoryScore(features, 'location'),
  };

  const rawScore =
    categoryScores.condition * weights.condition +
    categoryScores.demand * weights.demand +
    categoryScores.financial * weights.financial +
    categoryScores.location * weights.location;

  const flashDealScore = Math.max(0, Math.min(100, Math.round(rawScore)));

  const confidenceScore = computeConfidence(features, categoryScores, flashDealScore);

  return {
    flashDealScore,
    confidenceScore,
    categoryScores,
    weights,
  };
}

/**
 * Computes a confidence score based on feature completeness and category score consistency.
 *
 * - Completeness: percentage of non-null feature values (count non-null / total fields × 100)
 * - Consistency: how many category scores deviate > 25 points from the flashDealScore.
 *   More deviation = lower confidence.
 * - Formula: confidence = round(completeness * 0.6 + (100 - avgDeviation) * 0.4), clamped to [0, 100]
 *
 * Requirements: 3.2
 */
export function computeConfidence(
  features: FeatureVector,
  categoryScores: CategoryScores,
  flashDealScore: number
): number {
  // ─── Completeness ────────────────────────────────────────────────────────
  const featureFields = [
    features.product?.category,
    features.product?.mrp,
    features.product?.currentMarketPrice,
    features.product?.brandPopularityScore,
    features.condition?.inspectionGrade,
    features.condition?.packagingCondition,
    features.condition?.damageScore,
    features.condition?.batteryHealth,
    features.demand?.wishlistCount,
    features.demand?.cartCount,
    features.demand?.nearbyInterestedBuyers,
    features.demand?.historicalConversionRate,
    features.location?.city,
    features.location?.demandDensity,
    features.location?.distanceToBuyers,
    features.financial?.expectedRecoveryValue,
    features.financial?.warehouseCostAvoided,
    features.financial?.deliveryCostSaved,
  ];

  const totalFields = featureFields.length;
  const nonNullCount = featureFields.filter(
    (v) => v !== null && v !== undefined
  ).length;
  const completeness = (nonNullCount / totalFields) * 100;

  // ─── Consistency ─────────────────────────────────────────────────────────
  const categoryKeys: (keyof CategoryScores)[] = ['condition', 'demand', 'financial', 'location'];
  const deviations = categoryKeys.map((key) =>
    Math.abs(categoryScores[key] - flashDealScore)
  );
  const avgDeviation = deviations.reduce((sum, d) => sum + d, 0) / deviations.length;

  // ─── Final Confidence ────────────────────────────────────────────────────
  const rawConfidence = completeness * 0.6 + (100 - avgDeviation) * 0.4;
  return Math.max(0, Math.min(100, Math.round(rawConfidence)));
}
