import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IDeliveryAttempt extends Document {
  orderId: Types.ObjectId;
  courierId: Types.ObjectId;
  attemptNumber: number;
  gpsLocation: {
    type: 'Point';
    coordinates: [number, number]; // [lng, lat]
  };
  statusCode: string;
  failureReason: string;
  attemptedAt: Date;
}

const DeliveryAttemptSchema = new Schema<IDeliveryAttempt>(
  {
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    courierId: { type: Schema.Types.ObjectId, ref: 'Courier', required: true, index: true },
    attemptNumber: { type: Number, required: true },
    gpsLocation: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], required: true },
    },
    statusCode: { type: String, required: true },
    failureReason: { type: String, required: true },
    attemptedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true }
);

// Geospatial index for GPS location queries
DeliveryAttemptSchema.index({ gpsLocation: '2dsphere' });

export const DeliveryAttempt = mongoose.model<IDeliveryAttempt>('DeliveryAttempt', DeliveryAttemptSchema);
