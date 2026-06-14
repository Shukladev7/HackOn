import { v4 as uuidv4 } from 'uuid';
import { Order, IOrder } from '../models/Order';
import { ReallocationEvent, IReallocationEvent, IReallocationStep } from '../models/ReallocationEvent';
import { RTOEvent, IRTOEvent } from '../models/RTOEvent';
import { Customer, ICustomer } from '../models/Customer';
import mongoose from 'mongoose';
import { ScoredCandidate } from './buyerRanking';

// --- Interfaces ---

export interface ReallocationStep {
  step: 'order_creation' | 'label_generation' | 'buyer_notification' | 'original_customer_notification';
  status: 'pending' | 'completed' | 'failed' | 'rolled_back';
  completedAt?: string;
  error?: string;
}

export interface ReallocationExecution {
  reallocationEventId: string;
  rtoEventId: string;
  originalOrderId: string;
  newOrderId: string;
  buyerId: string;
  steps: ReallocationStep[];
  status: 'in_progress' | 'completed' | 'failed' | 'rolled_back';
}

export interface ShippingLabel {
  labelId: string;
  trackingNumber: string;
  buyerAddress: {
    line1: string;
    line2?: string;
    city: string;
    state: string;
    pincode: string;
  };
  generatedAt: string;
}

export interface PackageDetails {
  sku: string;
  weight: number;
  dimensions: { l: number; w: number; h: number };
  category: string;
  price: number;
  hsnCode: string;
}

// --- Label Generation (simulated for MVP) ---

export async function generateShippingLabel(
  buyerAddress: ICustomer['address'],
  packageDetails: PackageDetails
): Promise<ShippingLabel> {
  // In production, this calls a logistics partner API
  return {
    labelId: uuidv4(),
    trackingNumber: `TRK-${uuidv4().substring(0, 8).toUpperCase()}`,
    buyerAddress: {
      line1: buyerAddress.line1,
      line2: buyerAddress.line2,
      city: buyerAddress.city,
      state: buyerAddress.state,
      pincode: buyerAddress.pincode,
    },
    generatedAt: new Date().toISOString(),
  };
}

// --- Notification Service (simulated for MVP) ---

export async function sendBuyerNotification(
  buyerId: string,
  newOrderId: string,
  estimatedDeliveryTime: string
): Promise<{ notificationId: string; sentAt: string }> {
  // In production, this sends email/SMS/push notification
  return {
    notificationId: uuidv4(),
    sentAt: new Date().toISOString(),
  };
}

export async function sendOriginalCustomerNotification(
  customerId: string,
  originalOrderId: string,
  reason: string
): Promise<{ notificationId: string; sentAt: string }> {
  // In production, this sends email/SMS/push notification
  return {
    notificationId: uuidv4(),
    sentAt: new Date().toISOString(),
  };
}

// --- Reallocation Service ---

const STEP_ORDER: ReallocationStep['step'][] = [
  'order_creation',
  'label_generation',
  'buyer_notification',
  'original_customer_notification',
];

function createInitialSteps(): ReallocationStep[] {
  return STEP_ORDER.map((step) => ({
    step,
    status: 'pending' as const,
  }));
}

function updateStep(
  steps: ReallocationStep[],
  stepName: ReallocationStep['step'],
  status: ReallocationStep['status'],
  error?: string
): ReallocationStep[] {
  return steps.map((s) => {
    if (s.step === stepName) {
      return {
        ...s,
        status,
        completedAt: status === 'completed' ? new Date().toISOString() : s.completedAt,
        error: error || s.error,
      };
    }
    return s;
  });
}

