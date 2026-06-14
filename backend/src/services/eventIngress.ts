/**
 * Event Ingress Service for the RTO Reallocation Engine.
 *
 * Receives RTO events from logistics partners, validates the payload schema,
 * performs deduplication using shipmentId + attemptNumber as idempotency key,
 * and publishes validated events to the Redis Stream `rto-events` topic.
 *
 * Validates: Requirements 10.1, 10.2, 11.1
 */
import { v4 as uuidv4 } from 'uuid';
import { RedisStreamProducer } from '../utils/redisStreams';

// ---------------------------------------------------------------------------
// Types & Interfaces
// ---------------------------------------------------------------------------

export interface RTOEventPayload {
  shipmentId: string;
  orderId: string;
  customerId: string;
  courierId: string;
  packageDetails: {
    sku: string;
    weight: number;
    dimensions: { l: number; w: number; h: number };
    category: string;
    price: number;
    hsnCode: string;
  };
  deliveryAttempt: {
    attemptNumber: number;
    timestamp: string; // ISO 8601
    gpsLocation: { lat: number; lng: number };
    statusCode: string;
    failureReason: string;
  };
  hubLocation: { lat: number; lng: number; hubId: string };
  metadata: { source: string; receivedAt: string };
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface EventIngressResponse {
  eventId: string;
  accepted: boolean;
  errors?: string[];
}

// ---------------------------------------------------------------------------
// Schema Validation
// ---------------------------------------------------------------------------

/**
 * Validates an incoming payload against the RTOEventPayload interface schema.
 * Returns a ValidationResult with any errors found.
 */
export function validateRTOEventPayload(payload: unknown): ValidationResult {
  const errors: string[] = [];

  if (!payload || typeof payload !== 'object') {
    return { valid: false, errors: ['Payload must be a non-null object'] };
  }

  const p = payload as Record<string, unknown>;

  // Top-level required string fields
  const requiredStrings = ['shipmentId', 'orderId', 'customerId', 'courierId'];
  for (const field of requiredStrings) {
    if (typeof p[field] !== 'string' || (p[field] as string).trim() === '') {
      errors.push(`${field} is required and must be a non-empty string`);
    }
  }

  // packageDetails
  if (!p.packageDetails || typeof p.packageDetails !== 'object') {
    errors.push('packageDetails is required and must be an object');
  } else {
    const pkg = p.packageDetails as Record<string, unknown>;
    if (typeof pkg.sku !== 'string' || (pkg.sku as string).trim() === '') {
      errors.push('packageDetails.sku is required and must be a non-empty string');
    }
    if (typeof pkg.weight !== 'number' || pkg.weight <= 0) {
      errors.push('packageDetails.weight must be a positive number');
    }
    if (!pkg.dimensions || typeof pkg.dimensions !== 'object') {
      errors.push('packageDetails.dimensions is required and must be an object');
    } else {
      const dims = pkg.dimensions as Record<string, unknown>;
      for (const d of ['l', 'w', 'h']) {
        if (typeof dims[d] !== 'number' || (dims[d] as number) <= 0) {
          errors.push(`packageDetails.dimensions.${d} must be a positive number`);
        }
      }
    }
    if (typeof pkg.category !== 'string' || (pkg.category as string).trim() === '') {
      errors.push('packageDetails.category is required and must be a non-empty string');
    }
    if (typeof pkg.price !== 'number' || pkg.price <= 0) {
      errors.push('packageDetails.price must be a positive number');
    }
    if (typeof pkg.hsnCode !== 'string' || (pkg.hsnCode as string).trim() === '') {
      errors.push('packageDetails.hsnCode is required and must be a non-empty string');
    }
  }

  // deliveryAttempt
  if (!p.deliveryAttempt || typeof p.deliveryAttempt !== 'object') {
    errors.push('deliveryAttempt is required and must be an object');
  } else {
    const da = p.deliveryAttempt as Record<string, unknown>;
    if (typeof da.attemptNumber !== 'number' || !Number.isInteger(da.attemptNumber) || (da.attemptNumber as number) < 1) {
      errors.push('deliveryAttempt.attemptNumber must be a positive integer');
    }
    if (typeof da.timestamp !== 'string' || !isValidISO8601(da.timestamp as string)) {
      errors.push('deliveryAttempt.timestamp must be a valid ISO 8601 string');
    }
    if (!da.gpsLocation || typeof da.gpsLocation !== 'object') {
      errors.push('deliveryAttempt.gpsLocation is required and must be an object');
    } else {
      const gps = da.gpsLocation as Record<string, unknown>;
      if (typeof gps.lat !== 'number' || gps.lat < -90 || gps.lat > 90) {
        errors.push('deliveryAttempt.gpsLocation.lat must be a number between -90 and 90');
      }
      if (typeof gps.lng !== 'number' || gps.lng < -180 || gps.lng > 180) {
        errors.push('deliveryAttempt.gpsLocation.lng must be a number between -180 and 180');
      }
    }
    if (typeof da.statusCode !== 'string' || (da.statusCode as string).trim() === '') {
      errors.push('deliveryAttempt.statusCode is required and must be a non-empty string');
    }
    if (typeof da.failureReason !== 'string' || (da.failureReason as string).trim() === '') {
      errors.push('deliveryAttempt.failureReason is required and must be a non-empty string');
    }
  }

  // hubLocation
  if (!p.hubLocation || typeof p.hubLocation !== 'object') {
    errors.push('hubLocation is required and must be an object');
  } else {
    const hub = p.hubLocation as Record<string, unknown>;
    if (typeof hub.lat !== 'number' || hub.lat < -90 || hub.lat > 90) {
      errors.push('hubLocation.lat must be a number between -90 and 90');
    }
    if (typeof hub.lng !== 'number' || hub.lng < -180 || hub.lng > 180) {
      errors.push('hubLocation.lng must be a number between -180 and 180');
    }
    if (typeof hub.hubId !== 'string' || (hub.hubId as string).trim() === '') {
      errors.push('hubLocation.hubId is required and must be a non-empty string');
    }
  }

  // metadata
  if (!p.metadata || typeof p.metadata !== 'object') {
    errors.push('metadata is required and must be an object');
  } else {
    const meta = p.metadata as Record<string, unknown>;
    if (typeof meta.source !== 'string' || (meta.source as string).trim() === '') {
      errors.push('metadata.source is required and must be a non-empty string');
    }
    if (typeof meta.receivedAt !== 'string' || !isValidISO8601(meta.receivedAt as string)) {
      errors.push('metadata.receivedAt must be a valid ISO 8601 string');
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validates that a string is a valid ISO 8601 date/time format.
 */
function isValidISO8601(dateStr: string): boolean {
  const date = new Date(dateStr);
  return !isNaN(date.getTime());
}

// ---------------------------------------------------------------------------
// Event Ingress Service
// ---------------------------------------------------------------------------

export class EventIngressService {
  private producer: RedisStreamProducer;
  /** In-memory deduplication set: key = `${shipmentId}:${attemptNumber}` */
  private deduplicationKeys: Set<string>;

  constructor(producer?: RedisStreamProducer) {
    this.producer = producer ?? new RedisStreamProducer();
    this.deduplicationKeys = new Set<string>();
  }

  /**
   * Receives and processes an RTO event payload.
   * Validates schema, checks for duplicates, and publishes to Redis Stream.
   */
  async receiveEvent(payload: unknown): Promise<EventIngressResponse> {
    // 1. Validate schema
    const validation = validateRTOEventPayload(payload);
    if (!validation.valid) {
      return {
        eventId: '',
        accepted: false,
        errors: validation.errors,
      };
    }

    const validPayload = payload as RTOEventPayload;

    // 2. Deduplication check using shipmentId + attemptNumber
    const idempotencyKey = `${validPayload.shipmentId}:${validPayload.deliveryAttempt.attemptNumber}`;
    if (this.isDuplicate(idempotencyKey)) {
      return {
        eventId: '',
        accepted: false,
        errors: ['Duplicate event: shipmentId + attemptNumber already processed'],
      };
    }

    // 3. Generate event ID and publish to Redis Stream
    const eventId = uuidv4();
    await this.publishToStream(eventId, validPayload);

    // 4. Mark as processed for deduplication
    this.deduplicationKeys.add(idempotencyKey);

    return { eventId, accepted: true };
  }

  /**
   * Checks if an event with the given idempotency key has already been processed.
   */
  isDuplicate(idempotencyKey: string): boolean {
    return this.deduplicationKeys.has(idempotencyKey);
  }

  /**
   * Publishes a validated event to the `rto-events` Redis Stream.
   */
  private async publishToStream(eventId: string, payload: RTOEventPayload): Promise<string> {
    const streamData: Record<string, string> = {
      eventId,
      eventType: 'rto_event_received',
      shipmentId: payload.shipmentId,
      orderId: payload.orderId,
      customerId: payload.customerId,
      courierId: payload.courierId,
      payload: JSON.stringify(payload),
      timestamp: new Date().toISOString(),
      actorModule: 'event_ingress',
      outcomeStatus: 'accepted',
    };

    return this.producer.publishEvent('rto-events', streamData);
  }

  /**
   * Returns the current deduplication key set size (for monitoring/testing).
   */
  getDeduplicationCount(): number {
    return this.deduplicationKeys.size;
  }

  /**
   * Clears the deduplication set (useful for testing or periodic cleanup).
   */
  clearDeduplication(): void {
    this.deduplicationKeys.clear();
  }

  /**
   * Gracefully disconnect the underlying Redis producer.
   */
  async disconnect(): Promise<void> {
    await this.producer.disconnect();
  }
}
