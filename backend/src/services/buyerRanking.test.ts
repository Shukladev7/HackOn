/**
 * Tests for Buyer Ranking Engine - Tasks 9.1 and 9.2
 * Covers:
 *  - 9.1: Composite score calculation with configurable weights (Requirements 6.1, 6.2, 6.3)
 *  - 9.2: Ranking, filtering, output limits (Requirements 6.4, 6.5, 6.6)
 */
import { describe, it, expect } from 'vitest';
import {
  rankCandidates,
  filterAndRankScored,
  computeCompositeScore,
  normalizeDistance,
  DemandCandidate,
  ScoredCandidate,
  RankingWeights,
  CandidateFactors,
} from './buyerRanking';

// --- Helpers ---

function makeDemandCandidate(overrides: Partial<DemandCandidate> = {}): DemandCandidate {
  return {
    buyerId: overrides.buyerId ?? 'buyer-1',
    matchType: overrides.matchType ?? 'existing_order',
    matchConfidence: overrides.matchConfidence ?? 0.8,
    location: overrides.location ?? { lat: 28.6, lng: 77.2 },
    distanceKm: overrides.distanceKm ?? 10,
    lastRefusalCheck: overrides.lastRefusalCheck ?? { refused: false, checkDate: new Date().toISOString() },
    ...overrides,
  };
}

function makeScoredCandidate(overrides: Partial<ScoredCandidate> = {}): ScoredCandidate {
  return {
    buyerId: overrides.buyerId ?? 'buyer-1',
    compositeScore: overrides.compositeScore ?? 0.7,
    distanceKm: overrides.distanceKm ?? 10,
    factors: overrides.factors ?? {
      distance: { value: 0.8, imputed: false },
      conversionProbability: { value: 0.7, imputed: false },
      deliverySpeed: { value: 0.5, imputed: true },
      marginImpact: { value: 0.5, imputed: true },
    },
    partiallyScored: overrides.partiallyScored ?? false,
  };
}

// --- Unit Tests for Task 9.1: Composite Score Calculation ---

