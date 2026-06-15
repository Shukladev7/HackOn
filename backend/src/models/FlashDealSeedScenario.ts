import mongoose, { Schema, Document } from 'mongoose';
import { DispositionDecision } from './FlashDealEvaluation';

export interface IFeatureVector {
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
}

export interface IFlashDealSeedScenario extends Document {
  scenarioId: string;
  name: string;
  description: string;
  category: string;
  city: string;
  features: IFeatureVector;
  expectedDecision: DispositionDecision;
  createdAt: Date;
  updatedAt: Date;
}

const FeatureVectorSchema = new Schema(
  {
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
  { _id: false }
);

const FlashDealSeedScenarioSchema = new Schema<IFlashDealSeedScenario>(
  {
    scenarioId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true, maxlength: 100 },
    description: { type: String, required: true, maxlength: 500 },
    category: { type: String, required: true },
    city: { type: String, required: true },
    features: { type: FeatureVectorSchema, required: true },
    expectedDecision: {
      type: String,
      enum: ['FLASH_DEAL', 'AMAZON_RENEWED', 'NORMAL_RESALE', 'CIRCULAR_ROUTING', 'WAREHOUSE_RETURN'],
      required: true,
    },
  },
  { timestamps: true }
);

export const FlashDealSeedScenario = mongoose.model<IFlashDealSeedScenario>(
  'FlashDealSeedScenario',
  FlashDealSeedScenarioSchema
);
