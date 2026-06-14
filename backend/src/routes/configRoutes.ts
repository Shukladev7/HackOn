/**
 * Configuration routes handler.
 *
 * GET  /api/v1/config — get current system configuration
 * PATCH /api/v1/config — update configurable thresholds
 *
 * Requirements: 3.2, 4.1, 5.1, 6.2, 6.4, 12.6
 */
import { Router, Request, Response } from 'express';
import { config } from '../config';

const router = Router();

/**
 * In-memory runtime config overrides.
 * These overlay the base config values loaded from environment.
 * In production, these would be persisted to a database.
 */
const runtimeOverrides: Record<string, number> = {};

/** All configurable threshold keys that can be modified at runtime */
const CONFIGURABLE_KEYS = [
  'confidenceThreshold',
  'subCauseConfidenceThreshold',
  'recoveryProbabilityThreshold',
  'courierRedeliveryRecoveryThreshold',
  'searchRadiusKm',
  'cartRecencyDays',
  'intentThreshold',
  'refusalLookbackDays',
  'minBuyerScore',
  'maxRankedBuyers',
  'fraudRtoCountThreshold',
  'fraudTimeWindowDays',
  'courierEscalationWindowDays',
  'courierEscalationThreshold',
  'eventBufferCapacity',
  'retryMaxAttempts',
  'retryInitialDelayMs',
  'evidenceSourceTimeoutMs',
  'minEvidenceSources',
  'evidenceLookbackHours',
] as const;

/**
 * Gets the effective value for a config key, taking runtime overrides into account.
 */
function getEffectiveValue(key: string): number {
  if (key in runtimeOverrides) {
    return runtimeOverrides[key]!;
  }
  return (config as any)[key];
}

/**
 * GET /api/v1/config
 * Returns current system configuration including any runtime overrides.
 */
router.get('/', (_req: Request, res: Response) => {
  const currentConfig: Record<string, number | Record<string, number>> = {};

  for (const key of CONFIGURABLE_KEYS) {
    currentConfig[key] = getEffectiveValue(key);
  }

  // Include ranking weights as a nested object
  currentConfig.rankingWeights = {
    distance: config.rankingWeights.distance,
    conversion: config.rankingWeights.conversion,
    speed: config.rankingWeights.speed,
    margin: config.rankingWeights.margin,
  };

  return res.json({
    config: currentConfig,
    overrides: { ...runtimeOverrides },
  });
});

/**
 * PATCH /api/v1/config
 * Updates configurable thresholds at runtime.
 * Only accepts keys from the CONFIGURABLE_KEYS list.
 * Values must be numbers.
 */
router.patch('/', (req: Request, res: Response) => {
  const updates = req.body;

  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
    return res.status(400).json({ error: 'Request body must be a JSON object' });
  }

  const appliedUpdates: Record<string, number> = {};
  const invalidKeys: string[] = [];
  const invalidValues: string[] = [];

  for (const [key, value] of Object.entries(updates)) {
    if (!(CONFIGURABLE_KEYS as readonly string[]).includes(key)) {
      invalidKeys.push(key);
      continue;
    }
    if (typeof value !== 'number' || isNaN(value)) {
      invalidValues.push(key);
      continue;
    }
    runtimeOverrides[key] = value;
    appliedUpdates[key] = value;
  }

  if (invalidKeys.length > 0 || invalidValues.length > 0) {
    return res.status(400).json({
      error: 'Some fields could not be updated',
      invalidKeys,
      invalidValues,
      applied: appliedUpdates,
    });
  }

  return res.json({
    message: 'Configuration updated successfully',
    applied: appliedUpdates,
  });
});

/**
 * Get the current runtime overrides (exposed for testing).
 */
export function getRuntimeOverrides(): Record<string, number> {
  return { ...runtimeOverrides };
}

/**
 * Clear runtime overrides (for testing purposes).
 */
export function clearRuntimeOverrides(): void {
  for (const key of Object.keys(runtimeOverrides)) {
    delete runtimeOverrides[key];
  }
}

export default router;