describe('buyerRanking - computeCompositeScore (Task 9.1)', () => {
  describe('Requirement 6.1: Composite score = weighted sum of factors', () => {
    it('should compute correct weighted sum with all factors present', () => {
      const factors: CandidateFactors = {
        distance: 0.8,
        conversionProbability: 0.9,
        deliverySpeed: 0.7,
        marginImpact: 0.6,
      };
      // Default weights: distance=0.25, conversion=0.35, speed=0.20, margin=0.20
      // Expected: 0.25*0.8 + 0.35*0.9 + 0.20*0.7 + 0.20*0.6
      //         = 0.2 + 0.315 + 0.14 + 0.12 = 0.775
      const result = computeCompositeScore(factors);
      expect(result.score).toBeCloseTo(0.775, 10);
      expect(result.partiallyScored).toBe(false);
    });

    it('should produce 0.0 when all factors are 0.0', () => {
      const factors: CandidateFactors = {
        distance: 0.0,
        conversionProbability: 0.0,
        deliverySpeed: 0.0,
        marginImpact: 0.0,
      };
      const result = computeCompositeScore(factors);
      expect(result.score).toBeCloseTo(0.0, 10);
    });

    it('should produce 1.0 when all factors are 1.0', () => {
      const factors: CandidateFactors = {
        distance: 1.0,
        conversionProbability: 1.0,
        deliverySpeed: 1.0,
        marginImpact: 1.0,
      };
      const result = computeCompositeScore(factors);
      expect(result.score).toBeCloseTo(1.0, 10);
    });

    it('should correctly weight conversion probability highest', () => {
      // Only conversionProbability is 1.0, rest are 0.0
      const factors: CandidateFactors = {
        distance: 0.0,
        conversionProbability: 1.0,
        deliverySpeed: 0.0,
        marginImpact: 0.0,
      };
      const result = computeCompositeScore(factors);
      // Score should equal the conversionProbability weight: 0.35
      expect(result.score).toBeCloseTo(0.35, 10);
    });

    it('should correctly weight distance', () => {
      const factors: CandidateFactors = {
        distance: 1.0,
        conversionProbability: 0.0,
        deliverySpeed: 0.0,
        marginImpact: 0.0,
      };
      const result = computeCompositeScore(factors);
      expect(result.score).toBeCloseTo(0.25, 10);
    });

    it('should correctly weight delivery speed and margin impact equally', () => {
      const speedOnly: CandidateFactors = {
        distance: 0.0,
        conversionProbability: 0.0,
        deliverySpeed: 1.0,
        marginImpact: 0.0,
      };
      const marginOnly: CandidateFactors = {
        distance: 0.0,
        conversionProbability: 0.0,
        deliverySpeed: 0.0,
        marginImpact: 1.0,
      };
      const speedResult = computeCompositeScore(speedOnly);
      const marginResult = computeCompositeScore(marginOnly);
      // Both should be 0.20
      expect(speedResult.score).toBeCloseTo(0.20, 10);
      expect(marginResult.score).toBeCloseTo(0.20, 10);
    });

    it('should clamp result to [0, 1]', () => {
      // Even with all factors at 1.0 and valid weights, result should be at most 1.0
      const factors: CandidateFactors = {
        distance: 1.0,
        conversionProbability: 1.0,
        deliverySpeed: 1.0,
        marginImpact: 1.0,
      };
      const result = computeCompositeScore(factors);
      expect(result.score).toBeGreaterThanOrEqual(0.0);
      expect(result.score).toBeLessThanOrEqual(1.0);
    });
  });

  describe('Requirement 6.2: Configurable weights summing to 1.0', () => {
    it('should use custom weights when provided', () => {
      const factors: CandidateFactors = {
        distance: 1.0,
        conversionProbability: 0.0,
        deliverySpeed: 0.0,
        marginImpact: 0.0,
      };
      const customWeights: RankingWeights = {
        distance: 0.7,
        conversionProbability: 0.1,
        deliverySpeed: 0.1,
        marginImpact: 0.1,
      };
      const result = computeCompositeScore(factors, customWeights);
      // 0.7*1.0 + 0.1*0.0 + 0.1*0.0 + 0.1*0.0 = 0.7
      expect(result.score).toBeCloseTo(0.7, 10);
    });

    it('should correctly apply equal weights', () => {
      const factors: CandidateFactors = {
        distance: 0.4,
        conversionProbability: 0.6,
        deliverySpeed: 0.8,
        marginImpact: 1.0,
      };
      const equalWeights: RankingWeights = {
        distance: 0.25,
        conversionProbability: 0.25,
        deliverySpeed: 0.25,
        marginImpact: 0.25,
      };
      const result = computeCompositeScore(factors, equalWeights);
      // 0.25*(0.4+0.6+0.8+1.0) = 0.25*2.8 = 0.7
      expect(result.score).toBeCloseTo(0.7, 10);
    });

    it('should work with extreme weight distributions', () => {
      const factors: CandidateFactors = {
        distance: 0.9,
        conversionProbability: 0.1,
        deliverySpeed: 0.5,
        marginImpact: 0.3,
      };
      // All weight on conversionProbability
      const extremeWeights: RankingWeights = {
        distance: 0.0,
        conversionProbability: 1.0,
        deliverySpeed: 0.0,
        marginImpact: 0.0,
      };
      const result = computeCompositeScore(factors, extremeWeights);
      expect(result.score).toBeCloseTo(0.1, 10);
    });
  });

  describe('Requirement 6.3: Missing factors assigned 0.5 and flagged', () => {
    it('should assign neutral value 0.5 for missing distance', () => {
      const factors: CandidateFactors = {
        conversionProbability: 1.0,
        deliverySpeed: 1.0,
        marginImpact: 1.0,
      };
      const result = computeCompositeScore(factors);
      expect(result.scoredFactors.distance.value).toBe(0.5);
      expect(result.scoredFactors.distance.imputed).toBe(true);
      expect(result.partiallyScored).toBe(true);
      // 0.25*0.5 + 0.35*1.0 + 0.20*1.0 + 0.20*1.0 = 0.125 + 0.35 + 0.2 + 0.2 = 0.875
      expect(result.score).toBeCloseTo(0.875, 10);
    });

    it('should assign neutral value 0.5 for missing conversionProbability', () => {
      const factors: CandidateFactors = {
        distance: 1.0,
        deliverySpeed: 1.0,
        marginImpact: 1.0,
      };
      const result = computeCompositeScore(factors);
      expect(result.scoredFactors.conversionProbability.value).toBe(0.5);
      expect(result.scoredFactors.conversionProbability.imputed).toBe(true);
      expect(result.partiallyScored).toBe(true);
    });

    it('should assign neutral value 0.5 for all missing factors', () => {
      const factors: CandidateFactors = {};
      const result = computeCompositeScore(factors);
      // All factors = 0.5, sum of weights = 1.0, score = 0.5
      expect(result.score).toBeCloseTo(0.5, 10);
      expect(result.scoredFactors.distance.imputed).toBe(true);
      expect(result.scoredFactors.conversionProbability.imputed).toBe(true);
      expect(result.scoredFactors.deliverySpeed.imputed).toBe(true);
      expect(result.scoredFactors.marginImpact.imputed).toBe(true);
      expect(result.partiallyScored).toBe(true);
    });

    it('should not flag factors that are present', () => {
      const factors: CandidateFactors = {
        distance: 0.6,
        conversionProbability: 0.7,
        deliverySpeed: 0.8,
        marginImpact: 0.9,
      };
      const result = computeCompositeScore(factors);
      expect(result.scoredFactors.distance.imputed).toBe(false);
      expect(result.scoredFactors.conversionProbability.imputed).toBe(false);
      expect(result.scoredFactors.deliverySpeed.imputed).toBe(false);
      expect(result.scoredFactors.marginImpact.imputed).toBe(false);
      expect(result.partiallyScored).toBe(false);
    });

    it('should flag partiallyScored when any single factor is missing', () => {
      const factors: CandidateFactors = {
        distance: 0.8,
        conversionProbability: 0.7,
        deliverySpeed: 0.6,
        // marginImpact is missing
      };
      const result = computeCompositeScore(factors);
      expect(result.partiallyScored).toBe(true);
      expect(result.scoredFactors.marginImpact.imputed).toBe(true);
      expect(result.scoredFactors.marginImpact.value).toBe(0.5);
      // Present factors should not be imputed
      expect(result.scoredFactors.distance.imputed).toBe(false);
      expect(result.scoredFactors.conversionProbability.imputed).toBe(false);
      expect(result.scoredFactors.deliverySpeed.imputed).toBe(false);
    });
  });
});

