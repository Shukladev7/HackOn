/**
 * Explainability Reporter Service for Flash Deal Eligibility Engine.
 *
 * Generates factor lists and natural-language explanations based on
 * feature percentile analysis.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6
 */

import { FeatureVector, DispositionDecision, Factor, ExplainabilityReport } from './types';
import { FEATURE_BOUNDS } from './featureGenerator';

// ─── Feature Label Map ───────────────────────────────────────────────────────

/**
 * Maps feature names to their display labels.
 * Some features are inverted (lower raw value = better outcome).
 */
const FEATURE_LABEL_MAP: Record<string, { label: string; inverted: boolean }> = {
  mrp: { label: 'High MRP Value', inverted: false },
  currentMarketPrice: { label: 'Strong Market Price', inverted: false },
  brandPopularityScore: { label: 'Brand Popularity', inverted: false },
  damageScore: { label: 'Damage Score', inverted: true }, // lower damage = better
  batteryHealth: { label: 'Battery Health', inverted: false },
  inspectionGrade: { label: 'Inspection Grade', inverted: false },
  wishlistCount: { label: 'Wishlist Activity', inverted: false },
  cartCount: { label: 'Cart Activity', inverted: false },
  nearbyInterestedBuyers: { label: 'Nearby Buyer Interest', inverted: false },
  historicalConversionRate: { label: 'Conversion History', inverted: false },
  demandDensity: { label: 'Local Demand Density', inverted: false },
  distanceToBuyers: { label: 'Buyer Proximity', inverted: true }, // closer = better
  expectedRecoveryValue: { label: 'Recovery Value', inverted: false },
  warehouseCostAvoided: { label: 'Warehouse Savings', inverted: false },
  deliveryCostSaved: { label: 'Delivery Savings', inverted: false },
};

// ─── Inspection Grade Numeric Mapping ────────────────────────────────────────

const INSPECTION_GRADE_NUMERIC: Record<string, number> = {
  A: 100,
  B: 75,
  C: 50,
  D: 25,
  F: 0,
};

// ─── Core Functions ──────────────────────────────────────────────────────────

/**
 * Computes the percentile position of a value within its defined range.
 * Returns a number 0–100 representing where the value falls.
 */
export function computePercentile(value: number, min: number, max: number): number {
  if (max === min) return 50;
  const percentile = ((value - min) / (max - min)) * 100;
  return Math.max(0, Math.min(100, percentile));
}

/**
 * Generates a complete explainability report with positive factors,
 * negative factors, and a natural-language explanation.
 */
export function generateReport(
  features: FeatureVector,
  disposition: DispositionDecision,
  flashDealScore: number
): ExplainabilityReport {
  // Compute percentiles for all numeric features
  const allFactors = computeAllFactors(features);

  // Select positive factors: features > 70th percentile
  let positiveFactors = allFactors
    .filter((f) => f.percentile > 70)
    .sort((a, b) => b.percentile - a.percentile)
    .slice(0, 5);

  // Select negative factors: features < 30th percentile
  let negativeFactors = allFactors
    .filter((f) => f.percentile < 30)
    .sort((a, b) => a.percentile - b.percentile)
    .slice(0, 5);

  // Fallback: if fewer than 1 positive factor, select the single highest-percentile feature
  if (positiveFactors.length < 1) {
    const highest = allFactors.reduce((best, current) =>
      current.percentile > best.percentile ? current : best
    );
    positiveFactors = [highest];
  }

  // Fallback: if fewer than 1 negative factor, select the single lowest-percentile feature
  if (negativeFactors.length < 1) {
    const lowest = allFactors.reduce((best, current) =>
      current.percentile < best.percentile ? current : best
    );
    negativeFactors = [lowest];
  }

  // Format labels with prefixes
  const formattedPositive: Factor[] = positiveFactors.map((f) => ({
    ...f,
    label: `✓ ${getPositiveLabel(f.featureName)}`,
  }));

  const formattedNegative: Factor[] = negativeFactors.map((f) => ({
    ...f,
    label: `✗ ${getNegativeLabel(f.featureName)}`,
  }));

  // Generate explanation
  const topPositive = formattedPositive.length > 0 ? formattedPositive[0]! : null;
  const topNegative = formattedNegative.length > 0 ? formattedNegative[0]! : null;
  const explanation = generateExplanation(disposition, topPositive, topNegative, flashDealScore);

  return {
    positiveFactors: formattedPositive,
    negativeFactors: formattedNegative,
    explanation,
  };
}

/**
 * Generates a 2–4 sentence natural-language explanation.
 * Must reference: the disposition decision name, the top contributing positive factor,
 * the primary risk factor, and the Flash Deal Score value.
 */