export async function execute(
  rtoEventId: string,
  buyerId: string,
  packageDetails: PackageDetails
): Promise<ReallocationExecution> {
  let steps = createInitialSteps();
  let newOrderId = '';
  let reallocationEventId = '';

  // Fetch the RTO event to get original order info
  const rtoEvent = await RTOEvent.findById(rtoEventId);
  if (!rtoEvent) {
    throw new Error(`RTO Event not found: ${rtoEventId}`);
  }

  const originalOrderId = rtoEvent.orderId.toString();

  // Fetch buyer info for label generation and notifications
  const buyer = await Customer.findById(buyerId);
  if (!buyer) {
    throw new Error(`Buyer not found: ${buyerId}`);
  }

  // Create the ReallocationEvent record in DB
  const reallocationEvent = await ReallocationEvent.create({
    rtoEventId: new mongoose.Types.ObjectId(rtoEventId),
    originalOrderId: new mongoose.Types.ObjectId(originalOrderId),
    buyerId: new mongoose.Types.ObjectId(buyerId),
    status: 'in_progress',
    steps: steps.map((s) => ({ step: s.step, status: s.status })),
  });
  reallocationEventId = reallocationEvent._id.toString();

  // --- Step 1: Order Creation (within 30 seconds) ---
  try {
    const originalOrder = await Order.findById(originalOrderId);
    if (!originalOrder) {
      throw new Error(`Original order not found: ${originalOrderId}`);
    }

    const newOrder = await Order.create({
      customerId: new mongoose.Types.ObjectId(buyerId),
      sku: packageDetails.sku,
      productCategory: packageDetails.category,
      price: packageDetails.price,
      priceTier: originalOrder.priceTier,
      hsnCode: packageDetails.hsnCode,
      status: 'reallocated_pending',
      originalOrderId: new mongoose.Types.ObjectId(originalOrderId),
      reallocationEventId: new mongoose.Types.ObjectId(reallocationEventId),
      placedAt: new Date(),
    });

    newOrderId = newOrder._id.toString();
    steps = updateStep(steps, 'order_creation', 'completed');

    // Update the reallocation event with the new order ID
    await ReallocationEvent.findByIdAndUpdate(reallocationEventId, {
      newOrderId: new mongoose.Types.ObjectId(newOrderId),
      steps: steps.map((s) => ({ step: s.step, status: s.status, completedAt: s.completedAt })),
    });
  } catch (error: any) {
    steps = updateStep(steps, 'order_creation', 'failed', error.message);
    await finalizeExecution(reallocationEventId, steps, 'failed');
    return buildExecution(reallocationEventId, rtoEventId, originalOrderId, newOrderId, buyerId, steps, 'failed');
  }

  // --- Step 2: Label Generation ---
  try {
    const label = await generateShippingLabel(buyer.address, packageDetails);
    steps = updateStep(steps, 'label_generation', 'completed');

    await ReallocationEvent.findByIdAndUpdate(reallocationEventId, {
      steps: steps.map((s) => ({ step: s.step, status: s.status, completedAt: s.completedAt })),
    });
  } catch (error: any) {
    steps = updateStep(steps, 'label_generation', 'failed', error.message);
    await finalizeExecution(reallocationEventId, steps, 'failed');
    return buildExecution(reallocationEventId, rtoEventId, originalOrderId, newOrderId, buyerId, steps, 'failed');
  }

  // --- Step 3: Buyer Notification (within 60 seconds of label) ---
  try {
    const estimatedDelivery = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(); // 48 hours from now
    await sendBuyerNotification(buyerId, newOrderId, estimatedDelivery);
    steps = updateStep(steps, 'buyer_notification', 'completed');

    await ReallocationEvent.findByIdAndUpdate(reallocationEventId, {
      steps: steps.map((s) => ({ step: s.step, status: s.status, completedAt: s.completedAt })),
    });
  } catch (error: any) {
    steps = updateStep(steps, 'buyer_notification', 'failed', error.message);
    await finalizeExecution(reallocationEventId, steps, 'failed');
    return buildExecution(reallocationEventId, rtoEventId, originalOrderId, newOrderId, buyerId, steps, 'failed');
  }

  // --- Step 4: Original Customer Notification ---
  try {
    await sendOriginalCustomerNotification(
      rtoEvent.customerId.toString(),
      originalOrderId,
      'Your package has been reallocated to another buyer due to delivery issues.'
    );

    // Update original order status to "reallocated"
    await Order.findByIdAndUpdate(originalOrderId, { status: 'reallocated' });

    steps = updateStep(steps, 'original_customer_notification', 'completed');
    await finalizeExecution(reallocationEventId, steps, 'completed');
  } catch (error: any) {
    steps = updateStep(steps, 'original_customer_notification', 'failed', error.message);
    await finalizeExecution(reallocationEventId, steps, 'failed');
    return buildExecution(reallocationEventId, rtoEventId, originalOrderId, newOrderId, buyerId, steps, 'failed');
  }

  return buildExecution(reallocationEventId, rtoEventId, originalOrderId, newOrderId, buyerId, steps, 'completed');
}

// --- Helpers ---

async function finalizeExecution(
  reallocationEventId: string,
  steps: ReallocationStep[],
  status: 'completed' | 'failed' | 'rolled_back'
): Promise<void> {
  const update: any = {
    status,
    steps: steps.map((s) => ({
      step: s.step,
      status: s.status,
      completedAt: s.completedAt ? new Date(s.completedAt) : undefined,
      error: s.error,
    })),
  };
  if (status === 'completed') {
    update.completedAt = new Date();
  }
  await ReallocationEvent.findByIdAndUpdate(reallocationEventId, update);
}

function buildExecution(
  reallocationEventId: string,
  rtoEventId: string,
  originalOrderId: string,
  newOrderId: string,
  buyerId: string,
  steps: ReallocationStep[],
  status: ReallocationExecution['status']
): ReallocationExecution {
  return {
    reallocationEventId,
    rtoEventId,
    originalOrderId,
    newOrderId,
    buyerId,
    steps,
    status,
  };
}

// --- Rollback Logic (Requirement 8.6) ---

