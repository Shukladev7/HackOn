/**
 * Shared TypeScript interfaces and types for the Flash Deal Eligibility Engine.
 *
 * Requirements: 1.1, 3.1, 8.1
 */

// ─── Feature Interfaces ─────────────────────────────────────────────────────

export interface ProductFeatures {
  category: string;
  mrp: number;
  currentMarketPrice: number;
  brandPopularityScore: number;
}

export interface ConditionFeatures {
  inspectionGrade: 'A' | 'B' | 'C' | 'D' | 'F';
  packagingCondition: 'Original' | 'Damaged' | 'Missing';
  damageScore: number;
  batteryHealth: number;
}

export interface DemandFeatures {
  wishlistCount: number;
  cartCount: number;
  nearbyInterestedBuyers: number;
  historicalConversionRate: number;
}

export interface LocationFeatures {
  city: string;
  demandDensity: number;
  distanceToBuyers: number;
}

export interface FinancialFeatures {
  expectedRecoveryValue: number;
  warehouseCostAvoided: number;
  deliveryCostSaved: number;
}

export interface FeatureVector {
  product: ProductFeatures;
  condition: ConditionFeatures;
  demand: DemandFeatures;
  location: LocationFeatures;
  financial: FinancialFeatures;
  metadata: {
    source: 'passport' | 'seed' | 'random';
    syntheticFields: string[];
    generatedAt: string;
  };
}

// ─── Score Interfaces ────────────────────────────────────────────────────────

export interface CategoryScores {
  condition: number;
  demand: number;
  financial: number;
  location: number;
}

export interface ScoreWeights {
  condition: number;
  demand: number;
  financial: number;
  location: number;
}

export interface ScoreResult {
  flashDealScore: number;
  confidenceScore: number;
  categoryScores: CategoryScores;
  weights: ScoreWeights;
}

// ─── Disposition ─────────────────────────────────────────────────────────────

export type DispositionDecision =
  | 'FLASH_DEAL'
  | 'AMAZON_RENEWED'
  | 'NORMAL_RESALE'
  | 'CIRCULAR_ROUTING'
  | 'WAREHOUSE_RETURN';

export interface DispositionResult {
  decision: DispositionDecision;
  matchedRule: string;
  flashDealScore: number;
  confidenceScore: number;
  inspectionGrade: string;
}

// ─── Pipeline ────────────────────────────────────────────────────────────────

export interface PipelineStage {
  name: string;
  index: number;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  durationMs: number;
  result?: {
    categoryScore: number;
    factors: string[];
  };
}

export interface PipelineProgressEvent {
  evaluationId: string;
  stage: string;
  stageIndex: number;
  progress: number;
  status: 'pending' | 'in_progress' | 'completed';
}

// ─── Explainability ──────────────────────────────────────────────────────────

export interface Factor {
  label: string;
  featureName: string;
  value: number;
  percentile: number;
}

export interface ExplainabilityReport {
  positiveFactors: Factor[];
  negativeFactors: Factor[];
  explanation: string;
}

// ─── Score Breakdown ─────────────────────────────────────────────────────────

export interface ScoreContributor {
  name: string;
  points: number;
  maximum: number;
}

// ─── Business Impact ─────────────────────────────────────────────────────────

export interface BusinessImpact {
  traditionalReturnCost: number;
  flashDealRouteCost: number;
  savingsAmount: number;
  costReductionPercentage: number;
  warehouseTouchesAvoided: number;
  estimatedRecoveryValue: number | null;
  revenueRecoveryRate: number | null;
  missingInputs?: string[];
}

// ─── Sustainability ──────────────────────────────────────────────────────────

export interface SustainabilityMetrics {
  traditionalDistance: number;
  flashDealDistance: number;
  distanceSaved: number;
  co2Saved: number;
}

// ─── Validation ──────────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// ─── Evaluation Status ───────────────────────────────────────────────────────

export type EvaluationStatus = 'processing' | 'completed' | 'failed';
