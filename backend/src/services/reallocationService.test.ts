import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import mongoose from 'mongoose';
import {
  execute,
  rollback,
  attemptNextBuyer,
  shouldRouteToWarehouse,
  handleFailedRedelivery,
  ReallocationExecution,
  ReallocationStep,
  DeliveryAttemptRecord,
  generateShippingLabel,
  sendBuyerNotification,
  sendOriginalCustomerNotification,
  PackageDetails,
} from './reallocationService';

// --- Mock Mongoose models ---
vi.mock('../models/RTOEvent', () => {
  const findById = vi.fn();
  return {
    RTOEvent: { findById },
  };
});

vi.mock('../models/Order', () => {
  const findById = vi.fn();
  const findByIdAndUpdate = vi.fn();
  const findByIdAndDelete = vi.fn();
  const create = vi.fn();
  return {
    Order: { findById, findByIdAndUpdate, findByIdAndDelete, create },
  };
});

vi.mock('../models/ReallocationEvent', () => {
  const create = vi.fn();
  const findByIdAndUpdate = vi.fn();
  return {
    ReallocationEvent: { create, findByIdAndUpdate },
  };
});

vi.mock('../models/Customer', () => {
  const findById = vi.fn();
  return {
    Customer: { findById },
  };
});

// Import mocked modules
import { RTOEvent } from '../models/RTOEvent';
import { Order } from '../models/Order';
import { ReallocationEvent } from '../models/ReallocationEvent';
import { Customer } from '../models/Customer';

// --- Test fixtures ---
const mockRtoEventId = new mongoose.Types.ObjectId().toString();
const mockBuyerId = new mongoose.Types.ObjectId().toString();
const mockOriginalOrderId = new mongoose.Types.ObjectId().toString();
const mockNewOrderId = new mongoose.Types.ObjectId().toString();
const mockReallocationEventId = new mongoose.Types.ObjectId().toString();
const mockCustomerId = new mongoose.Types.ObjectId().toString();

const mockPackageDetails: PackageDetails = {
  sku: 'SKU-001',
  weight: 1.5,
  dimensions: { l: 20, w: 15, h: 10 },
  category: 'electronics',
  price: 999,
  hsnCode: '8471',
};

const mockRtoEvent = {
  _id: mockRtoEventId,
  orderId: new mongoose.Types.ObjectId(mockOriginalOrderId),
  customerId: new mongoose.Types.ObjectId(mockCustomerId),
  packageDetails: mockPackageDetails,
};

const mockBuyer = {
  _id: mockBuyerId,
  name: 'Test Buyer',
  email: 'buyer@test.com',
  phone: '9876543210',
  address: {
    line1: '123 Main St',
    line2: 'Apt 4',
    city: 'Mumbai',
    state: 'Maharashtra',
    pincode: '400001',
    geoLocation: { type: 'Point' as const, coordinates: [72.8777, 19.076] as [number, number] },
  },
};

const mockOriginalOrder = {
  _id: mockOriginalOrderId,
  customerId: mockCustomerId,
  sku: 'SKU-001',
  productCategory: 'electronics',
  price: 999,
  priceTier: 'high',
  hsnCode: '8471',
  status: 'placed',
};

const mockNewOrder = {
  _id: new mongoose.Types.ObjectId(mockNewOrderId),
  customerId: mockBuyerId,
  sku: 'SKU-001',
  productCategory: 'electronics',
  price: 999,
  priceTier: 'high',
  hsnCode: '8471',
  status: 'reallocated_pending',
  originalOrderId: mockOriginalOrderId,
  reallocationEventId: mockReallocationEventId,
};

const mockReallocationEvent = {
  _id: new mongoose.Types.ObjectId(mockReallocationEventId),
  toString: () => mockReallocationEventId,
};

