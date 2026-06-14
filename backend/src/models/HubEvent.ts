import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IHubEvent extends Document {
  rtoEventId: Types.ObjectId;
  hubId: string;
  eventType: string;
  scanData: Record<string, unknown>;
  occurredAt: Date;
}

const HubEventSchema = new Schema<IHubEvent>(
  {
    rtoEventId: { type: Schema.Types.ObjectId, ref: 'RTOEvent', required: true },
    hubId: { type: String, required: true },
    eventType: { type: String, required: true },
    scanData: { type: Schema.Types.Mixed, default: {} },
    occurredAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true }
);

// Time-based queries for evidence collection
HubEventSchema.index({ rtoEventId: 1, occurredAt: -1 });

export const HubEvent = mongoose.model<IHubEvent>('HubEvent', HubEventSchema);
