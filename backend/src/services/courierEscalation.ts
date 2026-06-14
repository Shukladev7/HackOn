/**
 * Courier Escalation Service
 *
 * Monitors courier behavior patterns and generates escalation alerts when
 * suspicious sub-causes are detected during root cause classification.
 *
 * Requirements:
 *  - 9.1: Generate escalation alert for fake_delivery_attempt, gps_anomaly,
 *          route_deviation within 60 seconds of classification
 *  - 9.2: Performance review notification when courier accumulates ≥3 Courier_Issue in 7-day window
 *  - 9.3: Include GPS traces, call logs, scan timestamps, address validation,
 *          hub events in escalation alerts
 *  - 9.4: Note missing evidence sources that were unavailable
 */

import { config } from '../config';
import { RTOEvent } from '../models/RTOEvent';

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface EscalationEvidence {
  gpsTraces: any[];
  callLogs: any[];
  deliveryScanTimestamps: string[];
  addressValidation: any;
  hubEvents: any[];
  missingEvidenceSources: string[];
}

export interface EscalationAlert {
  alertId: string;
  courierId: string;
  rtoEventId: string;
  subCause: string;
  evidence: EscalationEvidence;
  generatedAt: string;
}

export interface PerformanceReviewNotification {
  notificationId: string;
  courierId: string;
  issueCount: number;
  windowDays: number;
  threshold: number;
  courierIssueRecords: CourierIssueRecord[];
  generatedAt: Date;
}

export interface CourierIssueRecord {
  rtoEventId: string;
  subCause: string;
  receivedAt: Date;
  classifiedAt?: Date;
}

/**
 * Classification result from the Root Cause Classifier.
 */
export interface ClassificationResult {
  customer_score: number;
  courier_score: number;
  system_score: number;
  primary_category: string | null;
  sub_cause: string | null;
  sub_cause_confidence: number;
  confidence_threshold: number;
  requires_manual_review: boolean;
  classification_timestamp: string;
}

/**
 * Evidence source from the Evidence Collection Engine.
 */
export interface EvidenceSourceData {
  type: 'gps' | 'call_logs' | 'delivery_scans' | 'order_history' | 'support_tickets' | 'address_validation' | 'hub_events';
  data: unknown;
  collectedAt: string;
  sourceId: string;
}

/**
 * Normalized evidence from the Evidence Collection Engine.
 */
