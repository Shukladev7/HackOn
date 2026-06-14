import dotenv from 'dotenv';

dotenv.config();

function envInt(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (value === undefined || value === '') return defaultValue;
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) return defaultValue;
  return parsed;
}

function envFloat(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (value === undefined || value === '') return defaultValue;
  const parsed = parseFloat(value);
  if (isNaN(parsed)) return defaultValue;
  return parsed;
}

function envString(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue;
}

export const config = {
  // Server
  port: envInt('PORT', 3000),
  nodeEnv: envString('NODE_ENV', 'development'),
  mlServiceUrl: envString('ML_SERVICE_URL', 'http://localhost:8000'),

  // Database
  mongodbUri: envString('MONGODB_URI', 'mongodb://localhost:27017/rto-reallocation'),
  redisUrl: envString('REDIS_URL', 'redis://localhost:6379'),

  // OpenAI
  openaiApiKey: envString('OPENAI_API_KEY', ''),
  openaiModel: envString('OPENAI_MODEL', 'gpt-4'),

  // Root Cause Classifier (Requirement 3.2)
  confidenceThreshold: envFloat('CONFIDENCE_THRESHOLD', 0.6),
  subCauseConfidenceThreshold: envFloat('SUB_CAUSE_CONFIDENCE_THRESHOLD', 0.5),

  // Sale Recovery Predictor (Requirement 4.1)
  recoveryProbabilityThreshold: envFloat('RECOVERY_PROBABILITY_THRESHOLD', 0.3),
  courierRedeliveryRecoveryThreshold: envFloat('COURIER_REDELIVERY_RECOVERY_THRESHOLD', 0.5),

  // Demand Matching (Requirement 5.1)
  searchRadiusKm: envInt('SEARCH_RADIUS_KM', 50),
  cartRecencyDays: envInt('CART_RECENCY_DAYS', 7),
  intentThreshold: envFloat('INTENT_THRESHOLD', 0.6),
  refusalLookbackDays: envInt('REFUSAL_LOOKBACK_DAYS', 90),

  // Buyer Ranking (Requirements 6.2, 6.4)
  rankingWeights: {
    distance: envFloat('RANKING_WEIGHT_DISTANCE', 0.25),
    conversion: envFloat('RANKING_WEIGHT_CONVERSION', 0.35),
    speed: envFloat('RANKING_WEIGHT_SPEED', 0.20),
    margin: envFloat('RANKING_WEIGHT_MARGIN', 0.20),
  },
  minBuyerScore: envFloat('MIN_BUYER_SCORE', 0.4),
  maxRankedBuyers: envInt('MAX_RANKED_BUYERS', 10),

  // Fraud Detection (Requirement 12.6)
  fraudRtoCountThreshold: envInt('FRAUD_RTO_COUNT_THRESHOLD', 5),
  fraudTimeWindowDays: envInt('FRAUD_TIME_WINDOW_DAYS', 30),

  // Courier Escalation (Requirement 9.2)
  courierEscalationWindowDays: envInt('COURIER_ESCALATION_WINDOW_DAYS', 7),
  courierEscalationThreshold: envInt('COURIER_ESCALATION_THRESHOLD', 3),

  // Event Buffering (Requirement 11.3)
  eventBufferCapacity: envInt('EVENT_BUFFER_CAPACITY', 500000),

  // Retry Policy (Requirement 11.4)
  retryMaxAttempts: envInt('RETRY_MAX_ATTEMPTS', 3),
  retryInitialDelayMs: envInt('RETRY_INITIAL_DELAY_MS', 1000),

  // Evidence Collection (Requirements 2.1, 2.2)
  evidenceSourceTimeoutMs: envInt('EVIDENCE_SOURCE_TIMEOUT_MS', 5000),
  minEvidenceSources: envInt('MIN_EVIDENCE_SOURCES', 3),
  evidenceLookbackHours: envInt('EVIDENCE_LOOKBACK_HOURS', 72),

  // Data Retention
  evidenceRetentionDays: envInt('EVIDENCE_RETENTION_DAYS', 90),
  eventRetentionDays: envInt('EVENT_RETENTION_DAYS', 365),
  auditRetentionYears: envInt('AUDIT_RETENTION_YEARS', 7),
} as const;

export type Config = typeof config;
export default config;
