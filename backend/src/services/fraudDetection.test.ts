/**
 * Tests for Fraud Detection Service
 *
 * Validates Requirements 12.6 and 12.7:
 *  - 12.6: Flag entity when RTO count exceeds threshold in time window
 *  - 12.7: Suspend reallocation eligibility for flagged entities
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  checkFraudThreshold,
  flagEntityForFraud,
  isEntityFlagged,
  generateComplianceAlert,
  runFraudDetection,
  getComplianceAlerts,
  clearComplianceAlerts,
  EntityType,
} from './fraudDetection';

// Mock the models
vi.mock('../models/RTOEvent', () => ({
  RTOEvent: {
    countDocuments: vi.fn(),
  },
}));

vi.mock('../models/Customer', () => ({
  Customer: {
    findById: vi.fn(),
    updateOne: vi.fn(),
  },
}));

vi.mock('../models/Courier', () => ({
  Courier: {
    findById: vi.fn(),
    updateOne: vi.fn(),
  },
}));

// Import mocked models
import { RTOEvent } from '../models/RTOEvent';
import { Customer } from '../models/Customer';
import { Courier } from '../models/Courier';

const mockedRTOEvent = vi.mocked(RTOEvent);
const mockedCustomer = vi.mocked(Customer);
const mockedCourier = vi.mocked(Courier);

describe('Fraud Detection Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearComplianceAlerts();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('checkFraudThreshold', () => {
    it('should return exceedsThreshold=true when count >= threshold for customer', async () => {
      mockedRTOEvent.countDocuments.mockResolvedValue(5);

      const result = await checkFraudThreshold('customer-123', 'customer', 30, 5);

      expect(result.entityId).toBe('customer-123');
      expect(result.entityType).toBe('customer');
      expect(result.rtoCount).toBe(5);
      expect(result.threshold).toBe(5);
      expect(result.windowDays).toBe(30);
      expect(result.exceedsThreshold).toBe(true);
    });

    it('should return exceedsThreshold=false when count < threshold', async () => {
      mockedRTOEvent.countDocuments.mockResolvedValue(3);

      const result = await checkFraudThreshold('customer-456', 'customer', 30, 5);

      expect(result.rtoCount).toBe(3);
      expect(result.exceedsThreshold).toBe(false);
    });

    it('should query with customerId for customer entity type', async () => {
      mockedRTOEvent.countDocuments.mockResolvedValue(0);

      await checkFraudThreshold('cust-id', 'customer', 30, 5);

      expect(mockedRTOEvent.countDocuments).toHaveBeenCalledWith(
        expect.objectContaining({
          customerId: 'cust-id',
          receivedAt: expect.any(Object),
        })
      );
    });

    it('should query with courierId for courier entity type', async () => {
      mockedRTOEvent.countDocuments.mockResolvedValue(0);

      await checkFraudThreshold('courier-id', 'courier', 30, 5);

      expect(mockedRTOEvent.countDocuments).toHaveBeenCalledWith(
        expect.objectContaining({
          courierId: 'courier-id',
          receivedAt: expect.any(Object),
        })
      );
    });

    it('should use correct time window for filtering', async () => {
      mockedRTOEvent.countDocuments.mockResolvedValue(2);

      const beforeCall = new Date();
      await checkFraudThreshold('entity-1', 'customer', 15, 5);

      const callArgs = mockedRTOEvent.countDocuments.mock.calls[0][0] as any;
      const windowStart = callArgs.receivedAt.$gte as Date;

      // The window start should be roughly 15 days ago
      const expectedStart = new Date(beforeCall);
      expectedStart.setDate(expectedStart.getDate() - 15);

      // Allow 1 second tolerance
      expect(Math.abs(windowStart.getTime() - expectedStart.getTime())).toBeLessThan(1000);
    });

    it('should return exceedsThreshold=true when count exceeds threshold (greater than)', async () => {
      mockedRTOEvent.countDocuments.mockResolvedValue(8);

      const result = await checkFraudThreshold('customer-789', 'customer', 30, 5);

      expect(result.rtoCount).toBe(8);
      expect(result.exceedsThreshold).toBe(true);
    });
  });

  describe('flagEntityForFraud', () => {
    it('should update customer fraudFlag when entityType is customer', async () => {
      mockedCustomer.updateOne.mockResolvedValue({ acknowledged: true, modifiedCount: 1, matchedCount: 1, upsertedCount: 0, upsertedId: null });

      const result = await flagEntityForFraud('cust-1', 'customer', 'Excessive RTO events');

      expect(mockedCustomer.updateOne).toHaveBeenCalledWith(
        { _id: 'cust-1' },
        {
          $set: {
            'fraudFlag.flagged': true,
            'fraudFlag.flaggedAt': expect.any(Date),
            'fraudFlag.reason': 'Excessive RTO events',
          },
        }
      );
      expect(result.entityId).toBe('cust-1');
      expect(result.entityType).toBe('customer');
      expect(result.flagged).toBe(true);
      expect(result.reason).toBe('Excessive RTO events');
      expect(result.flaggedAt).toBeInstanceOf(Date);
    });

    it('should update courier fraudFlag when entityType is courier', async () => {
      mockedCourier.updateOne.mockResolvedValue({ acknowledged: true, modifiedCount: 1, matchedCount: 1, upsertedCount: 0, upsertedId: null });

      const result = await flagEntityForFraud('courier-1', 'courier', 'Suspicious pattern');

      expect(mockedCourier.updateOne).toHaveBeenCalledWith(
        { _id: 'courier-1' },
        {
          $set: {
            'fraudFlag.flagged': true,
            'fraudFlag.flaggedAt': expect.any(Date),
            'fraudFlag.reason': 'Suspicious pattern',
          },
        }
      );
      expect(result.entityId).toBe('courier-1');
      expect(result.entityType).toBe('courier');
      expect(result.flagged).toBe(true);
    });
  });

  describe('isEntityFlagged', () => {
    it('should return true when customer is flagged', async () => {
      mockedCustomer.findById.mockReturnValue({
        select: vi.fn().mockReturnValue({
          lean: vi.fn().mockResolvedValue({ fraudFlag: { flagged: true } }),
        }),
      } as any);

      const result = await isEntityFlagged('cust-1', 'customer');
      expect(result).toBe(true);
    });

    it('should return false when customer is not flagged', async () => {
      mockedCustomer.findById.mockReturnValue({
        select: vi.fn().mockReturnValue({
          lean: vi.fn().mockResolvedValue({ fraudFlag: { flagged: false } }),
        }),
      } as any);

      const result = await isEntityFlagged('cust-2', 'customer');
      expect(result).toBe(false);
    });

    it('should return false when customer has no fraudFlag', async () => {
      mockedCustomer.findById.mockReturnValue({
        select: vi.fn().mockReturnValue({
          lean: vi.fn().mockResolvedValue({ fraudFlag: undefined }),
        }),
      } as any);

      const result = await isEntityFlagged('cust-3', 'customer');
      expect(result).toBe(false);
    });

    it('should return false when customer is not found', async () => {
      mockedCustomer.findById.mockReturnValue({
        select: vi.fn().mockReturnValue({
          lean: vi.fn().mockResolvedValue(null),
        }),
      } as any);

      const result = await isEntityFlagged('nonexistent', 'customer');
      expect(result).toBe(false);
    });

    it('should return true when courier is flagged', async () => {
      mockedCourier.findById.mockReturnValue({
        select: vi.fn().mockReturnValue({
          lean: vi.fn().mockResolvedValue({ fraudFlag: { flagged: true } }),
        }),
      } as any);

      const result = await isEntityFlagged('courier-1', 'courier');
      expect(result).toBe(true);
    });

    it('should return false when courier is not flagged', async () => {
      mockedCourier.findById.mockReturnValue({
        select: vi.fn().mockReturnValue({
          lean: vi.fn().mockResolvedValue({ fraudFlag: { flagged: false } }),
        }),
      } as any);

      const result = await isEntityFlagged('courier-2', 'courier');
      expect(result).toBe(false);
    });
  });

  describe('generateComplianceAlert', () => {
    it('should create alert with correct fields', () => {
      const alert = generateComplianceAlert('entity-1', 'customer', 7);

      expect(alert.alertId).toMatch(/^FRAUD-CUSTOMER-entity-1-\d+$/);
      expect(alert.entityId).toBe('entity-1');
      expect(alert.entityType).toBe('customer');
      expect(alert.rtoCount).toBe(7);
      expect(alert.threshold).toBe(5); // default from config
      expect(alert.windowDays).toBe(30); // default from config
      expect(alert.reason).toContain('entity-1');
      expect(alert.reason).toContain('7 RTO events');
      expect(alert.generatedAt).toBeInstanceOf(Date);
    });

    it('should store alert in alerts list', () => {
      expect(getComplianceAlerts()).toHaveLength(0);

      generateComplianceAlert('entity-1', 'customer', 5);
      generateComplianceAlert('entity-2', 'courier', 6);

      const alerts = getComplianceAlerts();
      expect(alerts).toHaveLength(2);
      expect(alerts[0].entityType).toBe('customer');
      expect(alerts[1].entityType).toBe('courier');
    });

    it('should generate unique alertIds', () => {
      const alert1 = generateComplianceAlert('e1', 'customer', 5);
      const alert2 = generateComplianceAlert('e2', 'courier', 6);

      expect(alert1.alertId).not.toBe(alert2.alertId);
    });

    it('should use COURIER prefix for courier alerts', () => {
      const alert = generateComplianceAlert('c-1', 'courier', 10);
      expect(alert.alertId).toMatch(/^FRAUD-COURIER-c-1-\d+$/);
    });
  });

  describe('runFraudDetection', () => {
    it('should flag entity and generate alert when threshold exceeded and not already flagged', async () => {
      // Count exceeds threshold
      mockedRTOEvent.countDocuments.mockResolvedValue(6);
      // Not already flagged
      mockedCustomer.findById.mockReturnValue({
        select: vi.fn().mockReturnValue({
          lean: vi.fn().mockResolvedValue({ fraudFlag: { flagged: false } }),
        }),
      } as any);
      // Flag update succeeds
      mockedCustomer.updateOne.mockResolvedValue({ acknowledged: true, modifiedCount: 1, matchedCount: 1, upsertedCount: 0, upsertedId: null });

      const result = await runFraudDetection('cust-1', 'customer');

      expect(result.suspendReallocation).toBe(true);
      expect(result.fraudCheckResult.exceedsThreshold).toBe(true);
      expect(result.alert).toBeDefined();
      expect(result.alert!.entityId).toBe('cust-1');
      expect(result.flagResult).toBeDefined();
      expect(result.flagResult!.flagged).toBe(true);
    });

    it('should suspend reallocation without re-flagging when already flagged and threshold exceeded', async () => {
      mockedRTOEvent.countDocuments.mockResolvedValue(7);
      // Already flagged
      mockedCustomer.findById.mockReturnValue({
        select: vi.fn().mockReturnValue({
          lean: vi.fn().mockResolvedValue({ fraudFlag: { flagged: true } }),
        }),
      } as any);

      const result = await runFraudDetection('cust-2', 'customer');

      expect(result.suspendReallocation).toBe(true);
      expect(result.alert).toBeUndefined();
      expect(result.flagResult).toBeUndefined();
      // Should not attempt to re-flag
      expect(mockedCustomer.updateOne).not.toHaveBeenCalled();
    });

    it('should not suspend reallocation when threshold not exceeded and not flagged', async () => {
      mockedRTOEvent.countDocuments.mockResolvedValue(2);
      // Not flagged
      mockedCustomer.findById.mockReturnValue({
        select: vi.fn().mockReturnValue({
          lean: vi.fn().mockResolvedValue({ fraudFlag: { flagged: false } }),
        }),
      } as any);

      const result = await runFraudDetection('cust-3', 'customer');

      expect(result.suspendReallocation).toBe(false);
      expect(result.fraudCheckResult.exceedsThreshold).toBe(false);
      expect(result.alert).toBeUndefined();
      expect(result.flagResult).toBeUndefined();
    });

    it('should suspend reallocation when threshold not exceeded but entity already flagged', async () => {
      mockedRTOEvent.countDocuments.mockResolvedValue(3);
      // Already flagged from previous detection
      mockedCustomer.findById.mockReturnValue({
        select: vi.fn().mockReturnValue({
          lean: vi.fn().mockResolvedValue({ fraudFlag: { flagged: true } }),
        }),
      } as any);

      const result = await runFraudDetection('cust-4', 'customer');

      expect(result.suspendReallocation).toBe(true);
      expect(result.fraudCheckResult.exceedsThreshold).toBe(false);
      expect(result.alert).toBeUndefined();
    });

    it('should work correctly for courier entity type', async () => {
      mockedRTOEvent.countDocuments.mockResolvedValue(5);
      mockedCourier.findById.mockReturnValue({
        select: vi.fn().mockReturnValue({
          lean: vi.fn().mockResolvedValue({ fraudFlag: { flagged: false } }),
        }),
      } as any);
      mockedCourier.updateOne.mockResolvedValue({ acknowledged: true, modifiedCount: 1, matchedCount: 1, upsertedCount: 0, upsertedId: null });

      const result = await runFraudDetection('courier-1', 'courier');

      expect(result.suspendReallocation).toBe(true);
      expect(result.fraudCheckResult.entityType).toBe('courier');
      expect(result.alert).toBeDefined();
      expect(result.alert!.entityType).toBe('courier');
      expect(result.flagResult).toBeDefined();
    });
  });

  describe('clearComplianceAlerts', () => {
    it('should clear all stored alerts', () => {
      generateComplianceAlert('e1', 'customer', 5);
      generateComplianceAlert('e2', 'courier', 6);
      expect(getComplianceAlerts()).toHaveLength(2);

      clearComplianceAlerts();
      expect(getComplianceAlerts()).toHaveLength(0);
    });
  });
});