/**
 * Rolls back completed steps in reverse order on failure.
 * - order_creation: deletes the new order record
 * - label_generation: marks label as voided (no persistent record to delete in MVP)
 * - buyer_notification: marks notification as cancelled (best-effort, can't unsend)
 * - original_customer_notification: marks notification as cancelled
 *
 * After rollback, marks the ReallocationEvent as 'rolled_back'.
 */
export async function rollback(execution: ReallocationExecution): Promise<void> {
  const completedSteps = execution.steps
    .filter((s) => s.status === 'completed')
    .map((s) => s.step);

  // Roll back in reverse order of completion
  const reversedSteps = [...completedSteps].reverse();

  for (const stepName of reversedSteps) {
    try {
      switch (stepName) {
        case 'order_creation':
          // Delete the newly created order
          if (execution.newOrderId) {
            await Order.findByIdAndDelete(execution.newOrderId);
          }
          break;
        case 'label_generation':
          // In production: call logistics API to void the label
          // MVP: no-op, label isn't persisted externally
          break;
        case 'buyer_notification':
          // In production: send cancellation notification
          // MVP: best-effort, notifications can't be "unsent"
          break;
        case 'original_customer_notification':
          // In production: send correction notification
          // MVP: revert original order status if it was changed
          if (execution.originalOrderId) {
            await Order.findByIdAndUpdate(execution.originalOrderId, { status: 'rto_in_progress' });
          }
          break;
      }
    } catch (rollbackError: any) {
      // Log but continue rolling back other steps
      // In production this would be logged to an observability service
      console.error(`Rollback failed for step ${stepName}:`, rollbackError.message);
    }
  }

  // Mark all completed steps as rolled_back
  const rolledBackSteps: ReallocationStep[] = execution.steps.map((s) => {
    if (s.status === 'completed') {
      return { ...s, status: 'rolled_back' as const };
    }
    return s;
  });

  // Update the ReallocationEvent in DB
  await finalizeExecution(execution.reallocationEventId, rolledBackSteps, 'rolled_back');
}

// --- Attempt Next Buyer Logic (Requirement 8.6) ---

/**
 * Attempts reallocation with the next-ranked buyer after a failure.
 * Iterates through remaining buyers starting from failedBuyerIndex + 1.
 * If all buyers are exhausted, returns null (caller should route to warehouse return).
 */
export async function attemptNextBuyer(
  rtoEventId: string,
  rankedBuyers: ScoredCandidate[],
  failedBuyerIndex: number,
  packageDetails: PackageDetails
): Promise<ReallocationExecution | null> {
  // Try each subsequent buyer in ranking order
  for (let i = failedBuyerIndex + 1; i < rankedBuyers.length; i++) {
    const nextBuyer = rankedBuyers[i];

    try {
      const result = await execute(rtoEventId, nextBuyer.buyerId, packageDetails);

      if (result.status === 'completed') {
        return result;
      }

      // If this buyer's execution failed, roll back and try the next one
      await rollback(result);
    } catch (error: any) {
      // Buyer execution threw an error (e.g. buyer not found), skip to next
      continue;
    }
  }

  // All buyers exhausted — return null to signal warehouse return
  return null;
}

// --- Failed Redelivery Handling (Requirement 8.5) ---

export interface DeliveryAttemptRecord {
  attemptNumber: number;
  successful: boolean;
  explicitRefusal: boolean;
  timestamp: string;
}

/**
 * Determines if a failed redelivery should be routed to warehouse return.
 * Routes to warehouse return if:
 * - 2 consecutive unsuccessful delivery attempts, OR
 * - Explicit buyer refusal at any point
 *
 * Returns true if the package should go to warehouse return, false otherwise.
 */
export function shouldRouteToWarehouse(deliveryAttempts: DeliveryAttemptRecord[]): boolean {
  if (deliveryAttempts.length === 0) {
    return false;
  }

  // Check for explicit refusal at any point
  const hasExplicitRefusal = deliveryAttempts.some((a) => a.explicitRefusal);
  if (hasExplicitRefusal) {
    return true;
  }

  // Check for 2 consecutive failures
  if (deliveryAttempts.length >= 2) {
    const lastTwo = deliveryAttempts.slice(-2);
    if (lastTwo.every((a) => !a.successful)) {
      return true;
    }
  }

  return false;
}

/**
 * Handles a failed redelivery attempt for a reallocated package.
 * If 2 consecutive failures or explicit refusal → warehouse return.
 * Otherwise, allows another delivery attempt.
 *
 * Returns the action to take: 'warehouse_return' or 'retry_delivery'.
 */
export function handleFailedRedelivery(
  deliveryAttempts: DeliveryAttemptRecord[]
): 'warehouse_return' | 'retry_delivery' {
  if (shouldRouteToWarehouse(deliveryAttempts)) {
    return 'warehouse_return';
  }
  return 'retry_delivery';
}

export const reallocationService = {
  execute,
  rollback,
  attemptNextBuyer,
  shouldRouteToWarehouse,
  handleFailedRedelivery,
};

export default reallocationService;
