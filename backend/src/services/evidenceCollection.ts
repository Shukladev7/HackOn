/**
 * Evidence Collection Engine
 *
 * Responsibilities:
 * - Verify package eligibility (seal intact, no damage, no tamper indicators)
 * - Collect evidence from multiple sources in parallel
 * - Normalize evidence into a standardized schema
 * - Route ineligible packages to Decision Engine for warehouse return
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1–2.5
 */

import { HubEvent, IHubEvent } from '../models/HubEvent';
import { EvidenceStore } from '../models/EvidenceStore';
import { RTOEvent } from '../models/RTOEvent';
import { DeliveryAttempt } from '../models/DeliveryAttempt';
import { Order } from '../models/Order';
import { Customer } from '../models/Customer';
import { v4 as uuidv4 } from 'uuid';

// ─── Interfaces ──────────────────────────────────────────────────────────────

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
    timestamp: string;
    gpsLocation: { lat: number; lng: number };
    statusCode: string;
    failureReason: string;
  };
  hubLocation: { lat: number; lng: number; hubId: string };
  metadata: { source: string; receivedAt: string };
}

export interface EligibilityCondition {
  pass: boolean;
  evidenceIds: string[];
}

export interface EligibilityResult {
  eligible: boolean;
  conditions: {
    unopened: EligibilityCondition;
    undamaged: EligibilityCondition;
    sealed: EligibilityCondition;
  };
  determinedAt: string;
}

export interface EvidenceSource {
  type: 'gps' | 'call_logs' | 'delivery_scans' | 'order_history' | 'support_tickets' | 'address_validation' | 'hub_events';
  data: unknown;
  collectedAt: string;
  sourceId: string;
}

export interface NormalizedEvidence {
  rtoEventId: string;
  eligibility: EligibilityResult;
  sources: EvidenceSource[];
  completeness: {
    collected: string[];
    unavailable: string[];
    timeoutTimestamps: Record<string, string>;
  };
  normalizedAt: string;
}

export interface WarehouseReturnRouting {
  rtoEventId: string;
  reason: 'ineligible';
  failedConditions: string[];
  eligibilityResult: EligibilityResult;
}

// ─── Hub Event Types for Eligibility ─────────────────────────────────────────

const DAMAGE_EVENT_TYPES = ['damage_reported', 'damage_detected', 'physical_damage', 'wet_damage', 'crushed'];
const TAMPER_EVENT_TYPES = ['tamper_detected', 'seal_broken', 'package_opened', 'tamper_alert', 'open_detected'];
const SEAL_INTACT_EVENT_TYPES = ['seal_verified', 'seal_intact', 'seal_check_pass'];
const CONDITION_OK_EVENT_TYPES = ['condition_ok', 'no_damage', 'inspection_pass'];

// ─── Evidence Collection Engine ──────────────────────────────────────────────

export class EvidenceCollectionEngine {
  private eligibilityTimeoutMs: number;
  private perSourceTimeoutMs: number;
  private totalTimeoutMs: number;
  private minSourcesRequired: number;

  constructor(
    eligibilityTimeoutMs: number = 10000,
    perSourceTimeoutMs: number = 5000,
    totalTimeoutMs: number = 30000,
    minSourcesRequired: number = 3
  ) {
    this.eligibilityTimeoutMs = eligibilityTimeoutMs;
    this.perSourceTimeoutMs = perSourceTimeoutMs;
    this.totalTimeoutMs = totalTimeoutMs;
    this.minSourcesRequired = minSourcesRequired;
  }

