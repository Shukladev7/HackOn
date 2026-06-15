/**
 * Flash Deal Eligibility Engine REST API Router.
 *
 * Provides endpoints for triggering evaluations, retrieving results,
 * streaming pipeline progress via SSE, listing evaluation history,
 * and fetching aggregate impact metrics.
 *
 * Requirements: 6.1–6.9, 7.1, 7.2, 7.4, 7.5, 8.1–8.3, 8.5, 9.5, 9.7, 10.4
 */

import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { FlashDealEvaluation } from '../models/FlashDealEvaluation';
import { FlashDealSeedScenario } from '../models/FlashDealSeedScenario';
import { config } from '../config';

// Services
import * as analysisPipeline from '../services/flashDeal/analysisPipeline';
import { computeScore } from '../services/flashDeal/scoreCalculator';
import { decide, getColorMapping } from '../services/flashDeal/dispositionDecider';
import { generateReport } from '../services/flashDeal/explainabilityReporter';
import { generateBreakdown } from '../services/flashDeal/scoreBreakdownGenerator';
import { calculate as calculateBusinessImpact, calculateAggregate as calculateBusinessAggregate } from '../services/flashDeal/businessImpactCalculator';
import { calculate as calculateSustainability, calculateAggregate as calculateSustainabilityAggregate } from '../services/flashDeal/sustainabilityCalculator';
import { generateFromPassport, generateFromSeed, validate } from '../services/flashDeal/featureGenerator';
import * as passportIntegration from '../services/flashDeal/passportIntegration';
import { FeatureVector } from '../services/flashDeal/types';

const router = Router();

// ─── Helper: Run async evaluation orchestration ─────────────────────────────

