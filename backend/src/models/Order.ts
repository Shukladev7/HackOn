import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IOrder extends Document {
  customerId: Types.ObjectId;
  sku: string;
  productCategory: string;
  price: number;
  priceTier: 'low' | 'medium' | 'high' | 'premium';
  hsnCode: string;
  status: string;
  originalOrderId?: Types.ObjectId;
  reallocationEventId?: Types.ObjectId;
  placedAt: Date;
  updatedAt: Date;
}

const OrderSchema = new Schema<IOrder>(
  {
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    sku: { type: String, required: true },
    productCategory: { type: String, required: true },
    price: { type: Number, required: true },
    priceTier: { type: String, enum: ['low', 'medium', 'high', 'premium'], required: true },
    hsnCode: { type: String, required: true },
    status: { type: String, required: true, default: 'placed' },
    originalOrderId: { type: Schema.Types.ObjectId, ref: 'Order' },
    reallocationEventId: { type: Schema.Types.ObjectId, ref: 'ReallocationEvent' },
    placedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true }
);

export const Order = mongoose.model<IOrder>('Order', OrderSchema);