  /**
   * Verifies package eligibility by checking:
   * 1. Package is unopened (no tamper/open indicators)
   * 2. Package is undamaged (no damage reports)
   * 3. Package seal is intact (seal verification events)
   *
   * Uses HubEvents and delivery scans as evidence sources.
   * Must complete within 10 seconds of event receipt (Req 1.1).
   *
   * Inconclusive evidence → ineligible (Req 1.3).
   * Records determination with timestamps, pass/fail, evidence IDs (Req 1.4).
   */
  async verifyEligibility(event: RTOEventPayload): Promise<EligibilityResult> {
    const startTime = Date.now();

    // Fetch hub events and delivery scans for this shipment
    const { hubEvents, deliveryScans } = await this.fetchEligibilityEvidence(
      event.shipmentId,
      event.hubLocation.hubId
    );

    // Check each condition using available evidence
    const unopened = this.checkUnopenedCondition(hubEvents, deliveryScans);
    const undamaged = this.checkUndamagedCondition(hubEvents, deliveryScans);
    const sealed = this.checkSealedCondition(hubEvents, deliveryScans);

    // A package is eligible only if ALL three conditions pass (Req 1.1)
    // Inconclusive = ineligible (Req 1.3)
    const eligible = unopened.pass && undamaged.pass && sealed.pass;

    const result: EligibilityResult = {
      eligible,
      conditions: {
        unopened,
        undamaged,
        sealed,
      },
      determinedAt: new Date().toISOString(),
    };

    // Enforce 10-second timeout constraint
    const elapsed = Date.now() - startTime;
    if (elapsed > this.eligibilityTimeoutMs) {
      // If we exceeded the timeout, mark as ineligible with timeout reason
      return {
        eligible: false,
        conditions: {
          unopened: { pass: false, evidenceIds: [] },
          undamaged: { pass: false, evidenceIds: [] },
          sealed: { pass: false, evidenceIds: [] },
        },
        determinedAt: new Date().toISOString(),
      };
    }

    return result;
  }

  /**
   * Routes an ineligible package to the Decision Engine for warehouse return.
   * Records the specific failed conditions (Req 1.2).
   */
  routeIneligibleToWarehouseReturn(
    rtoEventId: string,
    eligibilityResult: EligibilityResult
  ): WarehouseReturnRouting {
    const failedConditions: string[] = [];

    if (!eligibilityResult.conditions.unopened.pass) {
      failedConditions.push('unopened');
    }
    if (!eligibilityResult.conditions.undamaged.pass) {
      failedConditions.push('undamaged');
    }
    if (!eligibilityResult.conditions.sealed.pass) {
      failedConditions.push('sealed');
    }

    return {
      rtoEventId,
      reason: 'ineligible',
      failedConditions,
      eligibilityResult,
    };
  }

  /**
   * Collects evidence from 7 sources in parallel with per-source timeout.
   *
   * - Fetches GPS, call logs, delivery scans, order history, support tickets,
   *   address validation, and hub events
   * - Each source has a 5-second timeout (Req 2.2)
   * - Total collection must complete within 30 seconds (Req 2.1)
   * - Proceeds if ≥3 of 7 sources respond (Req 2.2)
   * - Records unavailable sources with timeout timestamps
   * - Collects from 72-hour lookback window (Req 2.1)
   */
  async collectEvidence(
    event: RTOEventPayload,
    lookbackHours: number = 72
  ): Promise<EvidenceSource[]> {
    return collectEvidenceWithDeps(
      event,
      lookbackHours,
      this.perSourceTimeoutMs,
      this.totalTimeoutMs,
      this.minSourcesRequired,
      {
        fetchGPS: (e, since) => this.fetchGPSEvidence(e, since),
        fetchCallLogs: (e, since) => this.fetchCallLogsEvidence(e, since),
        fetchDeliveryScans: (e, since) => this.fetchDeliveryScansEvidence(e, since),
        fetchOrderHistory: (e, since) => this.fetchOrderHistoryEvidence(e, since),
        fetchSupportTickets: (e, since) => this.fetchSupportTicketsEvidence(e, since),
        fetchAddressValidation: (e, since) => this.fetchAddressValidationEvidence(e, since),
        fetchHubEvents: (e, since) => this.fetchHubEventsEvidence(e, since),
      }
    );
  }

