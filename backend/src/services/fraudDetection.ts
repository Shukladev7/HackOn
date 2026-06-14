/**
 * Fraud Detection Service
 *
 * Monitors customer and courier RTO event patterns to detect potential fraud.
 * Implements Requirements 12.6 and 12.7:
 *  - 12.6: Flag entity for fraud investigation when RTO count exceeds configurable threshold
 *          (default: 5 events in 30 days) and generate compliance alert
 *  - 12.7: Suspend reallocation eligibility for flagged entities
 */

import { config } from '../config';
import { RTOEvent } from '../models/RTOEvent';
import { Customer } from '../models/Customer';
import { Courier } from '../models/Courier';

// --- Types ---

export type EntityType = 'customer' | 'courier';

export interface FraudCheckResult {
  entityId: string;
  entityType: EntityType;
  rtoCount: number;
  threshold: number;
  windowDays: number;
  exceedsThreshold: boolean;
}

export interface ComplianceAlert {
  alertId: string;
  entityId: string;
  entityType: EntityType;
  rtoCount: number;
  threshold: number;
  windowDays: number;
  reason: string;
  generatedAt: Date;
}

export interface FraudFlagResult {
  entityId: string;
  entityType: EntityType;
  flagged: boolean;
  flaggedAt: Date;
  reason: string;
}

// --- Alert storage (in-memory for MVP, would be a collection in production) ---

const complianceAlerts: ComplianceAlert[] = [];

/**
 * Get all generated compliance alerts (for testing/querying).
 */
export function getComplianceAlerts(): ComplianceAlert[] {
  return [...complianceAlerts];
}

/**
 * Clear compliance alerts (for testing purposes).
 */
export function clearComplianceAlerts(): void {
  complianceAlerts.length = 0;
}

// --- Core Functions ---

/**
 * Check if an entity (customer or courier) has exceeded the fraud RTO threshold
 * within the configured time window.
 *
 * Counts RTO events for the given entity within [now - windowDays, now].
 *
 * @param entityId - The ID of the entity to check
 * @param entityType - Whether this is a 'customer' or 'courier'
 * @param windowDays - Time window in days (default: from config)
 * @param threshold - RTO count threshold (default: from config)
 * @returns FraudCheckResult with count and whether threshold is exceeded
 */
export async function checkFraudThreshold(
  entityId: string,
  entityType: EntityType,
  windowDays: number = config.fraudTimeWindowDays,
  threshold: number = config.fraudRtoCountThreshold
): Promise<FraudCheckResult> {
  const windowStart = new Date();
  windowStart.setDate(windowStart.getDate() - windowDays);

  const query =
    entityType === 'customer'
      ? { customerId: entityId, receivedAt: { $gte: windowStart } }
      : { courierId: entityId, receivedAt: { $gte: windowStart } };

  const rtoCount = await RTOEvent.countDocuments(query);

  return {
    entityId,
    entityType,
    rtoCount,
    threshold,
    windowDays,
    exceedsThreshold: rtoCount >= threshold,
  };
}

/**
 * Flag an entity for fraud investigation.
 * Updates the fraudFlag field on the Customer or Courier document.
 *
 * @param entityId - The ID of the entity to flag
 * @param entityType - Whether this is a 'customer' or 'courier'
 * @param reason - Human-readable reason for flagging
 * @returns FraudFlagResult confirming the flag was set
 */
export async function flagEntityForFraud(
  entityId: string,
  entityType: EntityType,
  reason: string
): Promise<FraudFlagResult> {
  const flaggedAt = new Date();
  const update = {
    $set: {
      'fraudFlag.flagged': true,
      'fraudFlag.flaggedAt': flaggedAt,
      'fraudFlag.reason': reason,
    },
  };

  if (entityType === 'customer') {
    await Customer.updateOne({ _id: entityId }, update);
  } else {
    await Courier.updateOne({ _id: entityId }, update);
  }

  return {
    entityId,
    entityType,
    flagged: true,
    flaggedAt,
    reason,
  };
}

