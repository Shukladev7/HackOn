import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IDecisionRecord extends Document {
  rtoEventId: Types.ObjectId;
  rootCause: {
    category: string;
    subCause: string;
    scores: { customer: number; courier: number; system: number };
  };
  action: 'redeliver' | 'reallocate' | 'warehouse_return';
  reasoning: string;
  inputs: {
    recoveryProbability: number;
    candidateBuyerCount: number;
    topBuyerScore: number | null;
  };
  selectedBuyerId?: Types.ObjectId;
  decidedAt: Date;
}

const DecisionRecordSchema = new Schema<IDecisionRecord>(
  {
    rtoEventId: { type: Schema.Types.ObjectId, ref: 'RTOEvent', required: true, index: true },
    rootCause: {
      category: { type: String, required: true },
      subCause: { type: String, required: true },
      scores: {
        customer: { type: Number, required: true },
        courier: { type: Number, required: true },
        system: { type: Number, required: true },
      },
    },
    action: {
      type: String,
      enum: ['redeliver', 'reallocate', 'warehouse_return'],
      required: true,
    },
    reasoning: { type: String, required: true },
    inputs: {
      recoveryProbability: { type: Number, required: true },
      candidateBuyerCount: { type: Number, required: true },
      topBuyerScore: { type: Number, default: null },
    },
    selectedBuyerId: { type: Schema.Types.ObjectId },
    decidedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true }
);

// Decision history and metrics aggregation
DecisionRecordSchema.index({ action: 1, decidedAt: -1 });

export const DecisionRecord = mongoose.model<IDecisionRecord>('DecisionRecord', DecisionRecordSchema);
