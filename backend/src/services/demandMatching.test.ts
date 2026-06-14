/**
 * Tests for Demand Matching Engine - filterRefusals and candidate validation
 * Task 8.2: Refusal filtering and candidate validation
 *
 * Requirements tested:
 * - 5.4: Exclude candidates who refused same product category within 90 days
 * - 5.2: Cart items must be added within 7 days; intent score must exceed threshold
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { filterRefusals, validateCandidate, DemandCandidate } from './demandMatching';

describe('filterRefusals', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Requirement 5.4: Refusal filtering within 90 days', () => {
    it('should exclude a candidate who refused the same product category within 90 days', () => {
      const candidates: DemandCandidate[] = [
        {
          buyerId: 'buyer-1',
          matchType: 'existing_order',
          matchConfidence: 0.9,
          location: { lat: 28.6, lng: 77.2 },
          distanceKm: 10,
          lastRefusalCheck: {
            refused: true,
            category: 'electronics',
            refusedAt: '2024-04-15T12:00:00Z', // 61 days ago, within 90
            checkDate: '2024-06-15T12:00:00Z',
          },
        },
      ];

      const result = filterRefusals(candidates, 'electronics');
      expect(result).toHaveLength(0);
    });

    it('should NOT exclude a candidate who refused a different product category', () => {
      const candidates: DemandCandidate[] = [
        {
          buyerId: 'buyer-1',
          matchType: 'existing_order',
          matchConfidence: 0.9,
          location: { lat: 28.6, lng: 77.2 },
          distanceKm: 10,
          lastRefusalCheck: {
            refused: true,
            category: 'clothing',
            refusedAt: '2024-05-01T12:00:00Z',
            checkDate: '2024-06-15T12:00:00Z',
          },
        },
      ];

      const result = filterRefusals(candidates, 'electronics');
      expect(result).toHaveLength(1);
    });

    it('should NOT exclude a candidate whose refusal was more than 90 days ago', () => {
      const candidates: DemandCandidate[] = [
        {
          buyerId: 'buyer-1',
          matchType: 'existing_order',
          matchConfidence: 0.9,
          location: { lat: 28.6, lng: 77.2 },
          distanceKm: 10,
          lastRefusalCheck: {
            refused: true,
            category: 'electronics',
            refusedAt: '2024-03-01T12:00:00Z', // 106 days ago, beyond 90
            checkDate: '2024-06-15T12:00:00Z',
          },
        },
      ];

      const result = filterRefusals(candidates, 'electronics');
      expect(result).toHaveLength(1);
    });

    it('should NOT exclude a candidate who has not refused', () => {
      const candidates: DemandCandidate[] = [
        {
          buyerId: 'buyer-1',
          matchType: 'existing_order',
          matchConfidence: 0.9,
          location: { lat: 28.6, lng: 77.2 },
          distanceKm: 10,
          lastRefusalCheck: {
            refused: false,
            checkDate: '2024-06-15T12:00:00Z',
          },
        },
      ];

      const result = filterRefusals(candidates, 'electronics');
      expect(result).toHaveLength(1);
    });

    it('should use checkDate as fallback when refusedAt is missing', () => {
      const candidates: DemandCandidate[] = [
        {
          buyerId: 'buyer-1',
          matchType: 'existing_order',
          matchConfidence: 0.9,
          location: { lat: 28.6, lng: 77.2 },
          distanceKm: 10,
          lastRefusalCheck: {
            refused: true,
            category: 'electronics',
            checkDate: '2024-05-01T12:00:00Z', // 45 days ago, within 90
          },
        },
      ];

      const result = filterRefusals(candidates, 'electronics');
      expect(result).toHaveLength(0);
    });

    it('should respect configurable refusalLookbackDays', () => {
      const candidates: DemandCandidate[] = [
        {
          buyerId: 'buyer-1',
          matchType: 'existing_order',
          matchConfidence: 0.9,
          location: { lat: 28.6, lng: 77.2 },
          distanceKm: 10,
          lastRefusalCheck: {
            refused: true,
            category: 'electronics',
            refusedAt: '2024-06-01T12:00:00Z', // 14 days ago
            checkDate: '2024-06-15T12:00:00Z',
          },
        },
      ];

      // With 10-day lookback, 14-day-old refusal should NOT be excluded
      const result = filterRefusals(candidates, 'electronics', { refusalLookbackDays: 10 });
      expect(result).toHaveLength(1);
    });
  });

  describe('Requirement 5.2: Cart recency validation (7-day window)', () => {
    it('should keep cart candidates added within 7 days', () => {
      const candidates: DemandCandidate[] = [
        {
          buyerId: 'buyer-1',
          matchType: 'cart',
          matchConfidence: 0.8,
          location: { lat: 28.6, lng: 77.2 },
          distanceKm: 15,
          cartAddedAt: '2024-06-10T12:00:00Z', // 5 days ago
          lastRefusalCheck: { refused: false, checkDate: '2024-06-15T12:00:00Z' },
        },
      ];

      const result = filterRefusals(candidates, 'electronics');
      expect(result).toHaveLength(1);
    });

    it('should exclude cart candidates added more than 7 days ago', () => {
      const candidates: DemandCandidate[] = [
        {
          buyerId: 'buyer-1',
          matchType: 'cart',
          matchConfidence: 0.8,
          location: { lat: 28.6, lng: 77.2 },
          distanceKm: 15,
          cartAddedAt: '2024-06-01T12:00:00Z', // 14 days ago
          lastRefusalCheck: { refused: false, checkDate: '2024-06-15T12:00:00Z' },
        },
      ];

      const result = filterRefusals(candidates, 'electronics');
      expect(result).toHaveLength(0);
    });

    it('should exclude cart candidates with no cartAddedAt timestamp', () => {
      const candidates: DemandCandidate[] = [
        {
          buyerId: 'buyer-1',
          matchType: 'cart',
          matchConfidence: 0.8,
          location: { lat: 28.6, lng: 77.2 },
          distanceKm: 15,
          lastRefusalCheck: { refused: false, checkDate: '2024-06-15T12:00:00Z' },
        },
      ];

      const result = filterRefusals(candidates, 'electronics');
      expect(result).toHaveLength(0);
    });

    it('should respect configurable cartRecencyDays', () => {
      const candidates: DemandCandidate[] = [
        {
          buyerId: 'buyer-1',
          matchType: 'cart',
          matchConfidence: 0.8,
          location: { lat: 28.6, lng: 77.2 },
          distanceKm: 15,
          cartAddedAt: '2024-06-12T12:00:00Z', // 3 days ago
          lastRefusalCheck: { refused: false, checkDate: '2024-06-15T12:00:00Z' },
        },
      ];

      // With 2-day window, 3-day-old cart item should be excluded
      const result = filterRefusals(candidates, 'electronics', { cartRecencyDays: 2 });
      expect(result).toHaveLength(0);
    });
  });

  describe('Requirement 5.2: Intent score validation', () => {
    it('should keep predicted_intent candidates with score above threshold', () => {
      const candidates: DemandCandidate[] = [
        {
          buyerId: 'buyer-1',
          matchType: 'predicted_intent',
          matchConfidence: 0.7,
          location: { lat: 28.6, lng: 77.2 },
          distanceKm: 20,
          intentScore: 0.75,
          lastRefusalCheck: { refused: false, checkDate: '2024-06-15T12:00:00Z' },
        },
      ];

      const result = filterRefusals(candidates, 'electronics');
      expect(result).toHaveLength(1);
    });

    it('should exclude predicted_intent candidates with score below threshold (0.6)', () => {
      const candidates: DemandCandidate[] = [
        {
          buyerId: 'buyer-1',
          matchType: 'predicted_intent',
          matchConfidence: 0.7,
          location: { lat: 28.6, lng: 77.2 },
          distanceKm: 20,
          intentScore: 0.5,
          lastRefusalCheck: { refused: false, checkDate: '2024-06-15T12:00:00Z' },
        },
      ];

      const result = filterRefusals(candidates, 'electronics');
      expect(result).toHaveLength(0);
    });

    it('should exclude predicted_intent candidates with no intentScore', () => {
      const candidates: DemandCandidate[] = [
        {
          buyerId: 'buyer-1',
          matchType: 'predicted_intent',
          matchConfidence: 0.7,
          location: { lat: 28.6, lng: 77.2 },
          distanceKm: 20,
          lastRefusalCheck: { refused: false, checkDate: '2024-06-15T12:00:00Z' },
        },
      ];

      const result = filterRefusals(candidates, 'electronics');
      expect(result).toHaveLength(0);
    });

    it('should respect configurable intentThreshold', () => {
      const candidates: DemandCandidate[] = [
        {
          buyerId: 'buyer-1',
          matchType: 'predicted_intent',
          matchConfidence: 0.7,
          location: { lat: 28.6, lng: 77.2 },
          distanceKm: 20,
          intentScore: 0.75,
          lastRefusalCheck: { refused: false, checkDate: '2024-06-15T12:00:00Z' },
        },
      ];

      // With threshold 0.8, score of 0.75 should be excluded
      const result = filterRefusals(candidates, 'electronics', { intentThreshold: 0.8 });
      expect(result).toHaveLength(0);
    });

    it('should NOT apply intent validation to non-predicted_intent types', () => {
      const candidates: DemandCandidate[] = [
        {
          buyerId: 'buyer-1',
          matchType: 'existing_order',
          matchConfidence: 0.9,
          location: { lat: 28.6, lng: 77.2 },
          distanceKm: 5,
          lastRefusalCheck: { refused: false, checkDate: '2024-06-15T12:00:00Z' },
        },
        {
          buyerId: 'buyer-2',
          matchType: 'wishlist',
          matchConfidence: 0.6,
          location: { lat: 28.7, lng: 77.3 },
          distanceKm: 12,
          lastRefusalCheck: { refused: false, checkDate: '2024-06-15T12:00:00Z' },
        },
      ];

      const result = filterRefusals(candidates, 'electronics');
      expect(result).toHaveLength(2);
    });
  });

  describe('Combined filtering', () => {
    it('should apply all filters together on a mixed candidate set', () => {
      const candidates: DemandCandidate[] = [
        // Should pass: existing_order, no refusal
        {
          buyerId: 'buyer-1',
          matchType: 'existing_order',
          matchConfidence: 0.9,
          location: { lat: 28.6, lng: 77.2 },
          distanceKm: 5,
          lastRefusalCheck: { refused: false, checkDate: '2024-06-15T12:00:00Z' },
        },
        // Should fail: refused same category within 90 days
        {
          buyerId: 'buyer-2',
          matchType: 'existing_order',
          matchConfidence: 0.85,
          location: { lat: 28.7, lng: 77.3 },
          distanceKm: 12,
          lastRefusalCheck: {
            refused: true,
            category: 'electronics',
            refusedAt: '2024-05-20T12:00:00Z',
            checkDate: '2024-06-15T12:00:00Z',
          },
        },
        // Should pass: cart added 3 days ago
        {
          buyerId: 'buyer-3',
          matchType: 'cart',
          matchConfidence: 0.8,
          location: { lat: 28.65, lng: 77.25 },
          distanceKm: 8,
          cartAddedAt: '2024-06-12T12:00:00Z',
          lastRefusalCheck: { refused: false, checkDate: '2024-06-15T12:00:00Z' },
        },
        // Should fail: cart added 10 days ago
        {
          buyerId: 'buyer-4',
          matchType: 'cart',
          matchConfidence: 0.7,
          location: { lat: 28.55, lng: 77.15 },
          distanceKm: 18,
          cartAddedAt: '2024-06-05T12:00:00Z',
          lastRefusalCheck: { refused: false, checkDate: '2024-06-15T12:00:00Z' },
        },
        // Should pass: intent score 0.8 > threshold 0.6
        {
          buyerId: 'buyer-5',
          matchType: 'predicted_intent',
          matchConfidence: 0.75,
          location: { lat: 28.62, lng: 77.22 },
          distanceKm: 7,
          intentScore: 0.8,
          lastRefusalCheck: { refused: false, checkDate: '2024-06-15T12:00:00Z' },
        },
        // Should fail: intent score 0.4 < threshold 0.6
        {
          buyerId: 'buyer-6',
          matchType: 'predicted_intent',
          matchConfidence: 0.5,
          location: { lat: 28.58, lng: 77.18 },
          distanceKm: 22,
          intentScore: 0.4,
          lastRefusalCheck: { refused: false, checkDate: '2024-06-15T12:00:00Z' },
        },
      ];

      const result = filterRefusals(candidates, 'electronics');
      expect(result).toHaveLength(3);
      expect(result.map((c) => c.buyerId)).toEqual(['buyer-1', 'buyer-3', 'buyer-5']);
    });

    it('should return empty array when all candidates are filtered out', () => {
      const candidates: DemandCandidate[] = [
        {
          buyerId: 'buyer-1',
          matchType: 'cart',
          matchConfidence: 0.8,
          location: { lat: 28.6, lng: 77.2 },
          distanceKm: 10,
          cartAddedAt: '2024-05-01T12:00:00Z', // too old
          lastRefusalCheck: { refused: false, checkDate: '2024-06-15T12:00:00Z' },
        },
        {
          buyerId: 'buyer-2',
          matchType: 'predicted_intent',
          matchConfidence: 0.5,
          location: { lat: 28.7, lng: 77.3 },
          distanceKm: 15,
          intentScore: 0.3, // below threshold
          lastRefusalCheck: { refused: false, checkDate: '2024-06-15T12:00:00Z' },
        },
      ];

      const result = filterRefusals(candidates, 'electronics');
      expect(result).toHaveLength(0);
    });

    it('should return empty array for empty input', () => {
      const result = filterRefusals([], 'electronics');
      expect(result).toHaveLength(0);
    });
  });
});

describe('validateCandidate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return valid for existing_order type with no issues', () => {
    const candidate: DemandCandidate = {
      buyerId: 'buyer-1',
      matchType: 'existing_order',
      matchConfidence: 0.9,
      location: { lat: 28.6, lng: 77.2 },
      distanceKm: 5,
      lastRefusalCheck: { refused: false, checkDate: '2024-06-15T12:00:00Z' },
    };

    const result = validateCandidate(candidate);
    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('should return invalid for cart with missing cartAddedAt', () => {
    const candidate: DemandCandidate = {
      buyerId: 'buyer-1',
      matchType: 'cart',
      matchConfidence: 0.8,
      location: { lat: 28.6, lng: 77.2 },
      distanceKm: 10,
      lastRefusalCheck: { refused: false, checkDate: '2024-06-15T12:00:00Z' },
    };

    const result = validateCandidate(candidate);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('missing addedAt timestamp');
  });

  it('should return invalid for cart older than recency window', () => {
    const candidate: DemandCandidate = {
      buyerId: 'buyer-1',
      matchType: 'cart',
      matchConfidence: 0.8,
      location: { lat: 28.6, lng: 77.2 },
      distanceKm: 10,
      cartAddedAt: '2024-06-01T12:00:00Z', // 14 days ago
      lastRefusalCheck: { refused: false, checkDate: '2024-06-15T12:00:00Z' },
    };

    const result = validateCandidate(candidate);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('exceeds');
  });

  it('should return invalid for predicted_intent with missing intentScore', () => {
    const candidate: DemandCandidate = {
      buyerId: 'buyer-1',
      matchType: 'predicted_intent',
      matchConfidence: 0.7,
      location: { lat: 28.6, lng: 77.2 },
      distanceKm: 20,
      lastRefusalCheck: { refused: false, checkDate: '2024-06-15T12:00:00Z' },
    };

    const result = validateCandidate(candidate);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('missing intentScore');
  });

  it('should return invalid for predicted_intent with score below threshold', () => {
    const candidate: DemandCandidate = {
      buyerId: 'buyer-1',
      matchType: 'predicted_intent',
      matchConfidence: 0.7,
      location: { lat: 28.6, lng: 77.2 },
      distanceKm: 20,
      intentScore: 0.4,
      lastRefusalCheck: { refused: false, checkDate: '2024-06-15T12:00:00Z' },
    };

    const result = validateCandidate(candidate);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('below threshold');
  });

  it('should return valid for wishlist type without special constraints', () => {
    const candidate: DemandCandidate = {
      buyerId: 'buyer-1',
      matchType: 'wishlist',
      matchConfidence: 0.6,
      location: { lat: 28.6, lng: 77.2 },
      distanceKm: 30,
      lastRefusalCheck: { refused: false, checkDate: '2024-06-15T12:00:00Z' },
    };

    const result = validateCandidate(candidate);
    expect(result.valid).toBe(true);
  });
});
