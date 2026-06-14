import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IEvidenceStore extends Document {
  rtoEventId: Types.ObjectId;
  sourceType: 'gps' | 'call_logs' | 'delivery_scans' | 'order_history' | 'support_tickets' | 'address_validation' | 'hub_events';
  rawData: Record<string, unknown>;
  sourceId: string;
  collectedAt: Date;
  expiresAt: Date;
}

const EvidenceStoreSchema = new Schema<IEvidenceStore>(
  {
    rtoEventId: { type: Schema.Types.ObjectId, ref: 'RTOEvent', required: true },
    sourceType: {
      type: String,
      enum: ['gps', 'call_logs', 'delivery_scans', 'order_history', 'support_tickets', 'address_validation', 'hub_events'],
      required: true,
    },
    rawData: { type: Schema.Types.Mixed, required: true },
    sourceId: { type: String, required: true },
    collectedAt: { type: Date, required: true, default: Date.now },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

// Evidence collection queries
EvidenceStoreSchema.index({ rtoEventId: 1, sourceType: 1 });

// TTL index for automatic evidence expiration
EvidenceStoreSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// TTL for evidence retention (90 days from collection)
EvidenceStoreSchema.index({ collectedAt: 1 }, { expireAfterSeconds: 7776000 });

export const EvidenceStore = mongoose.model<IEvidenceStore>('EvidenceStore', EvidenceStoreSchema);