    /**
   * Normalizes raw evidence sources into the standardized NormalizedEvidence schema.
   *
   * - Converts raw EvidenceSource[] to NormalizedEvidence with completeness metadata
   * - Records which sources were collected and which were unavailable
   * - Includes timeout timestamps for unavailable sources
   * - Links to the originating RTO_Event ID
   *
   * Requirements: 2.3, 2.5
   */
  normalizeEvidence(
    sources: EvidenceSource[],
    rtoEventId: string,
    eligibility: EligibilityResult,
    completeness?: {
      collected: string[];
      unavailable: string[];
      timeoutTimestamps: Record<string, string>;
    }
  ): NormalizedEvidence {
    // Derive completeness metadata from sources if not provided
    const collectedTypes = completeness?.collected ?? sources.map((s) => s.type);
    const unavailableTypes = completeness?.unavailable ?? EVIDENCE_SOURCE_TYPES.filter(
      (t) => !sources.some((s) => s.type === t)
    );
    const timeoutTimestamps = completeness?.timeoutTimestamps ?? {};

    return {
      rtoEventId,
      eligibility,
      sources,
      completeness: {
        collected: collectedTypes,
        unavailable: unavailableTypes,
        timeoutTimestamps,
      },
      normalizedAt: new Date().toISOString(),
    };
  }

  /**
   * Persists raw evidence to the evidence_store collection with 90-day TTL.
   * Each evidence source is stored as a separate record linked to the RTO_Event ID.
   *
   * Requirements: 2.4, 2.5
   */
  async persistEvidence(
    sources: EvidenceSource[],
    rtoEventId: string
  ): Promise<void> {
    const now = new Date();
    const TTL_DAYS = 90;
    const expiresAt = new Date(now.getTime() + TTL_DAYS * 24 * 60 * 60 * 1000);

    const documents = sources.map((source) => ({
      rtoEventId,
      sourceType: source.type,
      rawData: source.data as Record<string, unknown>,
      sourceId: source.sourceId,
      collectedAt: new Date(source.collectedAt),
      expiresAt,
    }));

    if (documents.length > 0) {
      await EvidenceStore.insertMany(documents);
    }
  }

  // ─── Individual Source Fetchers ─────────────────────────────────────────────

  private async fetchGPSEvidence(event: RTOEventPayload, since: Date): Promise<EvidenceSource> {
    const attempts = await DeliveryAttempt.find({
      orderId: event.orderId,
      attemptedAt: { $gte: since },
    }).lean();

    return {
      type: 'gps',
      data: attempts.map((a) => ({
        location: a.gpsLocation,
        attemptedAt: a.attemptedAt,
        statusCode: a.statusCode,
      })),
      collectedAt: new Date().toISOString(),
      sourceId: uuidv4(),
    };
  }

  private async fetchCallLogsEvidence(event: RTOEventPayload, since: Date): Promise<EvidenceSource> {
    // Call logs would come from a telephony service; for MVP, query related event data
    return {
      type: 'call_logs',
      data: { customerId: event.customerId, courierId: event.courierId, since: since.toISOString() },
      collectedAt: new Date().toISOString(),
      sourceId: uuidv4(),
    };
  }

  private async fetchDeliveryScansEvidence(event: RTOEventPayload, since: Date): Promise<EvidenceSource> {
    const rtoEvent = await RTOEvent.findOne({ shipmentId: event.shipmentId }).lean();
    const scans = rtoEvent
      ? await HubEvent.find({
          rtoEventId: rtoEvent._id,
          occurredAt: { $gte: since },
          eventType: { $regex: /scan|delivery/ },
        }).lean()
      : [];

    return {
      type: 'delivery_scans',
      data: scans,
      collectedAt: new Date().toISOString(),
      sourceId: uuidv4(),
    };
  }

  private async fetchOrderHistoryEvidence(event: RTOEventPayload, since: Date): Promise<EvidenceSource> {
    const orders = await Order.find({
      customerId: event.customerId,
      placedAt: { $gte: since },
    }).lean();

    return {
      type: 'order_history',
      data: orders.map((o) => ({
        orderId: o._id,
        sku: o.sku,
        status: o.status,
        price: o.price,
        placedAt: o.placedAt,
      })),
      collectedAt: new Date().toISOString(),
      sourceId: uuidv4(),
    };
  }

