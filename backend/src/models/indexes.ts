/**
 * MongoDB Index Definitions
 *
 * This module documents and ensures all required indexes are created
 * on the MongoDB collections for the RTO Reallocation Engine.
 *
 * Indexes are defined inline on Mongoose schemas (ensuring they're created
 * when models are registered), but this module provides:
 * 1. A centralized reference for all performance indexes
 * 2. A function to ensure all indexes are synced with the database
 * 3. Documentation of index purposes for maintainability
 *
 * Requirements: 2.4, 5.1, 9.2, 10.4, 10.6, 12.6
 */

import { Customer } from './Customer';
import { RTOEvent } from './RTOEvent';
import { HubEvent } from './HubEvent';
import { EvidenceStore } from './EvidenceStore';
import { DecisionRecord } from './DecisionRecord';
import { EventStream } from './EventStream';

/**
 * Index definitions for documentation and verification purposes.
 * Each entry maps to an index defined on the respective Mongoose schema.
 */
export const INDEX_DEFINITIONS = {
  customers: [
    {
      fields: { 'address.geoLocation': '2dsphere' as const },
      options: {},
      purpose: 'Geospatial index for demand matching - enables radius-based candidate search',
    },
    {
      fields: { 'fraudFlag.flagged': 1 as const },
      options: {},
      purpose: 'Fraud detection - quickly find flagged customers',
    },
  ],
  rto_events: [
    {
      fields: { courierId: 1 as const, receivedAt: -1 as const },
      options: {},
      purpose: 'Courier escalation queries - find recent RTO events by courier',
    },
    {
      fields: { 'classification.primaryCategory': 1 as const, courierId: 1 as const },
      options: {},
      purpose: 'Courier escalation - find courier-caused issues by category',
    },
    {
      fields: { customerId: 1 as const, receivedAt: -1 as const },
      options: {},
      purpose: 'Fraud detection - find recent RTO events by customer',
    },
  ],
  hub_events: [
    {
      fields: { rtoEventId: 1 as const, occurredAt: -1 as const },
      options: {},
      purpose: 'Time-based evidence queries - retrieve hub events for an RTO event in reverse chronological order',
    },
  ],
  evidence_store: [
    {
      fields: { rtoEventId: 1 as const, sourceType: 1 as const },
      options: {},
      purpose: 'Evidence collection queries - find evidence by RTO event and source type',
    },
    {
      fields: { expiresAt: 1 as const },
      options: { expireAfterSeconds: 0 },
      purpose: 'TTL index for automatic evidence expiration based on expiresAt field',
    },
    {
      fields: { collectedAt: 1 as const },
      options: { expireAfterSeconds: 7776000 }, // 90 days in seconds
      purpose: 'TTL for evidence retention - auto-delete evidence after 90 days from collection',
    },
  ],
  decision_records: [
    {
      fields: { rtoEventId: 1 as const },
      options: {},
      purpose: 'Decision history - lookup decisions by RTO event',
    },
    {
      fields: { action: 1 as const, decidedAt: -1 as const },
      options: {},
      purpose: 'Metrics aggregation - aggregate decisions by action type over time',
    },
  ],
  event_stream: [
    {
      fields: { sourceEntityId: 1 as const, timestamp: -1 as const },
      options: {},
      purpose: 'Event timeline queries - retrieve events for an entity in reverse chronological order',
    },
    {
      fields: { eventType: 1 as const, timestamp: -1 as const },
      options: {},
      purpose: 'Event type queries - filter events by type over time',
    },
  ],
} as const;

/**
 * Ensures all indexes are created/synced in MongoDB.
 * Calls `ensureIndexes()` on each model to sync schema-defined indexes with the database.
 *
 * This should be called after the database connection is established.
 * In production, consider using `createIndexes()` during deployment rather than at startup.
 */
export async function ensureAllIndexes(): Promise<void> {
  const models = [Customer, RTOEvent, HubEvent, EvidenceStore, DecisionRecord, EventStream];

  await Promise.all(models.map((model) => model.ensureIndexes()));
}

/**
 * Lists all indexes currently defined on a model.
 * Useful for debugging and verification.
 */
export async function listIndexes(collectionName: string): Promise<Record<string, unknown>[]> {
  const modelMap: Record<string, typeof Customer | typeof RTOEvent | typeof HubEvent | typeof EvidenceStore | typeof DecisionRecord | typeof EventStream> = {
    customers: Customer,
    rto_events: RTOEvent,
    hub_events: HubEvent,
    evidence_store: EvidenceStore,
    decision_records: DecisionRecord,
    event_stream: EventStream,
  };

  const model = modelMap[collectionName];
  if (!model) {
    throw new Error(`Unknown collection: ${collectionName}`);
  }

  return model.collection.indexes();
}

/**
 * Gets the schema-level index definitions for a model (without requiring a DB connection).
 * Useful for unit testing that indexes are correctly defined on the schemas.
 */
export function getSchemaIndexes(collectionName: string): Array<[Record<string, unknown>, Record<string, unknown>]> {
  const modelMap: Record<string, typeof Customer | typeof RTOEvent | typeof HubEvent | typeof EvidenceStore | typeof DecisionRecord | typeof EventStream> = {
    customers: Customer,
    rto_events: RTOEvent,
    hub_events: HubEvent,
    evidence_store: EvidenceStore,
    decision_records: DecisionRecord,
    event_stream: EventStream,
  };

  const model = modelMap[collectionName];
  if (!model) {
    throw new Error(`Unknown collection: ${collectionName}`);
  }

  return model.schema.indexes() as Array<[Record<string, unknown>, Record<string, unknown>]>;
}
