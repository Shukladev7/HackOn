/**
 * Pipeline Orchestrator
 *
 * Wires the full RTO Reallocation Engine pipeline end-to-end:
 *   Event Ingress → Evidence Collection → Root Cause Classifier (HTTP) →
 *   Sale Recovery Predictor (HTTP) → Demand Matching → Buyer Ranking →
 *   Decision Engine → Reallocation/Redelivery/Warehouse Return
 *
 * Sets up Redis Stream consumers for each pipeline stage.
 * Integrates:
 *  - Courier escalation checks post-classification
 *  - Fraud detection checks pre-decision
 *  - Event stream emission at each state transition
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 10.2
 */

import { config } from '../config';
import {
  RedisStreamProducer,
  RedisStreamConsumer,
  StreamEntry,
  createRedisClient,
  initializePipelineGroups,
} from '../utils/redisStreams';
import { EvidenceCollectionEngine, NormalizedEvidence, RTOEventPayload } from './evidenceCollection';
import {
  selectAction,
  generateDecisionRecord,
  persistDecisionRecord,
  DecisionContext,
  DecisionRecord,
} from './decisionEngine';
import { findCandidates, filterRefusals, DemandCandidate } from './demandMatching';
import { rankCandidates, ScoredCandidate } from './buyerRanking';
import { checkForEscalation, checkPerformanceThreshold } from './courierEscalation';
import { runFraudDetection } from './fraudDetection';
import { EventStreamService, EventPayload, getEventStreamService } from './eventStream';
import { execute as executeReallocation } from './reallocationService';
import { Redis as RedisClient } from 'ioredis';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Classification result from the ML service */
export interface MLClassificationResult {
  customer_score: number;
  courier_score: number;
  system_score: number;
  primary_category: string | null;
  sub_cause: string | null;
  sub_cause_confidence: number;
  confidence_threshold: number;
  requires_manual_review: boolean;
  classification_timestamp: string;
}

/** Recovery prediction result from the ML service */
export interface MLRecoveryPrediction {
  recovery_probability: number;
  features_used: Record<string, unknown>;
  partially_imputed: boolean;
  model_version: string;
  predicted_at: string;
}

/** Pipeline stage result tracking */
export interface PipelineResult {
  rtoEventId: string;
  stages: {
    evidenceCollection: 'success' | 'failure' | 'skipped';
    classification: 'success' | 'failure' | 'skipped';
    prediction: 'success' | 'failure' | 'skipped';
    demandMatching: 'success' | 'failure' | 'skipped';
    buyerRanking: 'success' | 'failure' | 'skipped';
    decision: 'success' | 'failure' | 'skipped';
    execution: 'success' | 'failure' | 'skipped';
  };
  decision?: DecisionRecord;
  error?: string;
}

/** Options for the pipeline */
export interface PipelineOptions {
  /** ML service base URL (default: from config) */
  mlServiceUrl?: string;
  /** Custom HTTP fetch function (for testing) */
  fetchFn?: typeof fetch;
  /** Custom EventStreamService (for testing) */
  eventStreamService?: EventStreamService;
  /** Custom EvidenceCollectionEngine (for testing) */
  evidenceEngine?: EvidenceCollectionEngine;
  /** Custom Redis client (for testing) */
  redisClient?: RedisClient;
}

// ---------------------------------------------------------------------------
// HTTP helpers for ML service calls
// ---------------------------------------------------------------------------

/**
 * Calls the Root Cause Classifier ML service via HTTP.
 * POST /ml/v1/classify
 */
export async function callClassifier(
  evidence: NormalizedEvidence,
  options?: { mlServiceUrl?: string; fetchFn?: typeof fetch }
): Promise<MLClassificationResult> {
  const baseUrl = options?.mlServiceUrl ?? config.mlServiceUrl;
  const fetchImpl = options?.fetchFn ?? fetch;

  const response = await fetchImpl(`${baseUrl}/ml/v1/classify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ evidence }),
  });

  if (!response.ok) {
    throw new Error(`Classification service returned ${response.status}: ${response.statusText}`);
  }

  return response.json() as Promise<MLClassificationResult>;
}

/**
 * Calls the Sale Recovery Predictor ML service via HTTP.
 * POST /ml/v1/predict-recovery
 */
export async function callRecoveryPredictor(
  classification: MLClassificationResult,
  customerData: Record<string, unknown>,
  orderData: Record<string, unknown>,
  options?: { mlServiceUrl?: string; fetchFn?: typeof fetch }
): Promise<MLRecoveryPrediction> {
  const baseUrl = options?.mlServiceUrl ?? config.mlServiceUrl;
  const fetchImpl = options?.fetchFn ?? fetch;

  const response = await fetchImpl(`${baseUrl}/ml/v1/predict-recovery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ classification, customer_data: customerData, order_data: orderData }),
  });

  if (!response.ok) {
    throw new Error(`Recovery predictor returned ${response.status}: ${response.statusText}`);
  }

  return response.json() as Promise<MLRecoveryPrediction>;
}