async function runEvaluationOrchestration(
  evaluationId: string,
  features: FeatureVector,
  productId: string | null,
  scenarioId: string | null
): Promise<void> {
  try {
    // 1. Run analysis pipeline
    const pipelineStages = await analysisPipeline.execute(evaluationId, features);

    // 2. Compute score
    const scoreResult = computeScore(features);

    // 3. Decide disposition
    const dispositionResult = decide(
      scoreResult.flashDealScore,
      scoreResult.confidenceScore,
      features.condition.inspectionGrade
    );

    // 4. Generate explainability report
    const explainability = generateReport(
      features,
      dispositionResult.decision,
      scoreResult.flashDealScore
    );

    // 5. Generate score breakdown
    const scoreBreakdown = generateBreakdown(
      scoreResult.flashDealScore,
      scoreResult.categoryScores,
      features
    );

    // 6. Calculate business impact
    const businessImpact = calculateBusinessImpact(features);

    // 7. Calculate sustainability metrics
    const sustainability = calculateSustainability(
      features.location.distanceToBuyers,
      dispositionResult.decision
    );

    // 8. Passport integration events
    const passportId = await passportIntegration.ensurePassportExists(features, evaluationId);
    if (passportId) {
      await passportIntegration.appendEvaluationStarted(passportId, evaluationId);
      await passportIntegration.appendAnalysisComplete(
        passportId,
        scoreResult.flashDealScore,
        dispositionResult.decision
      );
      await passportIntegration.appendDispositionEvent(
        passportId,
        dispositionResult.decision,
        features.demand.nearbyInterestedBuyers,
        features.location.city,
        features.location.distanceToBuyers
      );
    }

    // 9. Update FlashDealEvaluation with full results
    await FlashDealEvaluation.findOneAndUpdate(
      { evaluationId },
      {
        status: 'completed',
        pipelineStages: pipelineStages.map((stage, idx) => ({
          name: stage.name,
          index: stage.index,
          status: stage.status,
          durationMs: stage.durationMs,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        })),
        result: {
          flashDealScore: scoreResult.flashDealScore,
          confidenceScore: scoreResult.confidenceScore,
          dispositionDecision: dispositionResult.decision,
          categoryScores: scoreResult.categoryScores,
          matchedRule: dispositionResult.matchedRule,
        },
        explainability,
        scoreBreakdown,
        businessImpact,
        sustainability,
        completedAt: new Date().toISOString(),
      }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await FlashDealEvaluation.findOneAndUpdate(
      { evaluationId },
      {
        status: 'failed',
        error: errorMessage,
        completedAt: new Date().toISOString(),
      }
    );
  }
}

// ─── POST /evaluate ──────────────────────────────────────────────────────────
// Task 12.1: Trigger evaluation with productId or feature vector

router.post('/evaluate', async (req: Request, res: Response): Promise<void> => {
  try {
    const { productId, features } = req.body;

    // Validate: must have either productId or features
    if (!productId && !features) {
      res.status(400).json({
        success: false,
        message: 'Request must include either productId or features',
      });
      return;
    }

    let featureVector: FeatureVector;

    if (productId) {
      // Generate features from ProductPassport
      try {
        featureVector = await generateFromPassport(productId);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        if (message.includes('not found')) {
          res.status(404).json({
            success: false,
            message: `Product passport not found: ${productId}`,
          });
          return;
        }
        throw error;
      }
    } else {
      // Validate provided features
      const validation = validate(features);
      if (!validation.valid) {
        res.status(400).json({
          success: false,
          message: 'Invalid feature vector',
          errors: validation.errors,
        });
        return;
      }
      featureVector = features;
    }

    // Create evaluation record
    const evaluationId = uuidv4();
    const evaluation = new FlashDealEvaluation({
      evaluationId,
      productId: productId || null,
      scenarioId: null,
      status: 'processing',
      inputFeatures: featureVector,
      pipelineStages: [],
      result: null,
      explainability: null,
      scoreBreakdown: null,
      businessImpact: null,
      sustainability: null,
      startedAt: new Date().toISOString(),
      completedAt: null,
      error: null,
    });

    await evaluation.save();

    // Kick off async orchestration (don't await)
    runEvaluationOrchestration(evaluationId, featureVector, productId || null, null);

    // Return 202 Accepted
    res.status(202).json({
      evaluationId,
      status: 'processing',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ success: false, message, error: message });
  }
});

// ─── POST /evaluate/seed/:scenarioId ─────────────────────────────────────────
// Task 12.1: Trigger evaluation from seed scenario

router.post('/evaluate/seed/:scenarioId', async (req: Request, res: Response): Promise<void> => {
  try {
    const scenarioId = req.params['scenarioId'];

    // Look up seed scenario
    const scenario = await FlashDealSeedScenario.findOne({ scenarioId });
    if (!scenario) {
      res.status(404).json({
        success: false,
        message: `Seed scenario not found: ${scenarioId}`,
      });
      return;
    }

    // Generate features from seed
    const featureVector = await generateFromSeed(scenarioId!);

    // Create evaluation record
    const evaluationId = uuidv4();
    const evaluation = new FlashDealEvaluation({
      evaluationId,
      productId: null,
      scenarioId,
      status: 'processing',
      inputFeatures: featureVector,
      pipelineStages: [],
      result: null,
      explainability: null,
      scoreBreakdown: null,
      businessImpact: null,
      sustainability: null,
      startedAt: new Date().toISOString(),
      completedAt: null,
      error: null,
    });

    await evaluation.save();

    // Kick off async orchestration (don't await)
    runEvaluationOrchestration(evaluationId, featureVector, null, scenarioId!);

    // Return 202 Accepted
    res.status(202).json({
      evaluationId,
      status: 'processing',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ success: false, message, error: message });
  }
});

// ─── GET /evaluations/:id ────────────────────────────────────────────────────
// Task 12.2: Get evaluation result by ID

router.get('/evaluations/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const evaluationId = req.params['id'];
    const evaluation = await FlashDealEvaluation.findOne({ evaluationId }).lean();

    if (!evaluation) {
      res.status(404).json({
        success: false,
        message: `Evaluation not found: ${evaluationId}`,
      });
      return;
    }

    // Build structured response with grouped input features and disposition color
    const response: Record<string, unknown> = {
      evaluationId: evaluation.evaluationId,
      productId: evaluation.productId,
      scenarioId: evaluation.scenarioId,
      status: evaluation.status,
      inputFeatures: {
        product: {
          ...evaluation.inputFeatures.product,
          label: 'Product Details',
        },
        condition: {
          ...evaluation.inputFeatures.condition,
          label: 'Product Condition',
        },
        demand: {
          ...evaluation.inputFeatures.demand,
          label: 'Demand Signals',
        },
        location: {
          ...evaluation.inputFeatures.location,
          label: 'Location Data',
        },
        financial: {
          ...evaluation.inputFeatures.financial,
          label: 'Financial Metrics',
        },
        metadata: evaluation.inputFeatures.metadata,
      },
      pipelineStages: evaluation.pipelineStages,
      result: evaluation.result
        ? {
            ...evaluation.result,
            dispositionColor: getColorMapping(evaluation.result.dispositionDecision),
          }
        : null,
      explainability: evaluation.explainability,
      scoreBreakdown: evaluation.scoreBreakdown,
      businessImpact: evaluation.businessImpact,
      sustainability: evaluation.sustainability,
      startedAt: evaluation.startedAt,
      completedAt: evaluation.completedAt,
      error: evaluation.error,
      createdAt: evaluation.createdAt,
      updatedAt: evaluation.updatedAt,
    };

    res.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ success: false, message, error: message });
  }
});