  private async fetchSupportTicketsEvidence(event: RTOEventPayload, since: Date): Promise<EvidenceSource> {
    // Support tickets would come from a ticketing system; MVP placeholder
    return {
      type: 'support_tickets',
      data: { customerId: event.customerId, orderId: event.orderId, since: since.toISOString() },
      collectedAt: new Date().toISOString(),
      sourceId: uuidv4(),
    };
  }

  private async fetchAddressValidationEvidence(event: RTOEventPayload, since: Date): Promise<EvidenceSource> {
    const customer = await Customer.findById(event.customerId).lean();

    return {
      type: 'address_validation',
      data: customer
        ? {
            address: customer.address,
            deliveryPreferences: customer.deliveryPreferences,
            gpsLocation: event.deliveryAttempt.gpsLocation,
          }
        : null,
      collectedAt: new Date().toISOString(),
      sourceId: uuidv4(),
    };
  }

  private async fetchHubEventsEvidence(event: RTOEventPayload, since: Date): Promise<EvidenceSource> {
    const hubEvents = await HubEvent.find({
      hubId: event.hubLocation.hubId,
      occurredAt: { $gte: since },
    }).lean();

    return {
      type: 'hub_events',
      data: hubEvents,
      collectedAt: new Date().toISOString(),
      sourceId: uuidv4(),
    };
  }

  /**
   * Fetches hub events and delivery scan evidence for eligibility check.
   */
  private async fetchEligibilityEvidence(
    shipmentId: string,
    hubId: string
  ): Promise<{ hubEvents: IHubEvent[]; deliveryScans: IHubEvent[] }> {
    try {
      // Query hub events related to this shipment's RTO event
      const rtoEvent = await RTOEvent.findOne({ shipmentId }).lean();

      if (!rtoEvent) {
        return { hubEvents: [], deliveryScans: [] };
      }

      const hubEvents = await HubEvent.find({
        rtoEventId: rtoEvent._id,
      })
        .sort({ occurredAt: -1 })
        .lean();

      // Delivery scans are hub events with scan-related event types
      const deliveryScans = hubEvents.filter(
        (e) => e.eventType.includes('scan') || e.eventType.includes('delivery')
      );

      return { hubEvents: hubEvents as IHubEvent[], deliveryScans: deliveryScans as IHubEvent[] };
    } catch {
      // If DB query fails, return empty → inconclusive → ineligible (Req 1.3)
      return { hubEvents: [], deliveryScans: [] };
    }
  }

  /**
   * Checks the "unopened" condition.
   * Package passes if there are NO tamper/open indicators detected.
   * If no evidence is available, condition is inconclusive → fails (Req 1.3).
   */
  private checkUnopenedCondition(
    hubEvents: IHubEvent[],
    deliveryScans: IHubEvent[]
  ): EligibilityCondition {
    const allEvents = [...hubEvents, ...deliveryScans];
    const evidenceIds: string[] = [];

    // Look for tamper indicators
    const tamperEvents = allEvents.filter((e) =>
      TAMPER_EVENT_TYPES.includes(e.eventType)
    );

    if (tamperEvents.length > 0) {
      // Tamper detected → unopened condition FAILS
      return {
        pass: false,
        evidenceIds: tamperEvents.map((e) => String(e._id)),
      };
    }

    // Look for positive evidence (condition OK events or seal verified implying unopened)
    const positiveEvents = allEvents.filter(
      (e) =>
        CONDITION_OK_EVENT_TYPES.includes(e.eventType) ||
        SEAL_INTACT_EVENT_TYPES.includes(e.eventType)
    );

    if (positiveEvents.length > 0) {
      return {
        pass: true,
        evidenceIds: positiveEvents.map((e) => String(e._id)),
      };
    }

    // No evidence at all → inconclusive → ineligible (Req 1.3)
    return {
      pass: false,
      evidenceIds,
    };
  }

