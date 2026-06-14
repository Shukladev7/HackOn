/**
 * Tests for Event Ingress Service.
 *
 * Covers:
 * - Schema validation (valid/invalid payloads)
 * - Deduplication using shipmentId + attemptNumber
 * - Event publishing to Redis Stream
 *
 * Validates: Requirements 10.1, 10.2, 11.1
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  validateRTOEventPayload,
  EventIngressService,
  RTOEventPayload,
} from './eventIngress';

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

function createValidPayload(): RTOEventPayload {
  return {
    shipmentId: 'SHP-001',
    orderId: 'ORD-001',
    customerId: 'CUST-001',
    courierId: 'CUR-001',
    packageDetails: {
      sku: 'SKU-12345',
      weight: 2.5,
      dimensions: { l: 30, w: 20, h: 15 },
      category: 'Electronics',
      price: 1500,
      hsnCode: '8471',
    },
    deliveryAttempt: {
      attemptNumber: 1,
      timestamp: '2024-01-15T10:30:00.000Z',
      gpsLocation: { lat: 28.6139, lng: 77.209 },
      statusCode: 'DELIVERY_FAILED',
      failureReason: 'Customer unavailable',
    },
    hubLocation: { lat: 28.5355, lng: 77.391, hubId: 'HUB-DEL-01' },
    metadata: { source: 'logistics-partner-a', receivedAt: '2024-01-15T10:31:00.000Z' },
  };
}

// Mock Redis Stream Producer
function createMockProducer() {
  return {
    publishEvent: vi.fn().mockResolvedValue('1234567890-0'),
    publishStreamMessage: vi.fn().mockResolvedValue('1234567890-0'),
    trimStream: vi.fn().mockResolvedValue(0),
    getClient: vi.fn(),
    disconnect: vi.fn().mockResolvedValue(undefined),
  };
}

// ---------------------------------------------------------------------------
// Schema Validation Tests
// ---------------------------------------------------------------------------

describe('validateRTOEventPayload', () => {
  it('accepts a valid payload', () => {
    const result = validateRTOEventPayload(createValidPayload());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects null payload', () => {
    const result = validateRTOEventPayload(null);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Payload must be a non-null object');
  });

  it('rejects non-object payload', () => {
    const result = validateRTOEventPayload('not an object');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Payload must be a non-null object');
  });

  it('rejects missing required string fields', () => {
    const payload = createValidPayload();
    (payload as any).shipmentId = '';
    (payload as any).orderId = undefined;
    const result = validateRTOEventPayload(payload);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('shipmentId is required and must be a non-empty string');
    expect(result.errors).toContain('orderId is required and must be a non-empty string');
  });

  it('rejects invalid packageDetails', () => {
    const payload = createValidPayload();
    (payload as any).packageDetails = null;
    const result = validateRTOEventPayload(payload);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('packageDetails is required and must be an object');
  });

  it('rejects negative weight', () => {
    const payload = createValidPayload();
    payload.packageDetails.weight = -1;
    const result = validateRTOEventPayload(payload);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('packageDetails.weight must be a positive number');
  });

  it('rejects zero-dimension values', () => {
    const payload = createValidPayload();
    payload.packageDetails.dimensions = { l: 0, w: 10, h: 5 };
    const result = validateRTOEventPayload(payload);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('packageDetails.dimensions.l must be a positive number');
  });

  it('rejects negative price', () => {
    const payload = createValidPayload();
    payload.packageDetails.price = -100;
    const result = validateRTOEventPayload(payload);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('packageDetails.price must be a positive number');
  });

  it('rejects invalid attemptNumber (zero)', () => {
    const payload = createValidPayload();
    payload.deliveryAttempt.attemptNumber = 0;
    const result = validateRTOEventPayload(payload);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('deliveryAttempt.attemptNumber must be a positive integer');
  });

  it('rejects non-integer attemptNumber', () => {
    const payload = createValidPayload();
    payload.deliveryAttempt.attemptNumber = 1.5;
    const result = validateRTOEventPayload(payload);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('deliveryAttempt.attemptNumber must be a positive integer');
  });

  it('rejects invalid ISO 8601 timestamp', () => {
    const payload = createValidPayload();
    payload.deliveryAttempt.timestamp = 'not-a-date';
    const result = validateRTOEventPayload(payload);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('deliveryAttempt.timestamp must be a valid ISO 8601 string');
  });

  it('rejects out-of-range latitude in gpsLocation', () => {
    const payload = createValidPayload();
    payload.deliveryAttempt.gpsLocation = { lat: 95, lng: 77 };
    const result = validateRTOEventPayload(payload);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('deliveryAttempt.gpsLocation.lat must be a number between -90 and 90');
  });

  it('rejects out-of-range longitude in gpsLocation', () => {
    const payload = createValidPayload();
    payload.deliveryAttempt.gpsLocation = { lat: 28, lng: 200 };
    const result = validateRTOEventPayload(payload);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('deliveryAttempt.gpsLocation.lng must be a number between -180 and 180');
  });

  it('rejects missing hubLocation', () => {
    const payload = createValidPayload();
    (payload as any).hubLocation = undefined;
    const result = validateRTOEventPayload(payload);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('hubLocation is required and must be an object');
  });

  it('rejects invalid hubLocation lat/lng', () => {
    const payload = createValidPayload();
    payload.hubLocation = { lat: -100, lng: 77, hubId: 'HUB-01' };
    const result = validateRTOEventPayload(payload);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('hubLocation.lat must be a number between -90 and 90');
  });

  it('rejects missing metadata', () => {
    const payload = createValidPayload();
    (payload as any).metadata = null;
    const result = validateRTOEventPayload(payload);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('metadata is required and must be an object');
  });

  it('rejects invalid metadata.receivedAt', () => {
    const payload = createValidPayload();
    payload.metadata.receivedAt = 'garbage';
    const result = validateRTOEventPayload(payload);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('metadata.receivedAt must be a valid ISO 8601 string');
  });

  it('collects multiple errors from a completely invalid payload', () => {
    const result = validateRTOEventPayload({});
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(3);
  });
});

// ---------------------------------------------------------------------------
// EventIngressService Tests
// ---------------------------------------------------------------------------

describe('EventIngressService', () => {
  let service: EventIngressService;
  let mockProducer: ReturnType<typeof createMockProducer>;

  beforeEach(() => {
    mockProducer = createMockProducer();
    service = new EventIngressService(mockProducer as any);
  });

  describe('receiveEvent', () => {
    it('accepts a valid event and returns eventId + accepted: true', async () => {
      const result = await service.receiveEvent(createValidPayload());
      expect(result.accepted).toBe(true);
      expect(result.eventId).toBeTruthy();
      expect(result.eventId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });

    it('rejects an invalid payload with errors', async () => {
      const result = await service.receiveEvent({ bad: 'data' });
      expect(result.accepted).toBe(false);
      expect(result.eventId).toBe('');
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
    });

    it('publishes valid event to the rto-events stream', async () => {
      await service.receiveEvent(createValidPayload());
      expect(mockProducer.publishEvent).toHaveBeenCalledTimes(1);
      expect(mockProducer.publishEvent).toHaveBeenCalledWith(
        'rto-events',
        expect.objectContaining({
          eventType: 'rto_event_received',
          shipmentId: 'SHP-001',
          orderId: 'ORD-001',
          actorModule: 'event_ingress',
          outcomeStatus: 'accepted',
        }),
      );
    });

    it('includes serialized payload in stream data', async () => {
      const payload = createValidPayload();
      await service.receiveEvent(payload);
      const publishCall = mockProducer.publishEvent.mock.calls[0];
      const streamData = publishCall[1] as Record<string, string>;
      expect(JSON.parse(streamData.payload as string)).toEqual(payload);
    });
  });

  describe('deduplication', () => {
    it('rejects duplicate events with same shipmentId + attemptNumber', async () => {
      const payload = createValidPayload();
      const first = await service.receiveEvent(payload);
      expect(first.accepted).toBe(true);

      const second = await service.receiveEvent(payload);
      expect(second.accepted).toBe(false);
      expect(second.errors).toContain(
        'Duplicate event: shipmentId + attemptNumber already processed',
      );
    });

    it('accepts same shipmentId with different attemptNumber', async () => {
      const payload1 = createValidPayload();
      payload1.deliveryAttempt.attemptNumber = 1;

      const payload2 = createValidPayload();
      payload2.deliveryAttempt.attemptNumber = 2;

      const first = await service.receiveEvent(payload1);
      const second = await service.receiveEvent(payload2);

      expect(first.accepted).toBe(true);
      expect(second.accepted).toBe(true);
    });

    it('accepts different shipmentId with same attemptNumber', async () => {
      const payload1 = createValidPayload();
      payload1.shipmentId = 'SHP-001';

      const payload2 = createValidPayload();
      payload2.shipmentId = 'SHP-002';

      const first = await service.receiveEvent(payload1);
      const second = await service.receiveEvent(payload2);

      expect(first.accepted).toBe(true);
      expect(second.accepted).toBe(true);
    });

    it('does not publish to stream for duplicate events', async () => {
      const payload = createValidPayload();
      await service.receiveEvent(payload);
      await service.receiveEvent(payload);

      expect(mockProducer.publishEvent).toHaveBeenCalledTimes(1);
    });

    it('tracks deduplication count correctly', async () => {
      expect(service.getDeduplicationCount()).toBe(0);

      await service.receiveEvent(createValidPayload());
      expect(service.getDeduplicationCount()).toBe(1);

      const p2 = createValidPayload();
      p2.shipmentId = 'SHP-002';
      await service.receiveEvent(p2);
      expect(service.getDeduplicationCount()).toBe(2);
    });

    it('clearDeduplication resets the tracking', async () => {
      await service.receiveEvent(createValidPayload());
      expect(service.getDeduplicationCount()).toBe(1);

      service.clearDeduplication();
      expect(service.getDeduplicationCount()).toBe(0);

      // Should accept same event again after clearing
      const result = await service.receiveEvent(createValidPayload());
      expect(result.accepted).toBe(true);
    });
  });

  describe('error handling', () => {
    it('does not add to deduplication set when validation fails', async () => {
      await service.receiveEvent({ invalid: true });
      expect(service.getDeduplicationCount()).toBe(0);
    });
  });
});
