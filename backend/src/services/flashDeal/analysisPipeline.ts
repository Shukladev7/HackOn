/**
 * Analysis Pipeline Service for Flash Deal Eligibility Engine.
 *
 * Executes six sequential evaluation stages with configurable timing,
 * emits real-time progress events via EventEmitter for SSE subscribers,
 * and stores results for polling after client disconnect.
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6
 */

import { EventEmitter } from 'events';
import {
  FeatureVector,
  PipelineStage,
  PipelineProgressEvent,
} from './types';
import { config } from '../../config';
import { validate } from './featureGenerator';
import { normalizeCategoryScore } from './scoreCalculator';

// ─── Constants ───────────────────────────────────────────────────────────────

const STAGE_DEFINITIONS = [
  { name: 'Analyzing Product', category: 'condition' as const },
  { name: 'Evaluating Demand Signals', category: 'demand' as const },
  { name: 'Evaluating Product Condition', category: 'condition' as const },
  { name: 'Evaluating Recovery Value', category: 'financial' as const },
  { name: 'Evaluating Buyer Density', category: 'location' as const },
  { name: 'Evaluating Conversion Probability', category: 'demand' as const },
];

/** Result TTL for polling after client disconnect (5 minutes). */
const RESULT_TTL_MS = 5 * 60 * 1000;

// ─── In-Memory Stores ────────────────────────────────────────────────────────

/** Global map of evaluationId → EventEmitter for SSE subscribers. */
const evaluationEmitters = new Map<string, EventEmitter>();

/** Global map of evaluationId → stored pipeline results (for polling after disconnect). */
const storedResults = new Map<string, PipelineStage[]>();

/** Cleanup timers for stored results. */
const cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Returns a random integer between min and max (inclusive).
 */
function randomDuration(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1));
}

/**
 * Promise-based delay.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generates key factors identified during a stage based on features and category.
 */
function identifyFactors(features: FeatureVector, category: string): string[] {
  const factors: string[] = [];

  switch (category) {
    case 'condition':
      factors.push(`Inspection Grade: ${features.condition.inspectionGrade}`);
      if (features.condition.batteryHealth > 80) factors.push('High Battery Health');
      if (features.condition.damageScore < 20) factors.push('Low Damage Score');
      if (features.condition.packagingCondition === 'Original') factors.push('Original Packaging');
      break;
    case 'demand':
      if (features.demand.wishlistCount > 100) factors.push('High Wishlist Activity');
      if (features.demand.cartCount > 50) factors.push('High Cart Activity');
      if (features.demand.nearbyInterestedBuyers > 10) factors.push('Strong Local Interest');
      if (features.demand.historicalConversionRate > 0.5) factors.push('High Conversion Rate');
      break;
    case 'financial':
      if (features.financial.expectedRecoveryValue > 50000) factors.push('High Recovery Value');
      if (features.financial.warehouseCostAvoided > 200) factors.push('Significant Cost Savings');
      if (features.financial.deliveryCostSaved > 150) factors.push('High Delivery Savings');
      break;
    case 'location':
      if (features.location.demandDensity > 70) factors.push('High Demand Density');
      if (features.location.distanceToBuyers < 10) factors.push('Close to Buyers');
      factors.push(`City: ${features.location.city}`);
      break;
  }

  return factors.length > 0 ? factors : [`${category} evaluation completed`];
}

// ─── Core Pipeline Execution ─────────────────────────────────────────────────

/**
 * Executes the 6-stage analysis pipeline for a given evaluation.
 *
 * - Validates the feature vector first; rejects with error listing missing/invalid fields.
 * - Runs 6 sequential stages with configurable timing (500–2000ms each).
 * - Emits progress events at ≤200ms intervals via EventEmitter.
 * - Stores final results with 5-minute TTL for polling.
 *
 * @param evaluationId - Unique evaluation identifier
 * @param features - The complete feature vector to evaluate
 * @returns Array of completed PipelineStage results
 * @throws Error if the feature vector is invalid
 */
