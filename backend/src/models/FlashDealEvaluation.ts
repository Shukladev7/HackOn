import mongoose, { Schema, Document } from 'mongoose';

export type DispositionDecision =
  | 'FLASH_DEAL'
  | 'AMAZON_RENEWED'
  | 'NORMAL_RESALE'
  | 'CIRCULAR_ROUTING'
  | 'WAREHOUSE_RETURN';

export interface IFactor {
  label: string;
  featureName: string;
  value: number;
  percentile: number;
}

export interface IScoreContributor {
  name: string;
  points: number;
  maximum: number;
}

export interface IFlashDealEvaluation extends Document {
  evaluationId: string;
  productId: string | null;
  scenarioId: string | null;
  status: 'processing' | 'completed' | 'failed';

  inputFeatures: {
    product: {
      category: string;
      mrp: number;
      currentMarketPrice: number;
      brandPopularityScore: number;
    };
    condition: {
      inspectionGrade: 'A' | 'B' | 'C' | 'D' | 'F';
      packagingCondition: 'Original' | 'Damaged' | 'Missing';
      damageScore: number;
      batteryHealth: number;
    };
    demand: {
      wishlistCount: number;
      cartCount: number;
      nearbyInterestedBuyers: number;
      historicalConversionRate: number;
    };
    location: {
      city: string;
      demandDensity: number;
      distanceToBuyers: number;
    };
    financial: {
      expectedRecoveryValue: number;
      warehouseCostAvoided: number;
      deliveryCostSaved: number;
    };
    metadata: {
      source: 'passport' | 'seed' | 'random';
      syntheticFields: string[];
      generatedAt: string;
    };
  };

  pipelineStages: Array<{
    name: string;
    index: number;
    status: 'pending' | 'in_progress' | 'completed' | 'failed';
    durationMs: number;
    startedAt: string;
    completedAt: string;
  }>;

  result: {
    flashDealScore: number;
    confidenceScore: number;
    dispositionDecision: DispositionDecision;
    categoryScores: {
      condition: number;
      demand: number;
      financial: number;
      location: number;
    };
    matchedRule: string;
  } | null;

  explainability: {
    positiveFactors: IFactor[];
    negativeFactors: IFactor[];
    explanation: string;
  } | null;

  scoreBreakdown: IScoreContributor[] | null;

  businessImpact: {
    traditionalReturnCost: number;
    flashDealRouteCost: number;
    savingsAmount: number;
    costReductionPercentage: number;
    warehouseTouchesAvoided: number;
    estimatedRecoveryValue: number | null;
    revenueRecoveryRate: number | null;
    missingInputs?: string[];
  } | null;

  sustainability: {
    traditionalDistance: number;
    flashDealDistance: number;
    distanceSaved: number;
    co2Saved: number;
  } | null;

  startedAt: string;
  completedAt: string | null;
  error: string | null;

  createdAt: Date;
  updatedAt: Date;
}

const FactorSchema = new Schema(
  {
    label: { type: String, required: true },
    featureName: { type: String, required: true },
    value: { type: Number, required: true },
    percentile: { type: Number, required: true },
  },
  { _id: false }
);

const ScoreContributorSchema = new Schema(
  {
    name: { type: String, required: true },
    points: { type: Number, required: true },
    maximum: { type: Number, required: true },
  },
  { _id: false }
);