  /**
   * Checks the "undamaged" condition.
   * Package passes if there are NO damage reports in hub events or scans.
   * If no evidence is available, condition is inconclusive → fails (Req 1.3).
   */
  private checkUndamagedCondition(
    hubEvents: IHubEvent[],
    deliveryScans: IHubEvent[]
  ): EligibilityCondition {
    const allEvents = [...hubEvents, ...deliveryScans];
    const evidenceIds: string[] = [];

    // Look for damage indicators
    const damageEvents = allEvents.filter((e) =>
      DAMAGE_EVENT_TYPES.includes(e.eventType)
    );

    if (damageEvents.length > 0) {
      // Damage detected → undamaged condition FAILS
      return {
        pass: false,
        evidenceIds: damageEvents.map((e) => String(e._id)),
      };
    }

    // Look for positive evidence (condition_ok, inspection_pass)
    const positiveEvents = allEvents.filter((e) =>
      CONDITION_OK_EVENT_TYPES.includes(e.eventType)
    );

    if (positiveEvents.length > 0) {
      return {
        pass: true,
        evidenceIds: positiveEvents.map((e) => String(e._id)),
      };
    }

    // No evidence → inconclusive → ineligible (Req 1.3)
    return {
      pass: false,
      evidenceIds,
    };
  }

  /**
   * Checks the "sealed" condition.
   * Package passes if seal verification events exist and no seal break events found.
   * If no evidence is available, condition is inconclusive → fails (Req 1.3).
   */
  private checkSealedCondition(
    hubEvents: IHubEvent[],
    deliveryScans: IHubEvent[]
  ): EligibilityCondition {
    const allEvents = [...hubEvents, ...deliveryScans];
    const evidenceIds: string[] = [];

    // Look for seal-broken indicators (subset of tamper events)
    const sealBrokenEvents = allEvents.filter(
      (e) => e.eventType === 'seal_broken' || e.eventType === 'package_opened'
    );

    if (sealBrokenEvents.length > 0) {
      // Seal is broken → sealed condition FAILS
      return {
        pass: false,
        evidenceIds: sealBrokenEvents.map((e) => String(e._id)),
      };
    }

    // Look for positive seal verification
    const sealVerifiedEvents = allEvents.filter((e) =>
      SEAL_INTACT_EVENT_TYPES.includes(e.eventType)
    );

    if (sealVerifiedEvents.length > 0) {
      return {
        pass: true,
        evidenceIds: sealVerifiedEvents.map((e) => String(e._id)),
      };
    }

    // No seal evidence → inconclusive → ineligible (Req 1.3)
    return {
      pass: false,
      evidenceIds,
    };
  }
}

// ─── Standalone Helper Functions ─────────────────────────────────────────────

/**
 * Result of evidence collection including metadata about unavailable sources.
 */
export interface EvidenceCollectionResult {
  sources: EvidenceSource[];
  completeness: {
    collected: string[];
    unavailable: string[];
    timeoutTimestamps: Record<string, string>;
  };
  success: boolean;
}

/**
 * Type for individual source fetcher functions.
 * Allows injection for testing.
 */
export interface EvidenceSourceFetchers {
  fetchGPS: (event: RTOEventPayload, since: Date) => Promise<EvidenceSource>;
  fetchCallLogs: (event: RTOEventPayload, since: Date) => Promise<EvidenceSource>;
  fetchDeliveryScans: (event: RTOEventPayload, since: Date) => Promise<EvidenceSource>;
  fetchOrderHistory: (event: RTOEventPayload, since: Date) => Promise<EvidenceSource>;
  fetchSupportTickets: (event: RTOEventPayload, since: Date) => Promise<EvidenceSource>;
  fetchAddressValidation: (event: RTOEventPayload, since: Date) => Promise<EvidenceSource>;
  fetchHubEvents: (event: RTOEventPayload, since: Date) => Promise<EvidenceSource>;
}

/**
 * All 7 evidence source types in canonical order.
 */
export const EVIDENCE_SOURCE_TYPES: EvidenceSource['type'][] = [
  'gps', 'call_logs', 'delivery_scans', 'order_history',
  'support_tickets', 'address_validation', 'hub_events',
];

