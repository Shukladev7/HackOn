import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IRTOEvent extends Document {
  deliveryAttemptId: Types.ObjectId;
  shipmentId: string;
  orderId: Types.ObjectId;
  customerId: Types.ObjectId;
  courierId: Types.ObjectId;
  packageDetails: {
    sku: string;
    weight: number;
    dimensions: { l: number; w: number; h: number };
    category: string;
    price: number;
    hsnCode: string;
  };
  hubLocation: {
    type: 'Point';
    coordinates: [number, number]; // [lng, lat]
    hubId: string;
  };
  eligibility: {
    eligible: boolean;
    conditions: {
      unopened: { pass: boolean; evidenceIds: string[] };
      undamaged: { pass: boolean; evidenceIds: string[] };
      sealed: { pass: boolean; evidenceIds: string[] };
    };
    determinedAt?: Date;
  };
  classification?: {
    customerScore: number;
    courierScore: number;
    systemScore: number;
    primaryCategory?: string;
    subCause?: string;
    subCauseConfidence: number;
    requiresManualReview: boolean;
    classifiedAt?: Date;
  };
  recoveryPrediction?: {
    probability: number;
    partiallyImputed: boolean;
    imputedFeatures: string[];
    predictedAt?: Date;
  };
  decision?: {
    action: 'redeliver' | 'reallocate' | 'warehouse_return';
    reasoning: string;
    inputs: {
      recoveryProbability: number;
      candidateBuyerCount: number;
      topBuyerScore: number | null;
    };
    selectedBuyerId?: Types.ObjectId;
    decidedAt?: Date;
  };
  receivedAt: Date;
  processedAt?: Date;
  status: 'received' | 'eligible' | 'ineligible' | 'classified' | 'decided' | 'executed';
}

const RTOEventSchema = new Schema<IRTOEvent>(
  {
    deliveryAttemptId: { type: Schema.Types.ObjectId, ref: 'DeliveryAttempt', required: true },
    shipmentId: { type: String, required: true, index: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    courierId: { type: Schema.Types.ObjectId, ref: 'Courier', required: true },
    packageDetails: {
      sku: { type: String, required: true },
      weight: { type: Number, required: true },
      dimensions: {
        l: { type: Number, required: true },
        w: { type: Number, required: true },
        h: { type: Number, required: true },
      },
      category: { type: String, required: true },
      price: { type: Number, required: true },
      hsnCode: { type: String, required: true },
    },
    hubLocation: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], required: true },
      hubId: { type: String, required: true },
    },
    eligibility: {
      eligible: { type: Boolean, default: false },
      conditions: {
        unopened: {
          pass: { type: Boolean, default: false },
          evidenceIds: { type: [String], default: [] },
        },
        undamaged: {
          pass: { type: Boolean, default: false },
          evidenceIds: { type: [String], default: [] },
        },
        sealed: {
          pass: { type: Boolean, default: false },
          evidenceIds: { type: [String], default: [] },
        },
      },
      determinedAt: { type: Date },
    },
    classification: {
      customerScore: { type: Number },
      courierScore: { type: Number },
      systemScore: { type: Number },
      primaryCategory: { type: String },
      subCause: { type: String },
      subCauseConfidence: { type: Number },
      requiresManualReview: { type: Boolean },
      classifiedAt: { type: Date },
    },
    recoveryPrediction: {
      probability: { type: Number },
      partiallyImputed: { type: Boolean },
      imputedFeatures: { type: [String] },
      predictedAt: { type: Date },
    },
    decision: {
      action: { type: String, enum: ['redeliver', 'reallocate', 'warehouse_return'] },
      reasoning: { type: String },
      inputs: {
        recoveryProbability: { type: Number },
        candidateBuyerCount: { type: Number },
        topBuyerScore: { type: Number },
      },
      selectedBuyerId: { type: Schema.Types.ObjectId },
      decidedAt: { type: Date },
    },
    receivedAt: { type: Date, required: true, default: Date.now },
    processedAt: { type: Date },
    status: {
      type: String,
      enum: ['received', 'eligible', 'ineligible', 'classified', 'decided', 'executed'],
      default: 'received',
      required: true,
    },
  },
  { timestamps: true }
);

// Geospatial index for hub location (2dsphere)
RTOEventSchema.index({ hubLocation: '2dsphere' });

// Courier escalation queries
RTOEventSchema.index({ courierId: 1, receivedAt: -1 });
RTOEventSchema.index({ 'classification.primaryCategory': 1, courierId: 1 });

// Fraud detection - customer RTO frequency
RTOEventSchema.index({ customerId: 1, receivedAt: -1 });

export const RTOEvent = mongoose.model<IRTOEvent>('RTOEvent', RTOEventSchema);
