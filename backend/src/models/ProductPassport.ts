import mongoose, { Schema, Document } from 'mongoose';

export interface IProductPassport extends Document {
  passportId: string;
  qrCodeValue: string;
  sku: string;
  productName: string;
  category: string;
  condition: 'new' | 'like_new' | 'good' | 'fair';
  currentOwner: string;
  currentLocation: { city: string; hub: string };
  currentStatus: 'in_transit' | 'at_hub' | 'delivered' | 'return_initiated' | 'routed' | 'reallocated';
  eligibilityScore: number;
  reservedBuyer: { name: string; city: string; distance: string; score: number } | null;
  ownershipHistory: Array<{ owner: string; from: string; to: string; date: string }>;
  returnHistory: Array<{ reason: string; date: string; condition: string }>;
  routingHistory: Array<{ event: string; timestamp: string; details: string; status: 'completed' | 'active' | 'pending' }>;
  createdAt: Date;
  updatedAt: Date;
}

const ProductPassportSchema = new Schema<IProductPassport>(
  {
    passportId: { type: String, required: true, unique: true, index: true },
    qrCodeValue: { type: String, required: true, unique: true, index: true },
    sku: { type: String, required: true },
    productName: { type: String, required: true },
    category: { type: String, required: true },
    condition: { type: String, enum: ['new', 'like_new', 'good', 'fair'], required: true },
    currentOwner: { type: String, required: true },
    currentLocation: {
      city: { type: String, required: true },
      hub: { type: String, required: true },
    },
    currentStatus: {
      type: String,
      enum: ['in_transit', 'at_hub', 'delivered', 'return_initiated', 'routed', 'reallocated'],
      required: true,
    },
    eligibilityScore: { type: Number, required: true, min: 0, max: 100 },
    reservedBuyer: {
      type: {
        name: String,
        city: String,
        distance: String,
        score: Number,
      },
      default: null,
    },
    ownershipHistory: [
      {
        owner: String,
        from: String,
        to: String,
        date: String,
      },
    ],
    returnHistory: [
      {
        reason: String,
        date: String,
        condition: String,
      },
    ],
    routingHistory: [
      {
        event: String,
        timestamp: String,
        details: String,
        status: { type: String, enum: ['completed', 'active', 'pending'] },
      },
    ],
  },
  { timestamps: true }
);

export const ProductPassport = mongoose.model<IProductPassport>('ProductPassport', ProductPassportSchema);