describe('buyerRanking - normalizeDistance', () => {
  it('should return 1.0 for distance 0', () => {
    expect(normalizeDistance(0, 50)).toBe(1.0);
  });

  it('should return 0.0 for distance at max radius', () => {
    expect(normalizeDistance(50, 50)).toBe(0.0);
  });

  it('should return 0.5 for distance at half max radius', () => {
    expect(normalizeDistance(25, 50)).toBeCloseTo(0.5, 10);
  });

  it('should return 0.0 for distance beyond max radius', () => {
    expect(normalizeDistance(100, 50)).toBe(0.0);
  });
});

// --- Unit Tests for Task 9.2: Ranking, Filtering, Output ---

describe('buyerRanking - rankCandidates', () => {
  const packageDetails = { price: 1000, category: 'electronics' };

  describe('Requirement 6.4: Filter candidates below minimum threshold', () => {
    it('should filter out candidates with composite score below default threshold (0.4)', () => {
      // Create candidates: one with high confidence (will score above 0.4) and one with very low confidence
      const candidates = [
        makeDemandCandidate({ buyerId: 'high', matchConfidence: 0.9, distanceKm: 5 }),
        makeDemandCandidate({ buyerId: 'low', matchConfidence: 0.1, distanceKm: 45 }),
      ];

      const result = rankCandidates(candidates, packageDetails);

      // The 'high' candidate should remain, 'low' may be filtered depending on score
      const buyerIds = result.map((c) => c.buyerId);
      // All returned candidates must meet the threshold
      result.forEach((c) => {
        expect(c.compositeScore).toBeGreaterThanOrEqual(0.4);
      });
    });

    it('should use configurable threshold when provided', () => {
      const candidates = [
        makeDemandCandidate({ buyerId: 'a', matchConfidence: 0.6, distanceKm: 20 }),
        makeDemandCandidate({ buyerId: 'b', matchConfidence: 0.5, distanceKm: 10 }),
      ];

      // High threshold - may filter more candidates
      const resultHighThreshold = rankCandidates(candidates, packageDetails, undefined, 0.9);
      resultHighThreshold.forEach((c) => {
        expect(c.compositeScore).toBeGreaterThanOrEqual(0.9);
      });

      // Low threshold - should keep more
      const resultLowThreshold = rankCandidates(candidates, packageDetails, undefined, 0.1);
      resultLowThreshold.forEach((c) => {
        expect(c.compositeScore).toBeGreaterThanOrEqual(0.1);
      });
    });
  });

  describe('Requirement 6.5: Sorted descending, ties broken by distance, max 10', () => {
    it('should sort by descending composite score', () => {
      const candidates = [
        makeDemandCandidate({ buyerId: 'low', matchConfidence: 0.5, distanceKm: 5 }),
        makeDemandCandidate({ buyerId: 'high', matchConfidence: 0.95, distanceKm: 5 }),
        makeDemandCandidate({ buyerId: 'mid', matchConfidence: 0.7, distanceKm: 5 }),
      ];

      const result = rankCandidates(candidates, packageDetails, undefined, 0.0);

      // Verify descending order
      for (let i = 1; i < result.length; i++) {
        expect(result[i - 1].compositeScore).toBeGreaterThanOrEqual(result[i].compositeScore);
      }
    });

    it('should break ties by shortest distance', () => {
      // Same confidence but different distances → same score means distance tie-break
      const candidates = [
        makeDemandCandidate({ buyerId: 'far', matchConfidence: 0.8, distanceKm: 30 }),
        makeDemandCandidate({ buyerId: 'near', matchConfidence: 0.8, distanceKm: 5 }),
      ];

      // Using equal weights where distance factor also depends on distanceKm
      // The scores won't be exactly equal because distance factor differs,
      // so let's use filterAndRankScored to control scores directly
      const scored: ScoredCandidate[] = [
        makeScoredCandidate({ buyerId: 'far', compositeScore: 0.7, distanceKm: 30 }),
        makeScoredCandidate({ buyerId: 'near', compositeScore: 0.7, distanceKm: 5 }),
      ];

      const result = filterAndRankScored(scored, 0.0);

      expect(result[0].buyerId).toBe('near');
      expect(result[1].buyerId).toBe('far');
    });

    it('should return at most 10 candidates', () => {
      // Create 15 candidates
      const candidates = Array.from({ length: 15 }, (_, i) =>
        makeDemandCandidate({
          buyerId: `buyer-${i}`,
          matchConfidence: 0.9,
          distanceKm: 5 + i,
        })
      );

      const result = rankCandidates(candidates, packageDetails, undefined, 0.0);
      expect(result.length).toBeLessThanOrEqual(10);
    });

    it('should respect custom max candidates limit', () => {
      const candidates = Array.from({ length: 10 }, (_, i) =>
        makeDemandCandidate({
          buyerId: `buyer-${i}`,
          matchConfidence: 0.9,
          distanceKm: 5 + i,
        })
      );

      const result = rankCandidates(candidates, packageDetails, undefined, 0.0, 5);
      expect(result.length).toBeLessThanOrEqual(5);
    });
  });

  describe('Requirement 6.6: Return empty list if all candidates filtered out', () => {
    it('should return empty list when all candidates are below threshold', () => {
      // Very low matchConfidence + far distance = low score
      const candidates = [
        makeDemandCandidate({ buyerId: 'a', matchConfidence: 0.1, distanceKm: 48 }),
        makeDemandCandidate({ buyerId: 'b', matchConfidence: 0.05, distanceKm: 49 }),
      ];

      // High threshold
      const result = rankCandidates(candidates, packageDetails, undefined, 0.95);
      expect(result).toEqual([]);
    });

    it('should return empty list when given no candidates', () => {
      const result = rankCandidates([], packageDetails);
      expect(result).toEqual([]);
    });
  });
});

