import mongoose, { Schema, Document } from 'mongoose';

export interface ICustomer extends Document {
  name: string;
  email: string;
  phone: string;
  address: {
    line1: string;
    line2?: string;
    city: string;
    state: string;
    pincode: string;
    geoLocation: {
      type: 'Point';
      coordinates: [number, number]; // [lng, lat]
    };
  };
  gstin?: string;
  deliveryPreferences: {
    preferredTimeSlot?: string;
    alternatePhone?: string;
    landmarkNotes?: string;
  };
  stats: {
    totalOrders: number;
    returnRate: number;
    avgOrderValue: number;
    rtoCount30d: number;
  };
  fraudFlag: {
    flagged: boolean;
    flaggedAt?: Date;
    reason?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

const CustomerSchema = new Schema<ICustomer>(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, index: true },
    phone: { type: String, required: true },
    address: {
      line1: { type: String, required: true },
      line2: { type: String },
      city: { type: String, required: true },
      state: { type: String, required: true },
      pincode: { type: String, required: true },
      geoLocation: {
        type: { type: String, enum: ['Point'], default: 'Point' },
        coordinates: { type: [Number], required: true },
      },
    },
    gstin: { type: String },
    deliveryPreferences: {
      preferredTimeSlot: { type: String },
      alternatePhone: { type: String },
      landmarkNotes: { type: String },
    },
    stats: {
      totalOrders: { type: Number, default: 0 },
      returnRate: { type: Number, default: 0 },
      avgOrderValue: { type: Number, default: 0 },
      rtoCount30d: { type: Number, default: 0 },
    },
    fraudFlag: {
      flagged: { type: Boolean, default: false },
      flaggedAt: { type: Date },
      reason: { type: String },
    },
  },
  { timestamps: true }
);

// Geospatial index for demand matching (2dsphere)
CustomerSchema.index({ 'address.geoLocation': '2dsphere' });

// Fraud detection index
CustomerSchema.index({ 'fraudFlag.flagged': 1 });

export const Customer = mongoose.model<ICustomer>('Customer', CustomerSchema);
