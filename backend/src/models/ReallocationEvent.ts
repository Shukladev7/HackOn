import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IReallocationStep {
  step: 'order_creation' | 'label_generation' | 'buyer_notification' | 'original_customer_notification';
  status: 'pending' | 'completed' | 'failed' | 'rolled_back';
  completedAt?: Date;
  error?: string;
}

export interface IReallocationEvent extends Document {
  rtoEventId: Types.ObjectId;
  originalOrderId: Types.ObjectId;
  newOrderId?: Types.ObjectId;
  buyerId: Types.ObjectId;
  status: 'in_progress' | 'completed' | 'failed' | 'rolled_back';
  steps: IReallocationStep[];
  gstCreditNote?: {
    noteId: string;
    generatedAt: Date;
  };
  gstInvoice?: {
    invoiceId: string;
    generatedAt: Date;
  };
  createdAt: Date;
  completedAt?: Date;
}

const ReallocationEventSchema = new Schema<IReallocationEvent>(
  {
    rtoEventId: { type: Schema.Types.ObjectId, ref: 'RTOEvent', required: true, index: true },
    originalOrderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    newOrderId: { type: Schema.Types.ObjectId, ref: 'Order' },
    buyerId: { type: Schema.Types.ObjectId, required: true, index: true },
    status: {
      type: String,
      enum: ['in_progress', 'completed', 'failed', 'rolled_back'],
      default: 'in_progress',
      required: true,
    },
    steps: [
      {
        step: {
          type: String,
          enum: ['order_creation', 'label_generation', 'buyer_notification', 'original_customer_notification'],
          required: true,
        },
        status: {
          type: String,
          enum: ['pending', 'completed', 'failed', 'rolled_back'],
          default: 'pending',
          required: true,
        },
        completedAt: { type: Date },
        error: { type: String },
      },
    ],
    gstCreditNote: {
      noteId: { type: String },
      generatedAt: { type: Date },
    },
    gstInvoice: {
      invoiceId: { type: String },
      generatedAt: { type: Date },
    },
    completedAt: { type: Date },
  },
  { timestamps: true }
);

export const ReallocationEvent = mongoose.model<IReallocationEvent>('ReallocationEvent', ReallocationEventSchema);