describe('buyerRanking - filterAndRankScored', () => {
  describe('Requirement 6.4: Filter by minimum threshold', () => {
    it('should keep only candidates at or above the threshold', () => {
      const scored: ScoredCandidate[] = [
        makeScoredCandidate({ buyerId: 'a', compositeScore: 0.8, distanceKm: 10 }),
        makeScoredCandidate({ buyerId: 'b', compositeScore: 0.4, distanceKm: 20 }),
        makeScoredCandidate({ buyerId: 'c', compositeScore: 0.39, distanceKm: 5 }),
        makeScoredCandidate({ buyerId: 'd', compositeScore: 0.2, distanceKm: 15 }),
      ];

      const result = filterAndRankScored(scored, 0.4);

      expect(result.length).toBe(2);
      expect(result.map((c) => c.buyerId)).toEqual(['a', 'b']);
    });

    it('should include candidates exactly at the threshold', () => {
      const scored: ScoredCandidate[] = [
        makeScoredCandidate({ buyerId: 'exact', compositeScore: 0.4, distanceKm: 10 }),
      ];

      const result = filterAndRankScored(scored, 0.4);
      expect(result.length).toBe(1);
      expect(result[0].buyerId).toBe('exact');
    });
  });

  describe('Requirement 6.5: Sorting and output limit', () => {
    it('should sort descending by score with distance tie-break', () => {
      const scored: ScoredCandidate[] = [
        makeScoredCandidate({ buyerId: 'c', compositeScore: 0.5, distanceKm: 10 }),
        makeScoredCandidate({ buyerId: 'a', compositeScore: 0.9, distanceKm: 30 }),
        makeScoredCandidate({ buyerId: 'b', compositeScore: 0.7, distanceKm: 5 }),
        makeScoredCandidate({ buyerId: 'd', compositeScore: 0.5, distanceKm: 3 }),
      ];

      const result = filterAndRankScored(scored, 0.0);

      expect(result[0].buyerId).toBe('a'); // highest score
      expect(result[1].buyerId).toBe('b'); // second highest
      // 'c' and 'd' tie at 0.5; 'd' is closer (3km vs 10km)
      expect(result[2].buyerId).toBe('d');
      expect(result[3].buyerId).toBe('c');
    });

    it('should cap output at 10 candidates', () => {
      const scored: ScoredCandidate[] = Array.from({ length: 20 }, (_, i) =>
        makeScoredCandidate({ buyerId: `buyer-${i}`, compositeScore: 0.9 - i * 0.01, distanceKm: 10 })
      );

      const result = filterAndRankScored(scored, 0.0);
      expect(result.length).toBe(10);
    });

    it('should cap at custom max when provided', () => {
      const scored: ScoredCandidate[] = Array.from({ length: 10 }, (_, i) =>
        makeScoredCandidate({ buyerId: `buyer-${i}`, compositeScore: 0.9, distanceKm: i + 1 })
      );

      const result = filterAndRankScored(scored, 0.0, 3);
      expect(result.length).toBe(3);
    });

    it('should return top candidates by score when limited', () => {
      const scored: ScoredCandidate[] = [
        makeScoredCandidate({ buyerId: 'top', compositeScore: 0.95, distanceKm: 10 }),
        makeScoredCandidate({ buyerId: 'mid', compositeScore: 0.7, distanceKm: 5 }),
        makeScoredCandidate({ buyerId: 'low', compositeScore: 0.5, distanceKm: 2 }),
      ];

      const result = filterAndRankScored(scored, 0.0, 2);
      expect(result.map((c) => c.buyerId)).toEqual(['top', 'mid']);
    });
  });

  describe('Requirement 6.6: Empty list on all filtered', () => {
    it('should return empty array when threshold filters everything', () => {
      const scored: ScoredCandidate[] = [
        makeScoredCandidate({ buyerId: 'a', compositeScore: 0.3, distanceKm: 10 }),
        makeScoredCandidate({ buyerId: 'b', compositeScore: 0.2, distanceKm: 5 }),
      ];

      const result = filterAndRankScored(scored, 0.5);
      expect(result).toEqual([]);
    });

    it('should return empty array for empty input', () => {
      const result = filterAndRankScored([], 0.4);
      expect(result).toEqual([]);
    });
  });
});