/**
 * Check if an entity is currently flagged for fraud.
 * When flagged, the entity's orders should be ineligible for reallocation (Req 12.7).
 *
 * @param entityId - The ID of the entity to check
 * @param entityType - Whether this is a 'customer' or 'courier'
 * @returns true if the entity is flagged, false otherwise
 */
export async function isEntityFlagged(
  entityId: string,
  entityType: EntityType
): Promise<boolean> {
  if (entityType === 'customer') {
    const customer = await Customer.findById(entityId).select('fraudFlag.flagged').lean();
    return customer?.fraudFlag?.flagged === true;
  } else {
    const courier = await Courier.findById(entityId).select('fraudFlag.flagged').lean();
    return courier?.fraudFlag?.flagged === true;
  }
}

/**
 * Generate a compliance team alert when fraud threshold is exceeded.
 * Creates an alert record that would be sent to the compliance team.
 *
 * @param entityId - The ID of the entity
 * @param entityType - Whether this is a 'customer' or 'courier'
 * @param rtoCount - The current RTO count that triggered the alert
 * @returns ComplianceAlert with full alert details
 */
export function generateComplianceAlert(
  entityId: string,
  entityType: EntityType,
  rtoCount: number
): ComplianceAlert {
  const alert: ComplianceAlert = {
    alertId: `FRAUD-${entityType.toUpperCase()}-${entityId}-${Date.now()}`,
    entityId,
    entityType,
    rtoCount,
    threshold: config.fraudRtoCountThreshold,
    windowDays: config.fraudTimeWindowDays,
    reason: `${entityType} ${entityId} has accumulated ${rtoCount} RTO events within ${config.fraudTimeWindowDays} days, exceeding threshold of ${config.fraudRtoCountThreshold}`,
    generatedAt: new Date(),
  };

  // Store alert (in production, this would go to a dedicated alerts collection/queue)
  complianceAlerts.push(alert);

  return alert;
}

/**
 * Run the full fraud detection pipeline for an entity.
 * This is the main entry point used by the Decision Engine.
 *
 * 1. Check RTO count against threshold
 * 2. If exceeded: flag entity, generate compliance alert, return flagged=true
 * 3. If not exceeded: check if already flagged, return current status
 *
 * @param entityId - The ID of the entity
 * @param entityType - Whether this is a 'customer' or 'courier'
 * @returns Object indicating whether reallocation should be suspended
 */
export async function runFraudDetection(
  entityId: string,
  entityType: EntityType
): Promise<{
  suspendReallocation: boolean;
  fraudCheckResult: FraudCheckResult;
  alert?: ComplianceAlert;
  flagResult?: FraudFlagResult;
}> {
  // Step 1: Check threshold
  const fraudCheckResult = await checkFraudThreshold(entityId, entityType);

  // Step 2: If threshold exceeded and not already flagged, flag and alert
  if (fraudCheckResult.exceedsThreshold) {
    const alreadyFlagged = await isEntityFlagged(entityId, entityType);

    if (!alreadyFlagged) {
      const reason = `Accumulated ${fraudCheckResult.rtoCount} RTO events within ${fraudCheckResult.windowDays} days (threshold: ${fraudCheckResult.threshold})`;
      const flagResult = await flagEntityForFraud(entityId, entityType, reason);
      const alert = generateComplianceAlert(entityId, entityType, fraudCheckResult.rtoCount);

      return {
        suspendReallocation: true,
        fraudCheckResult,
        alert,
        flagResult,
      };
    }

    // Already flagged — still suspend
    return {
      suspendReallocation: true,
      fraudCheckResult,
    };
  }

  // Step 3: Check if already flagged from a previous detection
  const isFlagged = await isEntityFlagged(entityId, entityType);

  return {
    suspendReallocation: isFlagged,
    fraudCheckResult,
  };
}