export interface NormalizedEvidenceInput {
  rtoEventId: string;
  eligibility: any;
  sources: EvidenceSourceData[];
  completeness: {
    collected: string[];
    unavailable: string[];
    timeoutTimestamps: Record<string, string>;
  };
  normalizedAt: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Sub-causes that trigger an immediate escalation alert (Req 9.1).
 */
export const ESCALATION_SUB_CAUSES = [
  'fake_delivery_attempt',
  'gps_anomaly',
  'route_deviation',
] as const;

export type EscalationSubCause = typeof ESCALATION_SUB_CAUSES[number];

/**
 * Evidence source types relevant for escalation alerts.
 */
const ESCALATION_EVIDENCE_TYPES = [
  'gps',
  'call_logs',
  'delivery_scans',
  'address_validation',
  'hub_events',
] as const;

// ─── Alert storage (in-memory for MVP) ───────────────────────────────────────

const escalationAlerts: EscalationAlert[] = [];
const performanceReviewNotifications: PerformanceReviewNotification[] = [];

/**
 * Get all generated escalation alerts (for testing/querying).
 */
export function getEscalationAlerts(): EscalationAlert[] {
  return [...escalationAlerts];
}

/**
 * Get all generated performance review notifications.
 */
export function getPerformanceReviewNotifications(): PerformanceReviewNotification[] {
  return [...performanceReviewNotifications];
}

/**
 * Clear all escalation alerts (for testing purposes).
 */
export function clearEscalationAlerts(): void {
  escalationAlerts.length = 0;
}

/**
 * Clear all alerts and notifications (for testing purposes).
 */
export function clearEscalationData(): void {
  escalationAlerts.length = 0;
  performanceReviewNotifications.length = 0;
}

// ─── Evidence Extraction Helpers ─────────────────────────────────────────────

/**
 * Extracts GPS traces from evidence sources.
 */
function extractGPSTraces(sources: EvidenceSourceData[]): any[] {
  const gpsSource = sources.find((s) => s.type === 'gps');
  if (!gpsSource || !gpsSource.data) return [];
  return Array.isArray(gpsSource.data) ? gpsSource.data : [gpsSource.data];
}

/**
 * Extracts call logs from evidence sources.
 */
function extractCallLogs(sources: EvidenceSourceData[]): any[] {
  const callSource = sources.find((s) => s.type === 'call_logs');
  if (!callSource || !callSource.data) return [];
  return Array.isArray(callSource.data) ? callSource.data : [callSource.data];
}

/**
 * Extracts delivery scan timestamps from evidence sources.
 */
function extractDeliveryScanTimestamps(sources: EvidenceSourceData[]): string[] {
  const scanSource = sources.find((s) => s.type === 'delivery_scans');
  if (!scanSource || !scanSource.data) return [];

  const scans = Array.isArray(scanSource.data) ? scanSource.data : [scanSource.data];
  return scans
    .map((scan: any) => scan.occurredAt || scan.timestamp || scan.collectedAt)
    .filter((ts: any): ts is string => typeof ts === 'string');
}

/**
 * Extracts address validation data from evidence sources.
 */
function extractAddressValidation(sources: EvidenceSourceData[]): any {
  const addrSource = sources.find((s) => s.type === 'address_validation');
  if (!addrSource || !addrSource.data) return null;
  return addrSource.data;
}

/**
 * Extracts hub events from evidence sources.
 */
function extractHubEvents(sources: EvidenceSourceData[]): any[] {
  const hubSource = sources.find((s) => s.type === 'hub_events');
  if (!hubSource || !hubSource.data) return [];
  return Array.isArray(hubSource.data) ? hubSource.data : [hubSource.data];
}

/**
 * Identifies which evidence sources relevant to escalation were unavailable.
 * Uses the completeness metadata from NormalizedEvidence.
 *
 * Requirement 9.4: Note missing evidence sources that were unavailable.
 */
function identifyMissingEvidenceSources(evidence: NormalizedEvidenceInput): string[] {
  const unavailable = evidence.completeness.unavailable || [];
  // Filter to only the evidence types relevant for escalation alerts
  return unavailable.filter((source) =>
    (ESCALATION_EVIDENCE_TYPES as readonly string[]).includes(source)
  );
}

// ─── Core Functions ──────────────────────────────────────────────────────────

/**
 * Determines whether an escalation alert should be triggered based on the
 * classification result.
 *
 * An escalation is triggered when:
 * - The primary category is 'courier_issue'
 * - The sub-cause is one of: fake_delivery_attempt, gps_anomaly, route_deviation
 *
 * Requirement 9.1
 */
export function shouldEscalate(classification: ClassificationResult): boolean {
  if (classification.primary_category !== 'courier_issue') {
    return false;
  }
  if (!classification.sub_cause) {
    return false;
  }
  return ESCALATION_SUB_CAUSES.includes(classification.sub_cause as EscalationSubCause);
}

/**
 * Generates an escalation alert with all required evidence.
 *
 * Requirements:
 *  - 9.3: Include GPS traces, call logs, scan timestamps, address validation, hub events
 *  - 9.4: Note missing evidence sources
 *
 * @param courierId - The courier being escalated
 * @param rtoEventId - The associated RTO event
 * @param subCause - The specific sub-cause triggering escalation
 * @param evidence - The normalized evidence collected for this event
 * @returns A fully populated EscalationAlert
 */
export function generateAlert(
  courierId: string,
  rtoEventId: string,
  subCause: string,
  evidence: NormalizedEvidenceInput
): EscalationAlert {
  const sources = evidence.sources;

  const alert: EscalationAlert = {
    alertId: `ESC-${courierId}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    courierId,
    rtoEventId,
    subCause,
    evidence: {
      gpsTraces: extractGPSTraces(sources),
      callLogs: extractCallLogs(sources),
      deliveryScanTimestamps: extractDeliveryScanTimestamps(sources),
      addressValidation: extractAddressValidation(sources),
      hubEvents: extractHubEvents(sources),
      missingEvidenceSources: identifyMissingEvidenceSources(evidence),
    },
    generatedAt: new Date().toISOString(),
  };

  // Store alert (in production, this would go to an alerts collection/queue)
  escalationAlerts.push(alert);

  return alert;
}

/**
 * Main entry point: checks whether an escalation alert should be generated
 * and produces it if so.
 *
 * Must complete within 60 seconds of classification (Req 9.1).
 * In practice, this function is nearly instantaneous since it operates
 * on already-collected evidence.
 *
 * @param courierId - The courier to check
 * @param rtoEventId - The RTO event identifier
 * @param classification - The root cause classification result
 * @param evidence - The normalized evidence for this event
 * @returns An EscalationAlert if escalation criteria are met, null otherwise
 */
export function checkForEscalation(
  courierId: string,
  rtoEventId: string,
  classification: ClassificationResult,
  evidence: NormalizedEvidenceInput
): EscalationAlert | null {
  // Check if this classification warrants escalation
  if (!shouldEscalate(classification)) {
    return null;
  }

  // Generate the escalation alert with full evidence
  return generateAlert(courierId, rtoEventId, classification.sub_cause!, evidence);
}

/**
 * Check courier performance against the rolling window threshold (Req 9.2).
 *
 * Monitors a 7-calendar-day rolling window and generates a performance review
 * notification when the courier accumulates ≥3 Courier_Issue classifications.
 *
 * @param courierId - The courier identifier to check
 * @param windowDays - Rolling window in days (default: from config, 7 days)
 * @param threshold - Number of courier issues to trigger review (default: from config, 3)
 * @returns PerformanceReviewNotification if threshold met, null otherwise
 */
export async function checkPerformanceThreshold(
  courierId: string,
  windowDays: number = config.courierEscalationWindowDays,
  threshold: number = config.courierEscalationThreshold
): Promise<PerformanceReviewNotification | null> {
  const windowStart = new Date();
  windowStart.setDate(windowStart.getDate() - windowDays);

  // Query courier issue events within the rolling window
  const courierIssueEvents = await RTOEvent.find({
    courierId,
    'classification.primaryCategory': 'courier_issue',
    receivedAt: { $gte: windowStart },
  })
    .select('_id classification.subCause classification.classifiedAt receivedAt')
    .sort({ receivedAt: -1 })
    .lean();

  const issueCount = courierIssueEvents.length;

  // Only generate notification if threshold is met
  if (issueCount < threshold) {
    return null;
  }

  // Build courier issue records from the query results
  const courierIssueRecords: CourierIssueRecord[] = courierIssueEvents.map((event: any) => ({
    rtoEventId: event._id.toString(),
    subCause: event.classification?.subCause ?? 'unspecified',
    receivedAt: event.receivedAt,
    classifiedAt: event.classification?.classifiedAt,
  }));

  const notification: PerformanceReviewNotification = {
    notificationId: `PERF-REVIEW-${courierId}-${Date.now()}`,
    courierId,
    issueCount,
    windowDays,
    threshold,
    courierIssueRecords,
    generatedAt: new Date(),
  };

  performanceReviewNotifications.push(notification);
  return notification;
}
