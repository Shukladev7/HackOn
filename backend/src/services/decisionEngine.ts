/**
 * Decision Engine
 *
 * Orchestrates the full RTO pipeline and selects the final action.
 * Implements Requirements 7.1–7.7:
 *  - 7.1: Courier issue + recovery > 0.5 → redeliver (exclude flagged courier)
 *  - 7.2: Courier issue + recovery ≤ 0.5 → demand matching → reallocate
 *  - 7.3: System issue → technical correction + redeliver
 *  - 7.4: Customer issue + recovery > threshold → redeliver
 *  - 7.5: Customer issue + recovery ≤ threshold + buyers → reallocate to top buyer
 *  - 7.6: No viable action → warehouse return
 *  - 7.7: Decision record generation with complete audit trail
 */

import { config } from '../config';
import { DecisionRecord as DecisionRecordModel } from '../models/DecisionRecord';

// --- Types ---

export type DecisionAction = 'redeliver' | 'reallocate' | 'warehouse_return';

export interface ClassificationResult {
  category: string;
  subCause: string;
  scores: { customer: number; courier: number; system: number };
}

export interface DecisionInputs {
  recoveryProbability: number;
  candidateBuyerCount: number;
  topBuyerScore: number | null;
}

export interface DecisionRecord {
  rtoEventId: string;
  rootCause: {
    category: string;
    subCause: string;
    scores: { customer: number; courier: number; system: number };
  };
  action: DecisionAction;
  reasoning: string;
  inputs: {
    recoveryProbability: number;
    candidateBuyerCount: number;
    topBuyerScore: number | null;
  };
  selectedBuyerId: string | null;
  timestamp: string;
}

export interface DecisionContext {
  rtoEventId: string;
  classification: ClassificationResult;
  recoveryProbability: number;
  candidateBuyerCount: number;
  topBuyerScore: number | null;
  selectedBuyerId: string | null;
}

// --- Action Selection Logic (Task 10.1) ---

/**
 * Select the appropriate action based on classification, recovery probability,
 * and available buyers per the decision matrix (Requirements 7.1–7.6).
 */
export function selectAction(context: DecisionContext): DecisionAction {
  const { classification, recoveryProbability, candidateBuyerCount, topBuyerScore } = context;
  const category = classification.category.toLowerCase();

  // Requirement 7.1 & 7.2: Courier issue handling
  if (category === 'courier_issue') {
    if (recoveryProbability > config.courierRedeliveryRecoveryThreshold) {
      return 'redeliver';
    }
    // Recovery ≤ 0.5 → try reallocation if buyers available
    if (candidateBuyerCount > 0 && topBuyerScore !== null) {
      return 'reallocate';
    }
    return 'warehouse_return';
  }

  // Requirement 7.3: System issue → redeliver (after technical correction)
  if (category === 'system_issue') {
    return 'redeliver';
  }

  // Requirements 7.4 & 7.5: Customer issue handling
  if (category === 'customer_issue') {
    if (recoveryProbability > config.recoveryProbabilityThreshold) {
      return 'redeliver';
    }
    // Recovery ≤ threshold + buyers available → reallocate
    if (candidateBuyerCount > 0 && topBuyerScore !== null) {
      return 'reallocate';
    }
    return 'warehouse_return';
  }

  // Requirement 7.6: No viable action → warehouse return
  return 'warehouse_return';
}

// --- Reasoning Generation ---

/**
 * Generate a human-readable reasoning summary explaining why an action was selected.
 * Includes the root cause, recovery probability, and buyer availability context.
 */
export function generateReasoning(context: DecisionContext, action: DecisionAction): string {
  const { classification, recoveryProbability, candidateBuyerCount, topBuyerScore } = context;
  const category = classification.category;
  const subCause = classification.subCause;
  const scores = classification.scores;

  const categoryLabel = category.replace(/_/g, ' ');
  const recoveryPct = (recoveryProbability * 100).toFixed(1);

  let reasoning = `Root cause: ${categoryLabel} (sub-cause: ${subCause}). `;
  reasoning += `Confidence scores - customer: ${scores.customer.toFixed(2)}, courier: ${scores.courier.toFixed(2)}, system: ${scores.system.toFixed(2)}. `;
  reasoning += `Recovery probability: ${recoveryPct}%. `;

  switch (action) {
    case 'redeliver': {
      if (category.toLowerCase() === 'courier_issue') {
        reasoning += `Action: redeliver with different courier. Recovery probability ${recoveryPct}% exceeds threshold of ${(config.courierRedeliveryRecoveryThreshold * 100).toFixed(1)}%.`;
      } else if (category.toLowerCase() === 'system_issue') {
        reasoning += `Action: redeliver after technical correction for ${subCause}. System issues are resolved before reattempting delivery.`;
      } else {
        reasoning += `Action: redeliver to original customer. Recovery probability ${recoveryPct}% exceeds threshold of ${(config.recoveryProbabilityThreshold * 100).toFixed(1)}%.`;
      }
      break;
    }
    case 'reallocate': {
      reasoning += `${candidateBuyerCount} candidate buyer(s) found. `;
      reasoning += `Top buyer score: ${topBuyerScore !== null ? topBuyerScore.toFixed(2) : 'N/A'}. `;
      reasoning += `Action: reallocate to top-ranked buyer. Recovery probability too low for redelivery.`;
      break;
    }
    case 'warehouse_return': {
      if (candidateBuyerCount === 0) {
        reasoning += `No candidate buyers available. Action: warehouse return.`;
      } else {
        reasoning += `No viable redelivery or reallocation path. Action: warehouse return.`;
      }
      break;
    }
  }

  return reasoning;
}

// --- Decision Record Generation (Task 10.2) ---

/**
 * Generate a complete DecisionRecord for an RTO event.
 * Contains all required fields per Requirement 7.7:
 * - rtoEventId
 * - Root cause category/sub-cause
 * - All three confidence scores
 * - Selected action
 * - Specific input values (recovery probability, candidate count, top buyer score)
 * - Human-readable reasoning
 */
export function generateDecisionRecord(context: DecisionContext): DecisionRecord {
  const action = selectAction(context);
  const reasoning = generateReasoning(context, action);

  return {
    rtoEventId: context.rtoEventId,
    rootCause: {
      category: context.classification.category,
      subCause: context.classification.subCause,
      scores: { ...context.classification.scores },
    },
    action,
    reasoning,
    inputs: {
      recoveryProbability: context.recoveryProbability,
      candidateBuyerCount: context.candidateBuyerCount,
      topBuyerScore: context.topBuyerScore,
    },
    selectedBuyerId: action === 'reallocate' ? context.selectedBuyerId : null,
    timestamp: new Date().toISOString(),
  };
}

// --- Persistence (Task 10.2) ---

/**
 * Persist a DecisionRecord to the decision_records MongoDB collection.
 * Returns the persisted document.
 */
export async function persistDecisionRecord(record: DecisionRecord): Promise<DecisionRecord> {
  const doc = new DecisionRecordModel({
    rtoEventId: record.rtoEventId,
    rootCause: record.rootCause,
    action: record.action,
    reasoning: record.reasoning,
    inputs: record.inputs,
    selectedBuyerId: record.selectedBuyerId || undefined,
    decidedAt: new Date(record.timestamp),
  });

  await doc.save();
  return record;
}

/**
 * Generate and persist a decision record in one operation.
 * This is the primary entry point for Task 10.2.
 */
export async function generateAndPersistDecisionRecord(context: DecisionContext): Promise<DecisionRecord> {
  const record = generateDecisionRecord(context);
  await persistDecisionRecord(record);
  return record;
}