function setupSuccessfulMocks() {
  (RTOEvent.findById as ReturnType<typeof vi.fn>).mockResolvedValue(mockRtoEvent);
  (Customer.findById as ReturnType<typeof vi.fn>).mockResolvedValue(mockBuyer);
  (ReallocationEvent.create as ReturnType<typeof vi.fn>).mockResolvedValue(mockReallocationEvent);
  (ReallocationEvent.findByIdAndUpdate as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  (Order.findById as ReturnType<typeof vi.fn>).mockResolvedValue(mockOriginalOrder);
  (Order.create as ReturnType<typeof vi.fn>).mockResolvedValue(mockNewOrder);
  (Order.findByIdAndUpdate as ReturnType<typeof vi.fn>).mockResolvedValue(null);
}

describe('reallocationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('execute()', () => {
    it('should execute all four steps successfully in sequence', async () => {
      setupSuccessfulMocks();

      const result = await execute(mockRtoEventId, mockBuyerId, mockPackageDetails);

      expect(result.status).toBe('completed');
      expect(result.rtoEventId).toBe(mockRtoEventId);
      expect(result.originalOrderId).toBe(mockOriginalOrderId);
      expect(result.buyerId).toBe(mockBuyerId);
      expect(result.reallocationEventId).toBe(mockReallocationEventId);
      expect(result.newOrderId).toBe(mockNewOrderId);

      // All steps should be completed
      expect(result.steps).toHaveLength(4);
      expect(result.steps[0]).toMatchObject({ step: 'order_creation', status: 'completed' });
      expect(result.steps[1]).toMatchObject({ step: 'label_generation', status: 'completed' });
      expect(result.steps[2]).toMatchObject({ step: 'buyer_notification', status: 'completed' });
      expect(result.steps[3]).toMatchObject({ step: 'original_customer_notification', status: 'completed' });
    });

    it('should follow the correct step sequence: order → label → buyer notification → customer notification', async () => {
      setupSuccessfulMocks();

      const result = await execute(mockRtoEventId, mockBuyerId, mockPackageDetails);

      const stepOrder = result.steps.map((s) => s.step);
      expect(stepOrder).toEqual([
        'order_creation',
        'label_generation',
        'buyer_notification',
        'original_customer_notification',
      ]);
    });

    it('should create new order linked to selected buyer with original order ID and reallocation event ID', async () => {
      setupSuccessfulMocks();

      await execute(mockRtoEventId, mockBuyerId, mockPackageDetails);

      expect(Order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          customerId: expect.any(mongoose.Types.ObjectId),
          sku: mockPackageDetails.sku,
          productCategory: mockPackageDetails.category,
          price: mockPackageDetails.price,
          hsnCode: mockPackageDetails.hsnCode,
          status: 'reallocated_pending',
          originalOrderId: expect.any(mongoose.Types.ObjectId),
          reallocationEventId: expect.any(mongoose.Types.ObjectId),
        })
      );
    });

    it('should update original order status to "reallocated"', async () => {
      setupSuccessfulMocks();

      await execute(mockRtoEventId, mockBuyerId, mockPackageDetails);

      expect(Order.findByIdAndUpdate).toHaveBeenCalledWith(mockOriginalOrderId, { status: 'reallocated' });
    });

    it('should throw error when RTO event is not found', async () => {
      (RTOEvent.findById as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(execute(mockRtoEventId, mockBuyerId, mockPackageDetails)).rejects.toThrow(
        `RTO Event not found: ${mockRtoEventId}`
      );
    });

    it('should throw error when buyer is not found', async () => {
      (RTOEvent.findById as ReturnType<typeof vi.fn>).mockResolvedValue(mockRtoEvent);
      (Customer.findById as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(execute(mockRtoEventId, mockBuyerId, mockPackageDetails)).rejects.toThrow(
        `Buyer not found: ${mockBuyerId}`
      );
    });

    it('should fail at order creation step and return failed status', async () => {
      (RTOEvent.findById as ReturnType<typeof vi.fn>).mockResolvedValue(mockRtoEvent);
      (Customer.findById as ReturnType<typeof vi.fn>).mockResolvedValue(mockBuyer);
      (ReallocationEvent.create as ReturnType<typeof vi.fn>).mockResolvedValue(mockReallocationEvent);
      (ReallocationEvent.findByIdAndUpdate as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (Order.findById as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('DB connection failed'));

      const result = await execute(mockRtoEventId, mockBuyerId, mockPackageDetails);

      expect(result.status).toBe('failed');
      expect(result.steps[0]).toMatchObject({
        step: 'order_creation',
        status: 'failed',
        error: 'DB connection failed',
      });
      // Subsequent steps should remain pending
      expect(result.steps[1].status).toBe('pending');
      expect(result.steps[2].status).toBe('pending');
      expect(result.steps[3].status).toBe('pending');
    });

    it('should fail at label generation step and return failed status', async () => {
      (RTOEvent.findById as ReturnType<typeof vi.fn>).mockResolvedValue(mockRtoEvent);
      (Customer.findById as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...mockBuyer,
        address: null, // This will cause label generation to fail
      });
      (ReallocationEvent.create as ReturnType<typeof vi.fn>).mockResolvedValue(mockReallocationEvent);
      (ReallocationEvent.findByIdAndUpdate as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (Order.findById as ReturnType<typeof vi.fn>).mockResolvedValue(mockOriginalOrder);
      (Order.create as ReturnType<typeof vi.fn>).mockResolvedValue(mockNewOrder);

      const result = await execute(mockRtoEventId, mockBuyerId, mockPackageDetails);

      expect(result.status).toBe('failed');
      expect(result.steps[0].status).toBe('completed');
      expect(result.steps[1]).toMatchObject({
        step: 'label_generation',
        status: 'failed',
      });
      expect(result.steps[2].status).toBe('pending');
      expect(result.steps[3].status).toBe('pending');
    });

    it('should set completedAt timestamps for completed steps', async () => {
      setupSuccessfulMocks();

      const result = await execute(mockRtoEventId, mockBuyerId, mockPackageDetails);

      for (const step of result.steps) {
        expect(step.status).toBe('completed');
        expect(step.completedAt).toBeDefined();
        // Validate ISO 8601 format
        expect(new Date(step.completedAt!).toISOString()).toBe(step.completedAt);
      }
    });

    it('should create ReallocationEvent record in database', async () => {
      setupSuccessfulMocks();

      await execute(mockRtoEventId, mockBuyerId, mockPackageDetails);

      expect(ReallocationEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          rtoEventId: expect.any(mongoose.Types.ObjectId),
          originalOrderId: expect.any(mongoose.Types.ObjectId),
          buyerId: expect.any(mongoose.Types.ObjectId),
          status: 'in_progress',
        })
      );
    });

    it('should update ReallocationEvent status to completed on success', async () => {
      setupSuccessfulMocks();

      await execute(mockRtoEventId, mockBuyerId, mockPackageDetails);

      // The last findByIdAndUpdate call should set status to 'completed'
      const calls = (ReallocationEvent.findByIdAndUpdate as ReturnType<typeof vi.fn>).mock.calls;
      const lastCall = calls[calls.length - 1];
      expect(lastCall[1]).toMatchObject({ status: 'completed' });
    });
  });

  describe('generateShippingLabel()', () => {
    it('should generate a shipping label with buyer address', async () => {
      const label = await generateShippingLabel(mockBuyer.address, mockPackageDetails);

      expect(label.labelId).toBeDefined();
      expect(label.trackingNumber).toMatch(/^TRK-/);
      expect(label.buyerAddress.line1).toBe('123 Main St');
      expect(label.buyerAddress.city).toBe('Mumbai');
      expect(label.buyerAddress.state).toBe('Maharashtra');
      expect(label.buyerAddress.pincode).toBe('400001');
      expect(label.generatedAt).toBeDefined();
    });
  });

  describe('sendBuyerNotification()', () => {
    it('should send notification and return confirmation', async () => {
      const result = await sendBuyerNotification(mockBuyerId, mockNewOrderId, '2024-01-15T10:00:00Z');

      expect(result.notificationId).toBeDefined();
      expect(result.sentAt).toBeDefined();
    });
  });

  describe('sendOriginalCustomerNotification()', () => {
    it('should send notification to original customer', async () => {
      const result = await sendOriginalCustomerNotification(
        mockCustomerId,
        mockOriginalOrderId,
        'Package reallocated'
      );

      expect(result.notificationId).toBeDefined();
      expect(result.sentAt).toBeDefined();
    });
  });

  describe('rollback()', () => {
    it('should roll back all completed steps in reverse order', async () => {
      (Order.findByIdAndDelete as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (Order.findByIdAndUpdate as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (ReallocationEvent.findByIdAndUpdate as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const execution: ReallocationExecution = {
        reallocationEventId: mockReallocationEventId,
        rtoEventId: mockRtoEventId,
        originalOrderId: mockOriginalOrderId,
        newOrderId: mockNewOrderId,
        buyerId: mockBuyerId,
        steps: [
          { step: 'order_creation', status: 'completed', completedAt: new Date().toISOString() },
          { step: 'label_generation', status: 'completed', completedAt: new Date().toISOString() },
          { step: 'buyer_notification', status: 'failed', error: 'Notification service down' },
          { step: 'original_customer_notification', status: 'pending' },
        ],
        status: 'failed',
      };

      await rollback(execution);

      // Order should be deleted (rolling back order_creation)
      expect(Order.findByIdAndDelete).toHaveBeenCalledWith(mockNewOrderId);

      // ReallocationEvent should be updated to 'rolled_back'
      const calls = (ReallocationEvent.findByIdAndUpdate as ReturnType<typeof vi.fn>).mock.calls;
      const lastCall = calls[calls.length - 1];
      expect(lastCall[1]).toMatchObject({ status: 'rolled_back' });
    });

    it('should mark completed steps as rolled_back in the DB update', async () => {
      (Order.findByIdAndDelete as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (Order.findByIdAndUpdate as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (ReallocationEvent.findByIdAndUpdate as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const execution: ReallocationExecution = {
        reallocationEventId: mockReallocationEventId,
        rtoEventId: mockRtoEventId,
        originalOrderId: mockOriginalOrderId,
        newOrderId: mockNewOrderId,
        buyerId: mockBuyerId,
        steps: [
          { step: 'order_creation', status: 'completed', completedAt: new Date().toISOString() },
          { step: 'label_generation', status: 'completed', completedAt: new Date().toISOString() },
          { step: 'buyer_notification', status: 'completed', completedAt: new Date().toISOString() },
          { step: 'original_customer_notification', status: 'failed', error: 'timeout' },
        ],
        status: 'failed',
      };

      await rollback(execution);

      // Verify the finalize call has rolled_back steps
      const calls = (ReallocationEvent.findByIdAndUpdate as ReturnType<typeof vi.fn>).mock.calls;
      const lastCall = calls[calls.length - 1];
      const updatedSteps = lastCall[1].steps;
      expect(updatedSteps[0].status).toBe('rolled_back');
      expect(updatedSteps[1].status).toBe('rolled_back');
      expect(updatedSteps[2].status).toBe('rolled_back');
      expect(updatedSteps[3].status).toBe('failed'); // failed step stays as-is
    });

    it('should revert original order status when original_customer_notification was completed', async () => {
      (Order.findByIdAndDelete as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (Order.findByIdAndUpdate as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (ReallocationEvent.findByIdAndUpdate as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const execution: ReallocationExecution = {
        reallocationEventId: mockReallocationEventId,
        rtoEventId: mockRtoEventId,
        originalOrderId: mockOriginalOrderId,
        newOrderId: mockNewOrderId,
        buyerId: mockBuyerId,
        steps: [
          { step: 'order_creation', status: 'completed', completedAt: new Date().toISOString() },
          { step: 'label_generation', status: 'completed', completedAt: new Date().toISOString() },
          { step: 'buyer_notification', status: 'completed', completedAt: new Date().toISOString() },
          { step: 'original_customer_notification', status: 'completed', completedAt: new Date().toISOString() },
        ],
        status: 'failed', // maybe failed at a post-completion check
      };

      await rollback(execution);

      // Should revert original order status
      expect(Order.findByIdAndUpdate).toHaveBeenCalledWith(mockOriginalOrderId, { status: 'rto_in_progress' });
    });

    it('should continue rolling back even if one rollback step fails', async () => {
      // Order deletion fails, but we should still roll back other steps
      (Order.findByIdAndDelete as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('DB error'));
      (Order.findByIdAndUpdate as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (ReallocationEvent.findByIdAndUpdate as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const execution: ReallocationExecution = {
        reallocationEventId: mockReallocationEventId,
        rtoEventId: mockRtoEventId,
        originalOrderId: mockOriginalOrderId,
        newOrderId: mockNewOrderId,
        buyerId: mockBuyerId,
        steps: [
          { step: 'order_creation', status: 'completed', completedAt: new Date().toISOString() },
          { step: 'label_generation', status: 'completed', completedAt: new Date().toISOString() },
          { step: 'buyer_notification', status: 'pending' },
          { step: 'original_customer_notification', status: 'pending' },
        ],
        status: 'failed',
      };

      // Should not throw even though order deletion fails
      await expect(rollback(execution)).resolves.toBeUndefined();

      // Should still finalize as rolled_back
      const calls = (ReallocationEvent.findByIdAndUpdate as ReturnType<typeof vi.fn>).mock.calls;
      const lastCall = calls[calls.length - 1];
      expect(lastCall[1]).toMatchObject({ status: 'rolled_back' });
    });

    it('should handle execution with no completed steps', async () => {
      (ReallocationEvent.findByIdAndUpdate as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const execution: ReallocationExecution = {
        reallocationEventId: mockReallocationEventId,
        rtoEventId: mockRtoEventId,
        originalOrderId: mockOriginalOrderId,
        newOrderId: '',
        buyerId: mockBuyerId,
        steps: [
          { step: 'order_creation', status: 'failed', error: 'Something broke' },
          { step: 'label_generation', status: 'pending' },
          { step: 'buyer_notification', status: 'pending' },
          { step: 'original_customer_notification', status: 'pending' },
        ],
        status: 'failed',
      };

      await rollback(execution);

      // No order deletion or status revert should happen
      expect(Order.findByIdAndDelete).not.toHaveBeenCalled();
      // But should still finalize as rolled_back
      expect(ReallocationEvent.findByIdAndUpdate).toHaveBeenCalled();
    });
  });

  describe('attemptNextBuyer()', () => {
    const mockRankedBuyers: Array<{ buyerId: string; compositeScore: number; distanceKm: number; factors: any; partiallyScored: boolean }> = [
      {
        buyerId: new mongoose.Types.ObjectId().toString(),
        compositeScore: 0.9,
        distanceKm: 5,
        factors: {
          distance: { value: 0.9, imputed: false },
          conversionProbability: { value: 0.8, imputed: false },
          deliverySpeed: { value: 0.7, imputed: false },
          marginImpact: { value: 0.6, imputed: false },
        },
        partiallyScored: false,
      },
      {
        buyerId: new mongoose.Types.ObjectId().toString(),
        compositeScore: 0.8,
        distanceKm: 10,
        factors: {
          distance: { value: 0.8, imputed: false },
          conversionProbability: { value: 0.7, imputed: false },
          deliverySpeed: { value: 0.6, imputed: false },
          marginImpact: { value: 0.5, imputed: false },
        },
        partiallyScored: false,
      },
      {
        buyerId: new mongoose.Types.ObjectId().toString(),
        compositeScore: 0.7,
        distanceKm: 15,
        factors: {
          distance: { value: 0.7, imputed: false },
          conversionProbability: { value: 0.6, imputed: false },
          deliverySpeed: { value: 0.5, imputed: false },
          marginImpact: { value: 0.4, imputed: false },
        },
        partiallyScored: false,
      },
    ];

    it('should try the next buyer after the failed one', async () => {
      // Second buyer (index 1) should succeed
      const secondBuyerId = mockRankedBuyers[1].buyerId;

      (RTOEvent.findById as ReturnType<typeof vi.fn>).mockResolvedValue(mockRtoEvent);
      (Customer.findById as ReturnType<typeof vi.fn>).mockResolvedValue(mockBuyer);
      (ReallocationEvent.create as ReturnType<typeof vi.fn>).mockResolvedValue(mockReallocationEvent);
      (ReallocationEvent.findByIdAndUpdate as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (Order.findById as ReturnType<typeof vi.fn>).mockResolvedValue(mockOriginalOrder);
      (Order.create as ReturnType<typeof vi.fn>).mockResolvedValue(mockNewOrder);
      (Order.findByIdAndUpdate as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await attemptNextBuyer(mockRtoEventId, mockRankedBuyers, 0, mockPackageDetails);

      expect(result).not.toBeNull();
      expect(result!.status).toBe('completed');
    });

    it('should return null when all buyers are exhausted', async () => {
      // All buyers fail because RTOEvent not found triggers a throw
      (RTOEvent.findById as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await attemptNextBuyer(mockRtoEventId, mockRankedBuyers, 0, mockPackageDetails);

      expect(result).toBeNull();
    });

    it('should return null when failedBuyerIndex is the last buyer', async () => {
      const result = await attemptNextBuyer(
        mockRtoEventId,
        mockRankedBuyers,
        mockRankedBuyers.length - 1,
        mockPackageDetails
      );

      expect(result).toBeNull();
    });

    it('should skip buyers that throw errors and try subsequent ones', async () => {
      // First attempt (index 1) fails with error, second attempt (index 2) succeeds
      let callCount = 0;
      (RTOEvent.findById as ReturnType<typeof vi.fn>).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(null); // First call will throw "RTO Event not found"
        }
        return Promise.resolve(mockRtoEvent);
      });
      (Customer.findById as ReturnType<typeof vi.fn>).mockResolvedValue(mockBuyer);
      (ReallocationEvent.create as ReturnType<typeof vi.fn>).mockResolvedValue(mockReallocationEvent);
      (ReallocationEvent.findByIdAndUpdate as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (Order.findById as ReturnType<typeof vi.fn>).mockResolvedValue(mockOriginalOrder);
      (Order.create as ReturnType<typeof vi.fn>).mockResolvedValue(mockNewOrder);
      (Order.findByIdAndUpdate as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await attemptNextBuyer(mockRtoEventId, mockRankedBuyers, 0, mockPackageDetails);

      expect(result).not.toBeNull();
      expect(result!.status).toBe('completed');
    });
  });

  describe('shouldRouteToWarehouse()', () => {
    it('should return true when there are 2 consecutive unsuccessful attempts', () => {
      const attempts: DeliveryAttemptRecord[] = [
        { attemptNumber: 1, successful: false, explicitRefusal: false, timestamp: '2024-01-01T10:00:00Z' },
        { attemptNumber: 2, successful: false, explicitRefusal: false, timestamp: '2024-01-02T10:00:00Z' },
      ];

      expect(shouldRouteToWarehouse(attempts)).toBe(true);
    });

    it('should return true on explicit buyer refusal', () => {
      const attempts: DeliveryAttemptRecord[] = [
        { attemptNumber: 1, successful: false, explicitRefusal: true, timestamp: '2024-01-01T10:00:00Z' },
      ];

      expect(shouldRouteToWarehouse(attempts)).toBe(true);
    });

    it('should return false for a single unsuccessful attempt without refusal', () => {
      const attempts: DeliveryAttemptRecord[] = [
        { attemptNumber: 1, successful: false, explicitRefusal: false, timestamp: '2024-01-01T10:00:00Z' },
      ];

      expect(shouldRouteToWarehouse(attempts)).toBe(false);
    });

    it('should return false when last two attempts are not consecutive failures', () => {
      const attempts: DeliveryAttemptRecord[] = [
        { attemptNumber: 1, successful: false, explicitRefusal: false, timestamp: '2024-01-01T10:00:00Z' },
        { attemptNumber: 2, successful: true, explicitRefusal: false, timestamp: '2024-01-02T10:00:00Z' },
        { attemptNumber: 3, successful: false, explicitRefusal: false, timestamp: '2024-01-03T10:00:00Z' },
      ];

      expect(shouldRouteToWarehouse(attempts)).toBe(false);
    });

    it('should return true for 2 consecutive failures even after earlier success', () => {
      const attempts: DeliveryAttemptRecord[] = [
        { attemptNumber: 1, successful: true, explicitRefusal: false, timestamp: '2024-01-01T10:00:00Z' },
        { attemptNumber: 2, successful: false, explicitRefusal: false, timestamp: '2024-01-02T10:00:00Z' },
        { attemptNumber: 3, successful: false, explicitRefusal: false, timestamp: '2024-01-03T10:00:00Z' },
      ];

      expect(shouldRouteToWarehouse(attempts)).toBe(true);
    });

    it('should return false for empty delivery attempts', () => {
      expect(shouldRouteToWarehouse([])).toBe(false);
    });
  });

  describe('handleFailedRedelivery()', () => {
    it('should return warehouse_return for 2 consecutive failures', () => {
      const attempts: DeliveryAttemptRecord[] = [
        { attemptNumber: 1, successful: false, explicitRefusal: false, timestamp: '2024-01-01T10:00:00Z' },
        { attemptNumber: 2, successful: false, explicitRefusal: false, timestamp: '2024-01-02T10:00:00Z' },
      ];

      expect(handleFailedRedelivery(attempts)).toBe('warehouse_return');
    });

    it('should return warehouse_return for explicit refusal', () => {
      const attempts: DeliveryAttemptRecord[] = [
        { attemptNumber: 1, successful: false, explicitRefusal: true, timestamp: '2024-01-01T10:00:00Z' },
      ];

      expect(handleFailedRedelivery(attempts)).toBe('warehouse_return');
    });

    it('should return retry_delivery for a single failure without refusal', () => {
      const attempts: DeliveryAttemptRecord[] = [
        { attemptNumber: 1, successful: false, explicitRefusal: false, timestamp: '2024-01-01T10:00:00Z' },
      ];

      expect(handleFailedRedelivery(attempts)).toBe('retry_delivery');
    });

    it('should return retry_delivery when last attempt succeeded', () => {
      const attempts: DeliveryAttemptRecord[] = [
        { attemptNumber: 1, successful: false, explicitRefusal: false, timestamp: '2024-01-01T10:00:00Z' },
        { attemptNumber: 2, successful: true, explicitRefusal: false, timestamp: '2024-01-02T10:00:00Z' },
      ];

      expect(handleFailedRedelivery(attempts)).toBe('retry_delivery');
    });
  });
});
