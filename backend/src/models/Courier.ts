import mongoose, { Schema, Document } from 'mongoose';

export interface ICourier extends Document {
  name: string;
  partnerId: string;
  region: string;
  rtoCount7d: number;
  fraudFlag: {
    flagged: boolean;
    flaggedAt?: Date;
    reason?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

const CourierSchema = new Schema<ICourier>(
  {
    name: { type: String, required: true },
    partnerId: { type: String, required: true, index: true },
    region: { type: String, required: true },
    rtoCount7d: { type: Number, default: 0 },
    fraudFlag: {
      flagged: { type: Boolean, default: false },
      flaggedAt: { type: Date },
      reason: { type: String },
    },
  },
  { timestamps: true }
);

// Fraud detection index
CourierSchema.index({ 'fraudFlag.flagged': 1 });

export const Courier = mongoose.model<ICourier>('Courier', CourierSchema);
