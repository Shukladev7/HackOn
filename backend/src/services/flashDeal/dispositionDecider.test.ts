import { describe, it, expect } from 'vitest';
import { decide, getColorMapping, getDisplayLabel } from './dispositionDecider';
import { DispositionDecision } from './types';

describe('dispositionDecider', () => {
  describe('decide()', () => {
    it('returns FLASH_DEAL when score >= 75 and confidence >= 60', () => {
      const result = decide(80, 70, 'A');
      expect(result.decision).toBe('FLASH_DEAL');
      expect(result.matchedRule).toContain('75');
      expect(result.flashDealScore).toBe(80);
      expect(result.confidenceScore).toBe(70);
      expect(result.inspectionGrade).toBe('A');
    });

    it('returns FLASH_DEAL at boundary (score=75, confidence=60)', () => {
      const result = decide(75, 60, 'C');
      expect(result.decision).toBe('FLASH_DEAL');
    });

    it('returns AMAZON_RENEWED when score 50-74 and grade A or B', () => {
      const result = decide(60, 70, 'A');
      expect(result.decision).toBe('AMAZON_RENEWED');
    });

    it('returns AMAZON_RENEWED with grade B', () => {
      const result = decide(50, 80, 'B');
      expect(result.decision).toBe('AMAZON_RENEWED');
    });

    it('returns NORMAL_RESALE when score 30-74 and grade C, D, or F', () => {
      const result = decide(45, 70, 'C');
      expect(result.decision).toBe('NORMAL_RESALE');
    });

    it('returns NORMAL_RESALE with grade D', () => {
      const result = decide(50, 80, 'D');
      expect(result.decision).toBe('NORMAL_RESALE');
    });

    it('returns NORMAL_RESALE with grade F', () => {
      const result = decide(30, 65, 'F');
      expect(result.decision).toBe('NORMAL_RESALE');
    });

    it('returns CIRCULAR_ROUTING when score 15-29', () => {
      const result = decide(22, 70, 'A');
      expect(result.decision).toBe('CIRCULAR_ROUTING');
    });

    it('returns CIRCULAR_ROUTING at boundary (score=15)', () => {
      const result = decide(15, 80, 'B');
      expect(result.decision).toBe('CIRCULAR_ROUTING');
    });

    it('returns CIRCULAR_ROUTING at boundary (score=29)', () => {
      const result = decide(29, 90, 'A');
      expect(result.decision).toBe('CIRCULAR_ROUTING');
    });

    it('returns WAREHOUSE_RETURN when score < 15', () => {
      const result = decide(10, 80, 'A');
      expect(result.decision).toBe('WAREHOUSE_RETURN');
    });

    it('returns WAREHOUSE_RETURN when confidence < 30 and no higher-priority rule matches', () => {
      // score=10 means no higher-priority rule (FLASH_DEAL, AMAZON_RENEWED, NORMAL_RESALE, CIRCULAR_ROUTING) matches
      const result = decide(10, 20, 'A');
      expect(result.decision).toBe('WAREHOUSE_RETURN');
    });

    it('higher-priority rule wins even when confidence < 30', () => {
      // score=60, grade=A matches AMAZON_RENEWED (priority 2) before WAREHOUSE_RETURN (priority 5)
      const result = decide(60, 20, 'A');
      expect(result.decision).toBe('AMAZON_RENEWED');
    });

    it('returns WAREHOUSE_RETURN when score=0 and confidence=0', () => {
      const result = decide(0, 0, 'F');
      expect(result.decision).toBe('WAREHOUSE_RETURN');
    });

    // Priority tests: FLASH_DEAL takes priority over WAREHOUSE_RETURN (confidence < 30)
    it('FLASH_DEAL priority wins over WAREHOUSE_RETURN when score >= 75 but confidence < 30', () => {
      // score >= 75 matches FLASH_DEAL rule, but confidence < 30 also matches WAREHOUSE_RETURN
      // However, FLASH_DEAL requires confidence >= 60, so with confidence < 30 it won't match FLASH_DEAL
      const result = decide(80, 25, 'A');
      // FLASH_DEAL condition is score >= 75 AND confidence >= 60 — confidence 25 fails
      // AMAZON_RENEWED: score 50-74 — score 80 fails
      // NORMAL_RESALE: score 30-74 — score 80 fails
      // CIRCULAR_ROUTING: score 15-29 — score 80 fails
      // WAREHOUSE_RETURN: score < 15 OR confidence < 30 — confidence 25 matches
      expect(result.decision).toBe('WAREHOUSE_RETURN');
    });

    it('FLASH_DEAL takes priority when both FLASH_DEAL and WAREHOUSE_RETURN could match conceptually', () => {
      // score=75, confidence=60 satisfies FLASH_DEAL (priority 1)
      const result = decide(75, 60, 'A');
      expect(result.decision).toBe('FLASH_DEAL');
    });

    it('defaults to WAREHOUSE_RETURN when no rule explicitly matches', () => {
      // score=74 (not >= 75 for FLASH_DEAL), confidence=50 (not < 30 for WAREHOUSE_RETURN)
      // grade='X' (not A/B for AMAZON_RENEWED, not C/D/F for NORMAL_RESALE)
      // score not in 15-29 for CIRCULAR_ROUTING
      // No rule matches — fallback to WAREHOUSE_RETURN
      const result = decide(74, 50, 'X');
      expect(result.decision).toBe('WAREHOUSE_RETURN');
      expect(result.matchedRule).toContain('Default');
    });

    it('always returns all expected fields in the result', () => {
      const result = decide(55, 65, 'B');
      expect(result).toHaveProperty('decision');
      expect(result).toHaveProperty('matchedRule');
      expect(result).toHaveProperty('flashDealScore');
      expect(result).toHaveProperty('confidenceScore');
      expect(result).toHaveProperty('inspectionGrade');
    });
  });

  describe('getColorMapping()', () => {
    const expectedColors: [DispositionDecision, string][] = [
      ['FLASH_DEAL', 'green'],
      ['AMAZON_RENEWED', 'blue'],
      ['NORMAL_RESALE', 'amber'],
      ['CIRCULAR_ROUTING', 'purple'],
      ['WAREHOUSE_RETURN', 'red'],
    ];

    it.each(expectedColors)('maps %s to %s', (decision, color) => {
      expect(getColorMapping(decision)).toBe(color);
    });
  });

  describe('getDisplayLabel()', () => {
    const expectedLabels: [DispositionDecision, string][] = [
      ['FLASH_DEAL', 'Flash Deal'],
      ['AMAZON_RENEWED', 'Amazon Renewed'],
      ['NORMAL_RESALE', 'Normal Resale'],
      ['CIRCULAR_ROUTING', 'Circular Routing'],
      ['WAREHOUSE_RETURN', 'Warehouse Return'],
    ];

    it.each(expectedLabels)('maps %s to "%s"', (decision, label) => {
      expect(getDisplayLabel(decision)).toBe(label);
    });
  });
});