/**
 * Wraps a promise with a timeout. If the promise doesn't resolve within `ms`,
 * the returned promise rejects with a timeout error.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Source '${label}' timed out after ${ms}ms`));
    }, ms);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeoutId);
  });
}

/**
 * Pure function for collecting evidence with injectable dependencies.
 * This enables unit testing without DB dependencies.
 *
 * - Fetches from 7 sources in parallel using Promise.allSettled() (Req 2.1)
 * - Each source has a per-source timeout (default: 5s, Req 2.2)
 * - Total collection aborts if exceeding totalTimeoutMs (default: 30s, Req 2.1)
 * - Proceeds if ≥ minSources respond (default: 3, Req 2.2)
 * - Records unavailable sources with timeout timestamps
 * - Uses lookbackHours to determine temporal window (default: 72h)
 */
export async function collectEvidenceWithDeps(
  event: RTOEventPayload,
  lookbackHours: number,
  perSourceTimeoutMs: number,
  totalTimeoutMs: number,
  minSourcesRequired: number,
  fetchers: EvidenceSourceFetchers
): Promise<EvidenceSource[]> {
  const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);

  const sourceMap: Record<EvidenceSource['type'], () => Promise<EvidenceSource>> = {
    gps: () => fetchers.fetchGPS(event, since),
    call_logs: () => fetchers.fetchCallLogs(event, since),
    delivery_scans: () => fetchers.fetchDeliveryScans(event, since),
    order_history: () => fetchers.fetchOrderHistory(event, since),
    support_tickets: () => fetchers.fetchSupportTickets(event, since),
    address_validation: () => fetchers.fetchAddressValidation(event, since),
    hub_events: () => fetchers.fetchHubEvents(event, since),
  };

  // Wrap each source with individual per-source timeout
  const timedFetches = EVIDENCE_SOURCE_TYPES.map((sourceType) =>
    withTimeout(sourceMap[sourceType](), perSourceTimeoutMs, sourceType)
  );

  // Apply total collection timeout via Promise.race with allSettled
  const totalTimeoutPromise = new Promise<PromiseSettledResult<EvidenceSource>[]>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Total evidence collection timed out after ${totalTimeoutMs}ms`));
    }, totalTimeoutMs);
  });

  let results: PromiseSettledResult<EvidenceSource>[];
  try {
    results = await Promise.race([
      Promise.allSettled(timedFetches),
      totalTimeoutPromise,
    ]);
  } catch {
    // Total timeout exceeded — treat all pending as unavailable
    throw new Error(`Evidence collection exceeded total timeout of ${totalTimeoutMs}ms`);
  }

  // Process results
  const collected: EvidenceSource[] = [];
  const collectedTypes: string[] = [];
  const unavailableTypes: string[] = [];
  const timeoutTimestamps: Record<string, string> = {};

  results.forEach((result, index) => {
    const sourceType = EVIDENCE_SOURCE_TYPES[index];
    if (result.status === 'fulfilled') {
      collected.push(result.value);
      collectedTypes.push(sourceType);
    } else {
      unavailableTypes.push(sourceType);
      timeoutTimestamps[sourceType] = new Date().toISOString();
    }
  });

  // Check minimum source threshold (Req 2.2)
  if (collected.length < minSourcesRequired) {
    throw new EvidenceCollectionError(
      `Insufficient evidence sources: only ${collected.length} of ${minSourcesRequired} minimum responded`,
      {
        sources: collected,
        completeness: {
          collected: collectedTypes,
          unavailable: unavailableTypes,
          timeoutTimestamps,
        },
        success: false,
      }
    );
  }

  return collected;
}

/**
 * Error class for evidence collection failures that includes partial results.
 */
export class EvidenceCollectionError extends Error {
  public result: EvidenceCollectionResult;

  constructor(message: string, result: EvidenceCollectionResult) {
    super(message);
    this.name = 'EvidenceCollectionError';
    this.result = result;
  }
}

/**
 * Collects evidence and returns full result including completeness metadata.
 * This is a convenience wrapper around collectEvidenceWithDeps that returns
 * the EvidenceCollectionResult with metadata about what succeeded/failed.
 */
export async function collectEvidenceWithMetadata(
  event: RTOEventPayload,
  lookbackHours: number,
  perSourceTimeoutMs: number,
  totalTimeoutMs: number,
  minSourcesRequired: number,
  fetchers: EvidenceSourceFetchers
): Promise<EvidenceCollectionResult> {
  const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);

  const sourceMap: Record<EvidenceSource['type'], () => Promise<EvidenceSource>> = {
    gps: () => fetchers.fetchGPS(event, since),
    call_logs: () => fetchers.fetchCallLogs(event, since),
    delivery_scans: () => fetchers.fetchDeliveryScans(event, since),
    order_history: () => fetchers.fetchOrderHistory(event, since),
    support_tickets: () => fetchers.fetchSupportTickets(event, since),
    address_validation: () => fetchers.fetchAddressValidation(event, since),
    hub_events: () => fetchers.fetchHubEvents(event, since),
  };

  const timedFetches = EVIDENCE_SOURCE_TYPES.map((sourceType) =>
    withTimeout(sourceMap[sourceType](), perSourceTimeoutMs, sourceType)
  );

  const totalTimeoutPromise = new Promise<PromiseSettledResult<EvidenceSource>[]>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Total evidence collection timed out after ${totalTimeoutMs}ms`));
    }, totalTimeoutMs);
  });

  let results: PromiseSettledResult<EvidenceSource>[];
  try {
    results = await Promise.race([
      Promise.allSettled(timedFetches),
      totalTimeoutPromise,
    ]);
  } catch {
    // Total timeout — all sources considered unavailable
    const timeoutTimestamps: Record<string, string> = {};
    const now = new Date().toISOString();
    EVIDENCE_SOURCE_TYPES.forEach((t) => { timeoutTimestamps[t] = now; });
    return {
      sources: [],
      completeness: {
        collected: [],
        unavailable: [...EVIDENCE_SOURCE_TYPES],
        timeoutTimestamps,
      },
      success: false,
    };
  }

  const collected: EvidenceSource[] = [];
  const collectedTypes: string[] = [];
  const unavailableTypes: string[] = [];
  const timeoutTimestamps: Record<string, string> = {};

  results.forEach((result, index) => {
    const sourceType = EVIDENCE_SOURCE_TYPES[index];
    if (result.status === 'fulfilled') {
      collected.push(result.value);
      collectedTypes.push(sourceType);
    } else {
      unavailableTypes.push(sourceType);
      timeoutTimestamps[sourceType] = new Date().toISOString();
    }
  });

  const success = collected.length >= minSourcesRequired;

  return {
    sources: collected,
    completeness: {
      collected: collectedTypes,
      unavailable: unavailableTypes,
      timeoutTimestamps,
    },
    success,
  };
}