// ─── GET /evaluations/:id/stream ─────────────────────────────────────────────
// Task 12.2: SSE endpoint for pipeline progress streaming

router.get('/evaluations/:id/stream', (req: Request, res: Response): void => {
  const evaluationId = req.params['id'];

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Get EventEmitter for this evaluation
  const emitter = analysisPipeline.getEventEmitter(evaluationId!);

  if (!emitter) {
    // No active pipeline — send completion event and close
    res.write(`event: pipeline_error\ndata: ${JSON.stringify({ message: 'No active pipeline for this evaluation' })}\n\n`);
    res.end();
    return;
  }

  // Subscribe to progress events
  const onProgress = (event: unknown) => {
    res.write(`event: pipeline_progress\ndata: ${JSON.stringify(event)}\n\n`);
  };

  const onComplete = (event: unknown) => {
    res.write(`event: pipeline_complete\ndata: ${JSON.stringify(event)}\n\n`);
    cleanup();
  };

  const onError = (event: unknown) => {
    res.write(`event: pipeline_error\ndata: ${JSON.stringify(event)}\n\n`);
    cleanup();
  };

  emitter.on('progress', onProgress);
  emitter.on('pipeline_complete', onComplete);
  emitter.on('pipeline_error', onError);

  // Set SSE timeout
  const timeoutMs = config.flashDeal.sseTimeoutSeconds * 1000;
  const timeout = setTimeout(() => {
    res.write(`event: timeout\ndata: ${JSON.stringify({ message: 'SSE connection timed out' })}\n\n`);
    cleanup();
  }, timeoutMs);

  // Cleanup function
  function cleanup() {
    clearTimeout(timeout);
    emitter!.off('progress', onProgress);
    emitter!.off('pipeline_complete', onComplete);
    emitter!.off('pipeline_error', onError);
    res.end();
  }

  // Handle client disconnect
  req.on('close', () => {
    clearTimeout(timeout);
    emitter!.off('progress', onProgress);
    emitter!.off('pipeline_complete', onComplete);
    emitter!.off('pipeline_error', onError);
  });
});

// ─── GET /evaluations ────────────────────────────────────────────────────────
// Task 12.3: Paginated list of evaluations with optional filters

router.get('/evaluations', async (req: Request, res: Response): Promise<void> => {
  try {
    const page = Math.max(1, parseInt(req.query['page'] as string) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query['pageSize'] as string) || 20));
    const disposition = req.query['disposition'] as string | undefined;
    const category = req.query['category'] as string | undefined;

    // Build filter
    const filter: Record<string, unknown> = {};
    if (disposition) {
      filter['result.dispositionDecision'] = disposition;
    }
    if (category) {
      filter['inputFeatures.product.category'] = category;
    }

    const total = await FlashDealEvaluation.countDocuments(filter);
    const totalPages = Math.ceil(total / pageSize);
    const skip = (page - 1) * pageSize;

    const evaluations = await FlashDealEvaluation.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(pageSize)
      .lean();

    res.json({
      evaluations,
      total,
      page,
      pageSize,
      totalPages,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ success: false, message, error: message });
  }
});

// ─── GET /seed-scenarios ─────────────────────────────────────────────────────
// Task 12.3: List all seed scenarios

router.get('/seed-scenarios', async (_req: Request, res: Response): Promise<void> => {
  try {
    const scenarios = await FlashDealSeedScenario.find({}).lean();
    res.json({
      scenarios,
      count: scenarios.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ success: false, message, error: message });
  }
});

// ─── GET /impact/aggregate ───────────────────────────────────────────────────
// Task 12.3: Aggregate business + sustainability impact metrics

router.get('/impact/aggregate', async (_req: Request, res: Response): Promise<void> => {
  try {
    const [business, sustainability] = await Promise.all([
      calculateBusinessAggregate(),
      calculateSustainabilityAggregate(),
    ]);

    res.json({
      business,
      sustainability,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ success: false, message, error: message });
  }
});

export default router;
