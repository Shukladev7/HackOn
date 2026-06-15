/**
 * Disposition Decider Service
 *
 * Maps Flash Deal Score + Confidence Score + Inspection Grade to exactly one
 * of five dispositions using priority-ordered threshold rules.
 *
 * Requirements: 3.3, 3.4, 3.5, 8.4
 */

import { DispositionDecision, DispositionResult } from './types';

// ─── Disposition Rule Interface ──────────────────────────────────────────────

interface DispositionRule {
  decision: DispositionDecision;
  priority: number;
  description: string;
  condition: (score: number, confidence: number, grade: string) => boolean;
}

// ─── Priority-Ordered Disposition Rules ──────────────────────────────────────

const DISPOSITION_RULES: DispositionRule[] = [
  {
    decision: 'FLASH_DEAL',
    priority: 1,
    description: 'Score ≥ 75 AND Confidence ≥ 60',
    condition: (score, confidence) => score >= 75 && confidence >= 60,
  },
  {
    decision: 'AMAZON_RENEWED',
    priority: 2,
    description: 'Score 50–74 AND Grade A or B',
    condition: (score, _confidence, grade) =>
      score >= 50 && score <= 74 && ['A', 'B'].includes(grade),
  },
  {
    decision: 'NORMAL_RESALE',
    priority: 3,
    description: 'Score 30–74 AND Grade C, D, or F',
    condition: (score, _confidence, grade) =>
      score >= 30 && score <= 74 && ['C', 'D', 'F'].includes(grade),
  },
  {
    decision: 'CIRCULAR_ROUTING',
    priority: 4,
    description: 'Score 15–29',
    condition: (score) => score >= 15 && score <= 29,
  },
  {
    decision: 'WAREHOUSE_RETURN',
    priority: 5,
    description: 'Score < 15 OR Confidence < 30',
    condition: (score, confidence) => score < 15 || confidence < 30,
  },
];

// ─── Color Mapping ───────────────────────────────────────────────────────────

const COLOR_MAP: Record<DispositionDecision, string> = {
  FLASH_DEAL: 'green',
  AMAZON_RENEWED: 'blue',
  NORMAL_RESALE: 'amber',
  CIRCULAR_ROUTING: 'purple',
  WAREHOUSE_RETURN: 'red',
};

// ─── Display Label Mapping ───────────────────────────────────────────────────

const DISPLAY_LABEL_MAP: Record<DispositionDecision, string> = {
  FLASH_DEAL: 'Flash Deal',
  AMAZON_RENEWED: 'Amazon Renewed',
  NORMAL_RESALE: 'Normal Resale',
  CIRCULAR_ROUTING: 'Circular Routing',
  WAREHOUSE_RETURN: 'Warehouse Return',
};

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Determines the disposition for a product based on score, confidence, and grade.
 * Checks rules in priority order (1 = highest) and returns the first match.
 * Defaults to WAREHOUSE_RETURN if no rule explicitly matches.
 */
export function decide(
  score: number,
  confidence: number,
  inspectionGrade: string
): DispositionResult {
  for (const rule of DISPOSITION_RULES) {
    if (rule.condition(score, confidence, inspectionGrade)) {
      return {
        decision: rule.decision,
        matchedRule: rule.description,
        flashDealScore: score,
        confidenceScore: confidence,
        inspectionGrade,
      };
    }
  }

  // Default fallback — should not normally be reached given the rules above,
  // but guarantees exactly one disposition is always assigned.
  return {
    decision: 'WAREHOUSE_RETURN',
    matchedRule: 'Default fallback — no explicit rule matched',
    flashDealScore: score,
    confidenceScore: confidence,
    inspectionGrade,
  };
}

/**
 * Returns the UI color associated with a disposition decision.
 */
export function getColorMapping(decision: DispositionDecision): string {
  return COLOR_MAP[decision];
}

/**
 * Returns the human-readable display label for a disposition decision.
 */
export function getDisplayLabel(decision: DispositionDecision): string {
  return DISPLAY_LABEL_MAP[decision];
}