/**
 * Pure function for verifying eligibility from pre-fetched evidence.
 * This is useful for testing without DB dependencies.
 */
export function verifyEligibilityFromEvidence(
  hubEvents: Array<{ _id: string; eventType: string; scanData?: Record<string, unknown> }>,
  deliveryScans: Array<{ _id: string; eventType: string; scanData?: Record<string, unknown> }>
): EligibilityResult {
  const unopened = checkUnopenedPure(hubEvents, deliveryScans);
  const undamaged = checkUndamagedPure(hubEvents, deliveryScans);
  const sealed = checkSealedPure(hubEvents, deliveryScans);

  const eligible = unopened.pass && undamaged.pass && sealed.pass;

  return {
    eligible,
    conditions: { unopened, undamaged, sealed },
    determinedAt: new Date().toISOString(),
  };
}

function checkUnopenedPure(
  hubEvents: Array<{ _id: string; eventType: string }>,
  deliveryScans: Array<{ _id: string; eventType: string }>
): EligibilityCondition {
  const allEvents = [...hubEvents, ...deliveryScans];

  const tamperEvents = allEvents.filter((e) => TAMPER_EVENT_TYPES.includes(e.eventType));
  if (tamperEvents.length > 0) {
    return { pass: false, evidenceIds: tamperEvents.map((e) => e._id) };
  }

  const positiveEvents = allEvents.filter(
    (e) => CONDITION_OK_EVENT_TYPES.includes(e.eventType) || SEAL_INTACT_EVENT_TYPES.includes(e.eventType)
  );
  if (positiveEvents.length > 0) {
    return { pass: true, evidenceIds: positiveEvents.map((e) => e._id) };
  }

  return { pass: false, evidenceIds: [] };
}

