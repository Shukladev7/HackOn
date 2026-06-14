/**
 * Buyer Ranking Engine
 *
 * Scores and ranks candidate buyers by composite fitness.
 * Implements Requirements 6.1–6.6:
 *  - 6.1: Composite score computation (distance, conversion, speed, margin)
 *  - 6.2: Configurable weights summing to 1.0
 *  - 6.3: Missing factors assigned neutral 0.5 and flagged as imputed
 *  - 6.4: Filter candidates below minimum threshold (default 0.4)
 *  - 6.5: Return up to 10 candidates, sorted descending by score, ties broken by shortest distance
 *  - 6.6: Return empty list if all candidates filtered out
 */

import { config } from '../config';

// --- Interfaces ---

export interface DemandCandidate {
  buyerId: string;
  matchType: 'existing_order' | 'cart' | 'wishlist' | 'predicted_intent';
  matchConfidence: number;
  location: { lat: number; lng: number };
  distanceKm: number;
  orderId?: string;
  intentScore?: number;
  lastRefusalCheck: { refused: boolean; category?: string; checkDate: string };
}

export interface RankingWeights {
  distance: number;
  conversionProbability: number;
  deliverySpeed: number;
  marginImpact: number;
}

export interface ScoredCandidate {
  buyerId: string;
  compositeScore: number;
  distanceKm: number;
  factors: {
    distance: { value: number; imputed: boolean };
    conversionProbability: { value: number; imputed: boolean };
    deliverySpeed: { value: number; imputed: boolean };
    marginImpact: { value: number; imputed: boolean };
  };
  partiallyScored: boolean;
}

export interface CandidateFactors {
  distance?: number;
  conversionProbability?: number;
  deliverySpeed?: number;
  marginImpact?: number;
}

// --- Constants ---

const NEUTRAL_VALUE = 0.5;

const DEFAULT_WEIGHTS: RankingWeights = {
  distance: config.rankingWeights.distance,
  conversionProbability: config.rankingWeights.conversion,
  deliverySpeed: config.rankingWeights.speed,
  marginImpact: config.rankingWeights.margin,
};

const DEFAULT_MIN_THRESHOLD = config.minBuyerScore;
const DEFAULT_MAX_CANDIDATES = config.maxRankedBuyers;

// --- Helper Functions ---

/**
 * Normalize distance to a 0–1 score where shorter distance = higher score.
 * Uses a simple inverse scaling: score = 1 - (distance / maxRadius).
 * Clamped to [0, 1].
 */
export function normalizeDistance(distanceKm: number, maxRadiusKm: number = config.searchRadiusKm): number {
  if (distanceKm <= 0) return 1.0;
  if (distanceKm >= maxRadiusKm) return 0.0;
  return 1.0 - distanceKm / maxRadiusKm;
}

/**
 * Compute composite score for a single candidate.
 * Each factor should be in [0, 1]. Missing factors get neutral value 0.5.
 */
export function computeCompositeScore(
  factors: CandidateFactors,
  weights: RankingWeights = DEFAULT_WEIGHTS
): { score: number; scoredFactors: ScoredCandidate['factors']; partiallyScored: boolean } {
  let partiallyScored = false;

  const resolveFactor = (value: number | undefined): { value: number; imputed: boolean } => {
    if (value === undefined || value === null) {
      partiallyScored = true;
      return { value: NEUTRAL_VALUE, imputed: true };
    }
    // Clamp to [0, 1]
    const clamped = Math.max(0, Math.min(1, value));
    return { value: clamped, imputed: false };
  };

  const distance = resolveFactor(factors.distance);
  const conversionProbability = resolveFactor(factors.conversionProbability);
  const deliverySpeed = resolveFactor(factors.deliverySpeed);
  const marginImpact = resolveFactor(factors.marginImpact);

  const score =
    distance.value * weights.distance +
    conversionProbability.value * weights.conversionProbability +
    deliverySpeed.value * weights.deliverySpeed +
    marginImpact.value * weights.marginImpact;

  // Clamp final score to [0, 1]
  const clampedScore = Math.max(0, Math.min(1, score));

  return {
    score: clampedScore,
    scoredFactors: { distance, conversionProbability, deliverySpeed, marginImpact },
    partiallyScored,
  };
}

// --- Main Ranking Function ---

/**
 * Rank candidates by composite score with filtering and output limits.
 *
 * 1. Compute composite score for each candidate
 * 2. Filter candidates below minimum threshold (Requirement 6.4)
 * 3. Sort by descending composite score, ties broken by shortest distance (Requirement 6.5)
 * 4. Return at most maxCandidates results (Requirement 6.5)
 * 5. Return empty list if all filtered out (Requirement 6.6)
 */
export function rankCandidates(
  candidates: DemandCandidate[],
  packageDetails: { price: number; category: string },
  weights: RankingWeights = DEFAULT_WEIGHTS,
  minThreshold: number = DEFAULT_MIN_THRESHOLD,
  maxCandidates: number = DEFAULT_MAX_CANDIDATES
): ScoredCandidate[] {
  // Score each candidate
  const scored: ScoredCandidate[] = candidates.map((candidate) => {
    const distanceScore = normalizeDistance(candidate.distanceKm);

    // For MVP, derive factors from available candidate data
    const factors: CandidateFactors = {
      distance: distanceScore,
      conversionProbability: candidate.matchConfidence,
      // deliverySpeed and marginImpact are not available from DemandCandidate directly
      // They would come from additional data sources in a full implementation
      deliverySpeed: undefined,
      marginImpact: undefined,
    };

    const { score, scoredFactors, partiallyScored } = computeCompositeScore(factors, weights);

    return {
      buyerId: candidate.buyerId,
      compositeScore: score,
      distanceKm: candidate.distanceKm,
      factors: scoredFactors,
      partiallyScored,
    };
  });

  // Filter candidates below minimum threshold (Requirement 6.4)
  const filtered = scored.filter((c) => c.compositeScore >= minThreshold);

  // Sort by descending composite score, ties broken by shortest distance (Requirement 6.5)
  filtered.sort((a, b) => {
    const scoreDiff = b.compositeScore - a.compositeScore;
    if (scoreDiff !== 0) return scoreDiff;
    // Tie-break: shortest distance first
    return a.distanceKm - b.distanceKm;
  });

  // Return at most maxCandidates (Requirement 6.5)
  return filtered.slice(0, maxCandidates);
}

/**
 * Lower-level ranking function that accepts pre-computed ScoredCandidates.
 * Useful for testing and when scores are already computed externally.
 */
export function filterAndRankScored(
  scored: ScoredCandidate[],
  minThreshold: number = DEFAULT_MIN_THRESHOLD,
  maxCandidates: number = DEFAULT_MAX_CANDIDATES
): ScoredCandidate[] {
  // Filter candidates below minimum threshold (Requirement 6.4)
  const filtered = scored.filter((c) => c.compositeScore >= minThreshold);

  // Sort by descending composite score, ties broken by shortest distance (Requirement 6.5)
  filtered.sort((a, b) => {
    const scoreDiff = b.compositeScore - a.compositeScore;
    if (scoreDiff !== 0) return scoreDiff;
    // Tie-break: shortest distance first
    return a.distanceKm - b.distanceKm;
  });

  // Return at most maxCandidates (Requirement 6.5)
  // Return empty list if all candidates filtered out (Requirement 6.6)
  return filtered.slice(0, maxCandidates);
}