export function generateExplanation(
  disposition: DispositionDecision,
  topPositive: Factor | null,
  topNegative: Factor | null,
  flashDealScore: number
): string {
  const dispositionLabel = getDispositionDisplayName(disposition);
  const scoreText = `${flashDealScore}/100`;

  // Build sentences
  const sentence1 = `This product received a Flash Deal Score of ${scoreText} and has been routed to ${dispositionLabel}.`;

  let sentence2 = '';
  if (topPositive) {
    const positiveLabel = topPositive.label.replace(/^[✓✗]\s*/, '');
    sentence2 = `Strong ${positiveLabel.toLowerCase()} drove the score higher.`;
  }

  let sentence3 = '';
  if (topNegative) {
    const negativeLabel = topNegative.label.replace(/^[✓✗]\s*/, '');
    if (flashDealScore >= 50) {
      sentence3 = `${negativeLabel} was a minor concern but did not significantly impact the overall decision.`;
    } else {
      sentence3 = `${negativeLabel} contributed to the lower score and influenced the routing decision.`;
    }
  }

  // Combine into 2–4 sentences
  const sentences = [sentence1, sentence2, sentence3].filter((s) => s.length > 0);

  // Ensure at least 2 sentences
  if (sentences.length < 2) {
    sentences.push(`The overall evaluation reflects the product's current market positioning.`);
  }

  return sentences.join(' ');
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

/**
 * Computes percentile factors for all numeric features in the feature vector.
 */
function computeAllFactors(features: FeatureVector): Factor[] {
  const factors: Factor[] = [];

  // Product features
  addFactor(factors, 'mrp', features.product.mrp, FEATURE_BOUNDS.mrp);
  addFactor(factors, 'currentMarketPrice', features.product.currentMarketPrice, FEATURE_BOUNDS.currentMarketPrice);
  addFactor(factors, 'brandPopularityScore', features.product.brandPopularityScore, FEATURE_BOUNDS.brandPopularityScore);

  // Condition features
  addFactor(factors, 'damageScore', features.condition.damageScore, FEATURE_BOUNDS.damageScore);
  addFactor(factors, 'batteryHealth', features.condition.batteryHealth, FEATURE_BOUNDS.batteryHealth);

  // Inspection grade (convert to numeric)
  const gradeNumeric = INSPECTION_GRADE_NUMERIC[features.condition.inspectionGrade] ?? 50;
  factors.push({
    label: FEATURE_LABEL_MAP['inspectionGrade']!.label,
    featureName: 'inspectionGrade',
    value: gradeNumeric,
    percentile: gradeNumeric, // Already 0–100
  });

  // Demand features
  addFactor(factors, 'wishlistCount', features.demand.wishlistCount, FEATURE_BOUNDS.wishlistCount);
  addFactor(factors, 'cartCount', features.demand.cartCount, FEATURE_BOUNDS.cartCount);
  addFactor(factors, 'nearbyInterestedBuyers', features.demand.nearbyInterestedBuyers, FEATURE_BOUNDS.nearbyInterestedBuyers);
  addFactor(factors, 'historicalConversionRate', features.demand.historicalConversionRate, FEATURE_BOUNDS.historicalConversionRate);

  // Location features
  addFactor(factors, 'demandDensity', features.location.demandDensity, FEATURE_BOUNDS.demandDensity);
  addFactor(factors, 'distanceToBuyers', features.location.distanceToBuyers, FEATURE_BOUNDS.distanceToBuyers);

  // Financial features
  addFactor(factors, 'expectedRecoveryValue', features.financial.expectedRecoveryValue, FEATURE_BOUNDS.expectedRecoveryValue);
  addFactor(factors, 'warehouseCostAvoided', features.financial.warehouseCostAvoided, FEATURE_BOUNDS.warehouseCostAvoided);
  addFactor(factors, 'deliveryCostSaved', features.financial.deliveryCostSaved, FEATURE_BOUNDS.deliveryCostSaved);

  return factors;
}

/**
 * Adds a factor to the list, handling inverted features.
 */
function addFactor(
  factors: Factor[],
  featureName: string,
  value: number,
  bounds: { min: number; max: number }
): void {
  const config = FEATURE_LABEL_MAP[featureName];
  if (!config) return;

  let percentile = computePercentile(value, bounds.min, bounds.max);

  // Invert percentile for features where lower raw value is better
  if (config.inverted) {
    percentile = 100 - percentile;
  }

  factors.push({
    label: config.label,
    featureName,
    value,
    percentile,
  });
}

/**
 * Gets the display label for a feature when it appears as a positive factor.
 */
function getPositiveLabel(featureName: string): string {
  const config = FEATURE_LABEL_MAP[featureName];
  if (!config) return featureName;

  // Special handling for inverted features appearing as positive
  if (featureName === 'damageScore') return 'Low Damage Score';
  if (featureName === 'distanceToBuyers') return 'Buyer Proximity';

  return config.label;
}

/**
 * Gets the display label for a feature when it appears as a negative factor.
 */
function getNegativeLabel(featureName: string): string {
  const config = FEATURE_LABEL_MAP[featureName];
  if (!config) return featureName;

  // Special handling for inverted features appearing as negative
  if (featureName === 'damageScore') return 'High Damage Score';
  if (featureName === 'distanceToBuyers') return 'High Delivery Distance';

  // For non-inverted features, prefix with "Low" for negative context
  return `Low ${config.label}`;
}

/**
 * Converts a DispositionDecision to a human-readable display name.
 */
function getDispositionDisplayName(disposition: DispositionDecision): string {
  const labels: Record<DispositionDecision, string> = {
    FLASH_DEAL: 'Flash Deal',
    AMAZON_RENEWED: 'Amazon Renewed',
    NORMAL_RESALE: 'Normal Resale',
    CIRCULAR_ROUTING: 'Circular Routing',
    WAREHOUSE_RETURN: 'Warehouse Return',
  };
  return labels[disposition];
}
