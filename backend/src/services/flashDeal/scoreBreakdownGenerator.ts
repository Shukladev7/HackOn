/**
 * Score Breakdown Generator for Flash Deal Eligibility Engine.
 *
 * Decomposes the Flash Deal Score into individual contributor points
 * that sum exactly to the total score with no rounding loss.
 *
 * Requirements: 11.1, 11.2, 11.3, 11.4, 11.5
 */

import { ScoreContributor, CategoryScores, FeatureVector } from './types';

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Contributor maximums (must sum to exactly 100).
 */
export const CONTRIBUTOR_MAXIMUMS: Record<string, number> = {
  'Condition Grade': 30,
  'Local Demand': 15,
  'Wishlist Activity': 15,
  'Margin Potential': 25,
  'Buyer Density': 15,
};

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Generates a score breakdown showing individual point contributions from each
 * scoring dimension. The sum of all contributor points equals the flashDealScore exactly.
 *
 * Contributors are ordered from highest points to lowest; ties broken alphabetically.
 */
export function generateBreakdown(
  flashDealScore: number,
  categoryScores: CategoryScores,
  features: FeatureVector
): ScoreContributor[] {
  // Compute raw proportional points for each contributor
  const rawPoints: Record<string, number> = {};

  // Condition Grade: (categoryScores.condition / 100) × 30
  rawPoints['Condition Grade'] = (categoryScores.condition / 100) * 30;

  // Local Demand: proportional from demand features excluding wishlist
  // Use cartCount, nearbyBuyers, conversionRate normalized then scaled to 15
  const cartNorm = Math.min(features.demand.cartCount / 200, 1);
  const buyersNorm = Math.min(features.demand.nearbyInterestedBuyers / 50, 1);
  const conversionNorm = Math.min(features.demand.historicalConversionRate / 1.0, 1);
  const localDemandRatio = (cartNorm + buyersNorm + conversionNorm) / 3;
  rawPoints['Local Demand'] = localDemandRatio * 15;

  // Wishlist Activity: proportional from demand.wishlistCount normalized to 0-1 × 15
  const wishlistNorm = Math.min(features.demand.wishlistCount / 500, 1);
  rawPoints['Wishlist Activity'] = wishlistNorm * 15;

  // Margin Potential: (categoryScores.financial / 100) × 25
  rawPoints['Margin Potential'] = (categoryScores.financial / 100) * 25;

  // Buyer Density: (categoryScores.location / 100) × 15
  rawPoints['Buyer Density'] = (categoryScores.location / 100) * 15;

  return distributePoints(rawPoints, flashDealScore);
}

/**
 * Distributes points so that the sum equals targetTotal exactly.
 *
 * Algorithm:
 * 1. Scale raw points proportionally so they sum to targetTotal
 * 2. Floor all scaled points to get initial integer values
 * 3. Compute remainder = targetTotal - sum(floored values)
 * 4. Distribute remainder one point at a time to contributors with largest
 *    fractional parts (largest rounding error first)
 * 5. Ensure each contributor stays within [0, maximum]
 *
 * Returns contributors ordered highest-to-lowest by points, alphabetical for ties.
 */
export function distributePoints(
  rawPoints: Record<string, number>,
  targetTotal: number
): ScoreContributor[] {
  const names = Object.keys(rawPoints);

  // Step 1: Scale raw points proportionally to sum to targetTotal
  const rawSum = Object.values(rawPoints).reduce((sum, v) => sum + v, 0);
  const scaled: Record<string, number> = {};

  if (rawSum === 0 || targetTotal === 0) {
    // If raw sum is 0, distribute targetTotal equally or all zeros
    if (targetTotal === 0) {
      for (const name of names) {
        scaled[name] = 0;
      }
    } else {
      // Distribute evenly as a fallback
      const perContributor = targetTotal / names.length;
      for (const name of names) {
        scaled[name] = Math.min(perContributor, CONTRIBUTOR_MAXIMUMS[name] ?? 0);
      }
    }
  } else {
    const scaleFactor = targetTotal / rawSum;
    for (const name of names) {
      scaled[name] = (rawPoints[name] ?? 0) * scaleFactor;
    }
  }

  // Step 2: Floor all scaled points, clamped to [0, maximum]
  const floored: Record<string, number> = {};
  const fractionals: Array<{ name: string; fractional: number }> = [];

  for (const name of names) {
    const max = CONTRIBUTOR_MAXIMUMS[name] ?? 0;
    const clamped = Math.max(0, Math.min(max, scaled[name] ?? 0));
    const floorVal = Math.floor(clamped);
    floored[name] = floorVal;
    fractionals.push({ name, fractional: clamped - floorVal });
  }

  // Step 3: Compute remainder
  const flooredSum = Object.values(floored).reduce((sum, v) => sum + v, 0);
  let remainder = targetTotal - flooredSum;

  // Step 4: Distribute remainder one point at a time
  // Sort by largest fractional part first, then alphabetically for stability
  fractionals.sort((a, b) => {
    if (b.fractional !== a.fractional) return b.fractional - a.fractional;
    return a.name.localeCompare(b.name);
  });

  // Distribute positive remainder
  while (remainder > 0) {
    let distributed = false;
    for (const item of fractionals) {
      if (remainder <= 0) break;
      const max = CONTRIBUTOR_MAXIMUMS[item.name] ?? 0;
      if ((floored[item.name] ?? 0) < max) {
        floored[item.name] = (floored[item.name] ?? 0) + 1;
        remainder -= 1;
        distributed = true;
      }
    }
    // Safety: if we couldn't distribute (all at max), break to avoid infinite loop
    if (!distributed) break;
  }

  // Handle negative remainder (edge case where clamping caused floored sum to exceed target)
  while (remainder < 0) {
    let distributed = false;
    // Sort by smallest fractional part first (least rounding error when reducing)
    const sortedForReduction = [...fractionals].sort((a, b) => {
      if (a.fractional !== b.fractional) return a.fractional - b.fractional;
      return a.name.localeCompare(b.name);
    });

    for (const item of sortedForReduction) {
      if (remainder >= 0) break;
      if ((floored[item.name] ?? 0) > 0) {
        floored[item.name] = (floored[item.name] ?? 0) - 1;
        remainder += 1;
        distributed = true;
      }
    }
    if (!distributed) break;
  }

  // Step 5: Build result array
  const contributors: ScoreContributor[] = names.map((name) => ({
    name,
    points: floored[name] ?? 0,
    maximum: CONTRIBUTOR_MAXIMUMS[name] ?? 0,
  }));

  // Sort: highest points first, alphabetical for ties
  contributors.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    return a.name.localeCompare(b.name);
  });

  return contributors;
}
