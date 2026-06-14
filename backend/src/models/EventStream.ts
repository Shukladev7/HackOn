import mongoose, { Schema, Document } from 'mongoose';

export interface IEventStream extends Document {
  eventType: string;
  sourceEntityId: string;
  targetEntityId: string;
  actorModule: string;
  outcomeStatus: 'success' | 'failure' | 'partial';
  inputParams: Record<string, unknown>;
  timestamp: Date;
  buffered: boolean;
  retryCount: number;
}

const EventStreamSchema = new Schema<IEventStream>(
  {
    eventType: {
      type: String,
      required: true,
      enum: [
        'eligibility_check',
        'classification',
        'prediction',
        'demand_match',
        'ranking',
        'decision',
        'reallocation',
      ],
    },
    sourceEntityId: { type: String, required: true },
    targetEntityId: { type: String, required: true },
    actorModule: {
      type: String,
      required: true,
      enum: [
        'evidence_collection',
        'root_cause_classifier',
        'sale_recovery_predictor',
        'demand_matching',
        'buyer_ranking',
        'decision_engine',
      ],
    },
    outcomeStatus: {
      type: String,
      enum: ['success', 'failure', 'partial'],
      required: true,
    },
    inputParams: { type: Schema.Types.Mixed, default: {} },
    timestamp: { type: Date, required: true, default: Date.now },
    buffered: { type: Boolean, default: false },
    retryCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Event stream queries
EventStreamSchema.index({ sourceEntityId: 1, timestamp: -1 });
EventStreamSchema.index({ eventType: 1, timestamp: -1 });

export const EventStream = mongoose.model<IEventStream>('EventStream', EventStreamSchema);