const FlashDealEvaluationSchema = new Schema<IFlashDealEvaluation>(
  {
    evaluationId: { type: String, required: true, unique: true },
    productId: { type: String, default: null },
    scenarioId: { type: String, default: null },
    status: {
      type: String,
      enum: ['processing', 'completed', 'failed'],
      required: true,
    },

    inputFeatures: {
      product: {
        category: { type: String, required: true },
        mrp: { type: Number, required: true },
        currentMarketPrice: { type: Number, required: true },
        brandPopularityScore: { type: Number, required: true },
      },
      condition: {
        inspectionGrade: { type: String, enum: ['A', 'B', 'C', 'D', 'F'], required: true },
        packagingCondition: { type: String, enum: ['Original', 'Damaged', 'Missing'], required: true },
        damageScore: { type: Number, required: true },
        batteryHealth: { type: Number, required: true },
      },
      demand: {
        wishlistCount: { type: Number, required: true },
        cartCount: { type: Number, required: true },
        nearbyInterestedBuyers: { type: Number, required: true },
        historicalConversionRate: { type: Number, required: true },
      },
      location: {
        city: { type: String, required: true },
        demandDensity: { type: Number, required: true },
        distanceToBuyers: { type: Number, required: true },
      },
      financial: {
        expectedRecoveryValue: { type: Number, required: true },
        warehouseCostAvoided: { type: Number, required: true },
        deliveryCostSaved: { type: Number, required: true },
      },
      metadata: {
        source: { type: String, enum: ['passport', 'seed', 'random'], required: true },
        syntheticFields: [{ type: String }],
        generatedAt: { type: String, required: true },
      },
    },

    pipelineStages: [
      {
        name: { type: String, required: true },
        index: { type: Number, required: true },
        status: { type: String, enum: ['pending', 'in_progress', 'completed', 'failed'], required: true },
        durationMs: { type: Number, required: true },
        startedAt: { type: String, required: true },
        completedAt: { type: String, required: true },
      },
    ],

    result: {
      type: {
        flashDealScore: { type: Number, required: true },
        confidenceScore: { type: Number, required: true },
        dispositionDecision: {
          type: String,
          enum: ['FLASH_DEAL', 'AMAZON_RENEWED', 'NORMAL_RESALE', 'CIRCULAR_ROUTING', 'WAREHOUSE_RETURN'],
          required: true,
        },
        categoryScores: {
          condition: { type: Number, required: true },
          demand: { type: Number, required: true },
          financial: { type: Number, required: true },
          location: { type: Number, required: true },
        },
        matchedRule: { type: String, required: true },
      },
      default: null,
    },

    explainability: {
      type: {
        positiveFactors: { type: [FactorSchema], required: true },
        negativeFactors: { type: [FactorSchema], required: true },
        explanation: { type: String, required: true },
      },
      default: null,
    },

    scoreBreakdown: {
      type: [ScoreContributorSchema],
      default: null,
    },

    businessImpact: {
      type: {
        traditionalReturnCost: { type: Number, required: true },
        flashDealRouteCost: { type: Number, required: true },
        savingsAmount: { type: Number, required: true },
        costReductionPercentage: { type: Number, required: true },
        warehouseTouchesAvoided: { type: Number, required: true },
        estimatedRecoveryValue: { type: Number, default: null },
        revenueRecoveryRate: { type: Number, default: null },
        missingInputs: { type: [String] },
      },
      default: null,
    },

    sustainability: {
      type: {
        traditionalDistance: { type: Number, required: true },
        flashDealDistance: { type: Number, required: true },
        distanceSaved: { type: Number, required: true },
        co2Saved: { type: Number, required: true },
      },
      default: null,
    },

    startedAt: { type: String, required: true },
    completedAt: { type: String, default: null },
    error: { type: String, default: null },
  },
  { timestamps: true }
);

// Indexes
FlashDealEvaluationSchema.index({ evaluationId: 1 }, { unique: true });
FlashDealEvaluationSchema.index({ status: 1, createdAt: -1 });
FlashDealEvaluationSchema.index({ 'result.dispositionDecision': 1, createdAt: -1 });
FlashDealEvaluationSchema.index({ 'inputFeatures.product.category': 1, createdAt: -1 });
FlashDealEvaluationSchema.index({ productId: 1 });

export const FlashDealEvaluation = mongoose.model<IFlashDealEvaluation>(
  'FlashDealEvaluation',
  FlashDealEvaluationSchema
);