export async function execute(
  evaluationId: string,
  features: FeatureVector
): Promise<PipelineStage[]> {
  // ─── Validate feature vector ──────────────────────────────────────────────
  const validation = validate(features);
  if (!validation.valid) {
    throw new Error(
      `Invalid feature vector: ${validation.errors.join('; ')}`
    );
  }

  // ─── Create EventEmitter for this evaluation ──────────────────────────────
  const emitter = new EventEmitter();
  emitter.setMaxListeners(50); // Allow multiple SSE subscribers
  evaluationEmitters.set(evaluationId, emitter);

  const stages: PipelineStage[] = [];
  const { minStageDurationMs, maxStageDurationMs, progressIntervalMs } = config.flashDeal;

  try {
    // ─── Execute stages sequentially ──────────────────────────────────────────
    for (let i = 0; i < STAGE_DEFINITIONS.length; i++) {
      const stageDef = STAGE_DEFINITIONS[i]!;
      const stageIndex = i + 1;
      const duration = randomDuration(minStageDurationMs, maxStageDurationMs);

      // Initialize stage
      const stage: PipelineStage = {
        name: stageDef.name,
        index: stageIndex,
        status: 'pending',
        durationMs: duration,
      };

      // Emit pending status
      emitProgress(emitter, {
        evaluationId,
        stage: stageDef.name,
        stageIndex,
        progress: 0,
        status: 'pending',
      });

      // Transition to in_progress
      stage.status = 'in_progress';
      emitProgress(emitter, {
        evaluationId,
        stage: stageDef.name,
        stageIndex,
        progress: 0,
        status: 'in_progress',
      });

      // Run the stage with progress emission
      await runStage(emitter, evaluationId, stageDef.name, stageIndex, duration, progressIntervalMs);

      // Compute category score for this stage
      const categoryScore = normalizeCategoryScore(features, stageDef.category);
      const factors = identifyFactors(features, stageDef.category);

      // Mark completed
      stage.status = 'completed';
      stage.result = {
        categoryScore: Math.round(categoryScore * 100) / 100,
        factors,
      };

      // Emit completion
      emitProgress(emitter, {
        evaluationId,
        stage: stageDef.name,
        stageIndex,
        progress: 100,
        status: 'completed',
      });

      stages.push(stage);
    }

    // ─── Store result for polling ─────────────────────────────────────────────
    storeResult(evaluationId, stages);

    // ─── Emit pipeline completion event ───────────────────────────────────────
    emitter.emit('pipeline_complete', { evaluationId, stages });

    return stages;
  } catch (error) {
    // Emit failure and re-throw
    emitter.emit('pipeline_error', { evaluationId, error });
    throw error;
  } finally {
    // Clean up emitter after a brief delay (allow final events to be consumed)
    setTimeout(() => {
      evaluationEmitters.delete(evaluationId);
      emitter.removeAllListeners();
    }, 5000);
  }
}

/**
 * Runs a single pipeline stage, emitting progress events at regular intervals.
 * Progress monotonically increases from 0 to 100 over the stage duration.
 */
async function runStage(
  emitter: EventEmitter,
  evaluationId: string,
  stageName: string,
  stageIndex: number,
  durationMs: number,
  intervalMs: number
): Promise<void> {
  const startTime = Date.now();
  let lastProgress = 0;

  return new Promise<void>((resolve) => {
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const rawProgress = Math.min((elapsed / durationMs) * 100, 99);
      // Ensure monotonically increasing
      const progress = Math.max(Math.round(rawProgress), lastProgress);
      lastProgress = progress;

      emitProgress(emitter, {
        evaluationId,
        stage: stageName,
        stageIndex,
        progress,
        status: 'in_progress',
      });

      if (elapsed >= durationMs) {
        clearInterval(interval);
        resolve();
      }
    }, intervalMs);

    // Safety timeout to ensure the stage completes even if interval drift occurs
    setTimeout(() => {
      clearInterval(interval);
      resolve();
    }, durationMs + intervalMs);
  });
}

/**
 * Emits a progress event on the given EventEmitter.
 */
function emitProgress(emitter: EventEmitter, event: PipelineProgressEvent): void {
  emitter.emit('progress', event);
}

// ─── Result Storage ──────────────────────────────────────────────────────────

/**
 * Stores pipeline results in memory with a 5-minute TTL for polling after disconnect.
 */
function storeResult(evaluationId: string, stages: PipelineStage[]): void {
  storedResults.set(evaluationId, stages);

  // Clear any existing timer
  const existingTimer = cleanupTimers.get(evaluationId);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  // Set cleanup timer
  const timer = setTimeout(() => {
    storedResults.delete(evaluationId);
    cleanupTimers.delete(evaluationId);
  }, RESULT_TTL_MS);

  cleanupTimers.set(evaluationId, timer);
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Returns the EventEmitter for a given evaluation (for SSE endpoint to subscribe).
 * Returns undefined if no active evaluation exists for the given ID.
 */
export function getEventEmitter(evaluationId: string): EventEmitter | undefined {
  return evaluationEmitters.get(evaluationId);
}

/**
 * Returns stored pipeline result if available (for polling after disconnect).
 * Returns undefined if no result is stored or it has expired.
 */
export function getStoredResult(evaluationId: string): PipelineStage[] | undefined {
  return storedResults.get(evaluationId);
}

/**
 * Returns the default pipeline configuration.
 */
export function getDefaultConfig() {
  return {
    stages: STAGE_DEFINITIONS.map((s) => ({
      name: s.name,
      minDurationMs: config.flashDeal.minStageDurationMs,
      maxDurationMs: config.flashDeal.maxStageDurationMs,
    })),
    totalMinDurationMs: config.flashDeal.totalMinDurationMs,
    totalMaxDurationMs: config.flashDeal.totalMaxDurationMs,
    progressIntervalMs: config.flashDeal.progressIntervalMs,
  };
}