function checkUndamagedPure(
  hubEvents: Array<{ _id: string; eventType: string }>,
  deliveryScans: Array<{ _id: string; eventType: string }>
): EligibilityCondition {
  const allEvents = [...hubEvents, ...deliveryScans];

  const damageEvents = allEvents.filter((e) => DAMAGE_EVENT_TYPES.includes(e.eventType));
  if (damageEvents.length > 0) {
    return { pass: false, evidenceIds: damageEvents.map((e) => e._id) };
  }

  const positiveEvents = allEvents.filter((e) => CONDITION_OK_EVENT_TYPES.includes(e.eventType));
  if (positiveEvents.length > 0) {
    return { pass: true, evidenceIds: positiveEvents.map((e) => e._id) };
  }

  return { pass: false, evidenceIds: [] };
}

function checkSealedPure(
  hubEvents: Array<{ _id: string; eventType: string }>,
  deliveryScans: Array<{ _id: string; eventType: string }>
): EligibilityCondition {
  const allEvents = [...hubEvents, ...deliveryScans];

  const sealBrokenEvents = allEvents.filter(
    (e) => e.eventType === 'seal_broken' || e.eventType === 'package_opened'
  );
  if (sealBrokenEvents.length > 0) {
    return { pass: false, evidenceIds: sealBrokenEvents.map((e) => e._id) };
  }

  const sealVerifiedEvents = allEvents.filter((e) => SEAL_INTACT_EVENT_TYPES.includes(e.eventType));
  if (sealVerifiedEvents.length > 0) {
    return { pass: true, evidenceIds: sealVerifiedEvents.map((e) => e._id) };
  }

  return { pass: false, evidenceIds: [] };
}

/**
 * Pure function for normalizing evidence without class instantiation.
 * This enables unit testing without dependencies.
 *
 * Requirements: 2.3, 2.5
 */
export function normalizeEvidencePure(
  sources: EvidenceSource[],
  rtoEventId: string,
  eligibility: EligibilityResult,
  completeness?: {
    collected: string[];
    unavailable: string[];
    timeoutTimestamps: Record<string, string>;
  }
): NormalizedEvidence {
  const collectedTypes = completeness?.collected ?? sources.map((s) => s.type);
  const unavailableTypes = completeness?.unavailable ?? EVIDENCE_SOURCE_TYPES.filter(
    (t) => !sources.some((s) => s.type === t)
  );
  const timeoutTimestamps = completeness?.timeoutTimestamps ?? {};

  return {
    rtoEventId,
    eligibility,
    sources,
    completeness: {
      collected: collectedTypes,
      unavailable: unavailableTypes,
      timeoutTimestamps,
    },
    normalizedAt: new Date().toISOString(),
  };
}

/**
 * Determines the failed conditions from an eligibility result.
 */
export function getFailedConditions(result: EligibilityResult): string[] {
  const failed: string[] = [];
  if (!result.conditions.unopened.pass) failed.push('unopened');
  if (!result.conditions.undamaged.pass) failed.push('undamaged');
  if (!result.conditions.sealed.pass) failed.push('sealed');
  return failed;
}

// Export constants for testing
export {
  DAMAGE_EVENT_TYPES,
  TAMPER_EVENT_TYPES,
  SEAL_INTACT_EVENT_TYPES,
  CONDITION_OK_EVENT_TYPES,
};