// ---------------------------------------------------------------------------
// Event emission helper
// ---------------------------------------------------------------------------

/**
 * Emits a pipeline stage event to the event stream.
 */
async function emitStageEvent(
  eventStream: EventStreamService,
  eventType: string,
  sourceEntityId: string,
  targetEntityId: string,
  actorModule: string,
  outcomeStatus: 'success' | 'failure' | 'partial',
  inputParams: Record<string, unknown>
): Promise<void> {
  const payload: EventPayload = {
    eventType,
    sourceEntityId,
    targetEntityId,
    timestamp: new Date().toISOString(),
    actorModule,
    outcomeStatus,
    inputParams,
  };

  await eventStream.emit(payload);
}

// ---------------------------------------------------------------------------
// Pipeline Processor — processes a single RTO event through all stages
// ---------------------------------------------------------------------------

/**
 * Processes a single RTO event through the entire pipeline.
 * This is the core orchestration function invoked by each Redis stream consumer.
 */
export async function processRTOEvent(
  event: RTOEventPayload,
  rtoEventId: string,
  options?: PipelineOptions
): Promise<PipelineResult> {
  const mlServiceUrl = options?.mlServiceUrl ?? config.mlServiceUrl;
  const fetchFn = options?.fetchFn ?? fetch;
  const eventStream = options?.eventStreamService ?? getEventStreamService();
  const evidenceEngine = options?.evidenceEngine ?? new EvidenceCollectionEngine();

  const result: PipelineResult = {
    rtoEventId,
    stages: {
      evidenceCollection: 'skipped',
      classification: 'skipped',
      prediction: 'skipped',
      demandMatching: 'skipped',
      buyerRanking: 'skipped',
      decision: 'skipped',
      execution: 'skipped',
    },
  };

  // --- Stage 1: Evidence Collection ---
  let normalizedEvidence: NormalizedEvidence;
  try {
    const eligibility = await evidenceEngine.verifyEligibility(event);

    await emitStageEvent(
      eventStream,
      'eligibility_check',
      rtoEventId,
      event.shipmentId,
      'evidence_collection',
      eligibility.eligible ? 'success' : 'failure',
      { eligible: eligibility.eligible, conditions: eligibility.conditions }
    );

    // If ineligible, route to warehouse return immediately
    if (!eligibility.eligible) {
      result.stages.evidenceCollection = 'success';
      result.stages.decision = 'success';

      const decisionContext: DecisionContext = {
        rtoEventId,
        classification: { category: 'ineligible', subCause: 'package_condition', scores: { customer: 0, courier: 0, system: 0 } },
        recoveryProbability: 0,
        candidateBuyerCount: 0,
        topBuyerScore: null,
        selectedBuyerId: null,
      };

      const decisionRecord: DecisionRecord = {
        rtoEventId,
        rootCause: { category: 'ineligible', subCause: 'package_condition', scores: { customer: 0, courier: 0, system: 0 } },
        action: 'warehouse_return',
        reasoning: `Package ineligible for reallocation. Failed conditions: ${Object.entries(eligibility.conditions).filter(([_, v]) => !v.pass).map(([k]) => k).join(', ')}`,
        inputs: { recoveryProbability: 0, candidateBuyerCount: 0, topBuyerScore: null },
        selectedBuyerId: null,
        timestamp: new Date().toISOString(),
      };

      await persistDecisionRecord(decisionRecord);
      result.decision = decisionRecord;

      await emitStageEvent(eventStream, 'decision', rtoEventId, '', 'decision_engine', 'success', { action: 'warehouse_return', reason: 'ineligible' });

      return result;
    }

    // Collect evidence from all sources
    const sources = await evidenceEngine.collectEvidence(event);
    normalizedEvidence = evidenceEngine.normalizeEvidence(sources, rtoEventId, eligibility);

    await emitStageEvent(
      eventStream,
      'evidence_collected',
      rtoEventId,
      event.shipmentId,
      'evidence_collection',
      'success',
      { sourcesCollected: normalizedEvidence.completeness.collected.length, sourcesUnavailable: normalizedEvidence.completeness.unavailable.length }
    );

    result.stages.evidenceCollection = 'success';
  } catch (error: any) {
    result.stages.evidenceCollection = 'failure';
    result.error = `Evidence collection failed: ${error.message}`;
    await emitStageEvent(eventStream, 'evidence_collected', rtoEventId, event.shipmentId, 'evidence_collection', 'failure', { error: error.message });
    return result;
  }

  // --- Stage 2: Root Cause Classification (HTTP call to ML service) ---
  let classification: MLClassificationResult;
  try {
    classification = await callClassifier(normalizedEvidence, { mlServiceUrl, fetchFn });

    await emitStageEvent(
      eventStream,
      'classification',
      rtoEventId,
      event.courierId,
      'root_cause_classifier',
      'success',
      {
        primary_category: classification.primary_category,
        sub_cause: classification.sub_cause,
        scores: { customer: classification.customer_score, courier: classification.courier_score, system: classification.system_score },
      }
    );

    result.stages.classification = 'success';
  } catch (error: any) {
    result.stages.classification = 'failure';
    result.error = `Classification failed: ${error.message}`;
    await emitStageEvent(eventStream, 'classification', rtoEventId, event.courierId, 'root_cause_classifier', 'failure', { error: error.message });
    return result;
  }

  // --- Post-classification: Courier Escalation Check ---
  if (classification.primary_category === 'courier_issue') {
    try {
      const escalationAlert = checkForEscalation(
        event.courierId,
        rtoEventId,
        classification,
        normalizedEvidence
      );

      if (escalationAlert) {
        await emitStageEvent(eventStream, 'courier_escalation', rtoEventId, event.courierId, 'courier_escalation', 'success', { alertId: escalationAlert.alertId, subCause: escalationAlert.subCause });
      }

      // Also check performance threshold
      await checkPerformanceThreshold(event.courierId);
    } catch {
      // Escalation check is non-blocking — log but continue pipeline
    }
  }

  // --- Stage 3: Sale Recovery Prediction (HTTP call to ML service) ---
  let recoveryProbability: number;
  try {
    const customerData = { customerId: event.customerId };
    const orderData = {
      orderId: event.orderId,
      sku: event.packageDetails.sku,
      price: event.packageDetails.price,
      category: event.packageDetails.category,
    };

    const prediction = await callRecoveryPredictor(classification, customerData, orderData, { mlServiceUrl, fetchFn });
    recoveryProbability = prediction.recovery_probability;

    await emitStageEvent(
      eventStream,
      'prediction',
      rtoEventId,
      event.customerId,
      'sale_recovery_predictor',
      'success',
      { recovery_probability: recoveryProbability, partially_imputed: prediction.partially_imputed }
    );

    result.stages.prediction = 'success';
  } catch (error: any) {
    result.stages.prediction = 'failure';
    result.error = `Recovery prediction failed: ${error.message}`;
    await emitStageEvent(eventStream, 'prediction', rtoEventId, event.customerId, 'sale_recovery_predictor', 'failure', { error: error.message });
    return result;
  }

  // --- Pre-decision: Fraud Detection Check ---
  let fraudSuspendReallocation = false;
  try {
    const customerFraud = await runFraudDetection(event.customerId, 'customer');
    const courierFraud = await runFraudDetection(event.courierId, 'courier');

    fraudSuspendReallocation = customerFraud.suspendReallocation || courierFraud.suspendReallocation;

    if (fraudSuspendReallocation) {
      await emitStageEvent(eventStream, 'fraud_detection', rtoEventId, event.customerId, 'fraud_detection', 'success', { suspendReallocation: true });
    }
  } catch {
    // Fraud detection is non-blocking — default to not suspended
  }

  // --- Determine preliminary action ---
  const primaryCategory = classification.primary_category || 'unknown';
  let candidateBuyers: DemandCandidate[] = [];
  let rankedBuyers: ScoredCandidate[] = [];

  // Determine if we need demand matching based on preliminary decision logic
  const needsDemandMatching = shouldRunDemandMatching(primaryCategory, recoveryProbability, fraudSuspendReallocation);

  // --- Stage 4: Demand Matching (only if needed) ---
  if (needsDemandMatching) {
    try {
      const rawCandidates = await findCandidates(
        event.packageDetails.sku,
        event.hubLocation,
        event.packageDetails.category
      );

      candidateBuyers = filterRefusals(rawCandidates, event.packageDetails.category);

      await emitStageEvent(
        eventStream,
        'demand_match',
        rtoEventId,
        event.packageDetails.sku,
        'demand_matching',
        candidateBuyers.length > 0 ? 'success' : 'partial',
        { candidateCount: candidateBuyers.length, rawCount: rawCandidates.length }
      );

      result.stages.demandMatching = 'success';
    } catch (error: any) {
      result.stages.demandMatching = 'failure';
      await emitStageEvent(eventStream, 'demand_match', rtoEventId, event.packageDetails.sku, 'demand_matching', 'failure', { error: error.message });
      // Continue with empty candidates — decision engine will route to warehouse
    }

    // --- Stage 5: Buyer Ranking (only if candidates found) ---
    if (candidateBuyers.length > 0) {
      try {
        rankedBuyers = rankCandidates(
          candidateBuyers,
          { price: event.packageDetails.price, category: event.packageDetails.category }
        );

        await emitStageEvent(
          eventStream,
          'ranking',
          rtoEventId,
          '',
          'buyer_ranking',
          rankedBuyers.length > 0 ? 'success' : 'partial',
          { rankedCount: rankedBuyers.length, topScore: rankedBuyers[0]?.compositeScore ?? null }
        );

        result.stages.buyerRanking = 'success';
      } catch (error: any) {
        result.stages.buyerRanking = 'failure';
        await emitStageEvent(eventStream, 'ranking', rtoEventId, '', 'buyer_ranking', 'failure', { error: error.message });
      }
    } else {
      result.stages.buyerRanking = 'skipped';
    }
  } else {
    result.stages.demandMatching = 'skipped';
    result.stages.buyerRanking = 'skipped';
  }

  // --- Stage 6: Decision Engine ---
  let decisionRecord: DecisionRecord;
  try {
    const decisionContext: DecisionContext = {
      rtoEventId,
      classification: {
        category: primaryCategory,
        subCause: classification.sub_cause || 'unspecified',
        scores: {
          customer: classification.customer_score,
          courier: classification.courier_score,
          system: classification.system_score,
        },
      },
      recoveryProbability,
      candidateBuyerCount: rankedBuyers.length,
      topBuyerScore: rankedBuyers.length > 0 ? rankedBuyers[0].compositeScore : null,
      selectedBuyerId: rankedBuyers.length > 0 ? rankedBuyers[0].buyerId : null,
    };

    // If fraud suspended, override to warehouse return
    if (fraudSuspendReallocation) {
      decisionRecord = {
        rtoEventId,
        rootCause: decisionContext.classification,
        action: 'warehouse_return',
        reasoning: 'Reallocation suspended due to fraud detection flag on customer or courier.',
        inputs: {
          recoveryProbability: decisionContext.recoveryProbability,
          candidateBuyerCount: decisionContext.candidateBuyerCount,
          topBuyerScore: decisionContext.topBuyerScore,
        },
        selectedBuyerId: null,
        timestamp: new Date().toISOString(),
      };
    } else {
      decisionRecord = generateDecisionRecord(decisionContext);
    }

    await persistDecisionRecord(decisionRecord);

    await emitStageEvent(
      eventStream,
      'decision',
      rtoEventId,
      decisionRecord.selectedBuyerId || '',
      'decision_engine',
      'success',
      { action: decisionRecord.action, reasoning: decisionRecord.reasoning }
    );

    result.stages.decision = 'success';
    result.decision = decisionRecord;
  } catch (error: any) {
    result.stages.decision = 'failure';
    result.error = `Decision engine failed: ${error.message}`;
    await emitStageEvent(eventStream, 'decision', rtoEventId, '', 'decision_engine', 'failure', { error: error.message });
    return result;
  }

  // --- Stage 7: Execution ---
  try {
    switch (decisionRecord.action) {
      case 'reallocate': {
        if (decisionRecord.selectedBuyerId) {
          await executeReallocation(rtoEventId, decisionRecord.selectedBuyerId, event.packageDetails);
          await emitStageEvent(eventStream, 'reallocation', rtoEventId, decisionRecord.selectedBuyerId, 'reallocation_service', 'success', { buyerId: decisionRecord.selectedBuyerId });
        }
        break;
      }
      case 'redeliver': {
        // Redelivery execution — emit event for downstream logistics partner
        const excludeCourier = primaryCategory === 'courier_issue' ? event.courierId : undefined;
        await emitStageEvent(eventStream, 'redelivery', rtoEventId, event.customerId, 'redelivery_service', 'success', { excludeCourierId: excludeCourier });
        break;
      }
      case 'warehouse_return': {
        await emitStageEvent(eventStream, 'warehouse_return', rtoEventId, event.hubLocation.hubId, 'warehouse_service', 'success', { reason: decisionRecord.reasoning });
        break;
      }
    }
    result.stages.execution = 'success';
  } catch (error: any) {
    result.stages.execution = 'failure';
    result.error = `Execution failed: ${error.message}`;
    await emitStageEvent(eventStream, 'execution_error', rtoEventId, '', 'pipeline', 'failure', { action: decisionRecord.action, error: error.message });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Decision routing helper
// ---------------------------------------------------------------------------

/**
 * Determines whether demand matching is needed based on the preliminary
 * classification and recovery probability.
 */
export function shouldRunDemandMatching(
  primaryCategory: string,
  recoveryProbability: number,
  fraudSuspended: boolean
): boolean {
  // If fraud is suspended, no point running demand matching
  if (fraudSuspended) return false;

  const category = primaryCategory.toLowerCase();

  // Courier issue with low recovery → needs demand matching
  if (category === 'courier_issue' && recoveryProbability <= config.courierRedeliveryRecoveryThreshold) {
    return true;
  }

  // Customer issue with low recovery → needs demand matching
  if (category === 'customer_issue' && recoveryProbability <= config.recoveryProbabilityThreshold) {
    return true;
  }

  // System issue → redeliver (no demand matching needed)
  // High recovery → redeliver (no demand matching needed)
  return false;
}

// ---------------------------------------------------------------------------
// Redis Stream Consumer Setup
// ---------------------------------------------------------------------------

/**
 * Sets up Redis Stream consumers for the full pipeline.
 * Each consumer listens on the 'rto-events' stream and processes events
 * through the entire pipeline.
 *
 * In a production multi-stage system, each stage would have its own consumer
 * reading from the previous stage's output stream. For the MVP, we use a
 * single consumer that processes the full pipeline per event.
 */
export class PipelineConsumer {
  private consumer: RedisStreamConsumer | null = null;
  private producer: RedisStreamProducer | null = null;
  private redisClient: RedisClient | null = null;
  private options: PipelineOptions;
  private running = false;

  constructor(options?: PipelineOptions) {
    this.options = options ?? {};
  }

  /**
   * Starts the pipeline consumer, listening on the 'rto-events' stream.
   */
  async start(): Promise<void> {
    this.redisClient = this.options.redisClient ?? createRedisClient('pipeline');

    // Initialize consumer groups for all pipeline stages
    await initializePipelineGroups(this.redisClient);

    this.producer = new RedisStreamProducer(this.redisClient);
    this.consumer = new RedisStreamConsumer('rto-events', {
      group: 'pipeline-processor-group',
      consumer: `pipeline-${process.pid}`,
      blockMs: 5000,
      batchSize: 10,
    }, this.options.redisClient ?? createRedisClient('pipeline-consumer'));

    this.running = true;

    // Start consuming (non-blocking — runs in background)
    this.consumer.subscribe(async (entry: StreamEntry) => {
      await this.handleStreamEntry(entry);
    });
  }

  /**
   * Handles a single stream entry from the rto-events stream.
   */
  private async handleStreamEntry(entry: StreamEntry): Promise<void> {
    try {
      const eventId = entry.fields.eventId;
      const payloadStr = entry.fields.payload;

      if (!payloadStr || !eventId) {
        return;
      }

      const payload: RTOEventPayload = JSON.parse(payloadStr);
      await processRTOEvent(payload, eventId, this.options);
    } catch (error: any) {
      console.error('[Pipeline] Error processing stream entry:', error.message);
    }
  }

  /**
   * Stops the pipeline consumer gracefully.
   */
  async stop(): Promise<void> {
    this.running = false;
    if (this.consumer) {
      this.consumer.stop();
      await this.consumer.disconnect();
      this.consumer = null;
    }
    if (this.producer) {
      await this.producer.disconnect();
      this.producer = null;
    }
  }

  /**
   * Returns whether the consumer is currently running.
   */
  isRunning(): boolean {
    return this.running;
  }
}

// ---------------------------------------------------------------------------
// Factory / Singleton
// ---------------------------------------------------------------------------

let pipelineInstance: PipelineConsumer | null = null;

/**
 * Returns the singleton PipelineConsumer instance.
 */
export function getPipelineConsumer(options?: PipelineOptions): PipelineConsumer {
  if (!pipelineInstance) {
    pipelineInstance = new PipelineConsumer(options);
  }
  return pipelineInstance;
}

/**
 * Resets the singleton (for testing).
 */
export function resetPipelineConsumer(): void {
  pipelineInstance = null;
}
