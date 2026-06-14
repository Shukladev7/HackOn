import { describe, it, expect } from 'vitest';
import { getSchemaIndexes, INDEX_DEFINITIONS } from './indexes';

describe('MongoDB Indexes', () => {
  describe('Customer indexes', () => {
    it('should have 2dsphere index on address.geoLocation for demand matching', () => {
      const indexes = getSchemaIndexes('customers');
      const geoIndex = indexes.find(
        ([fields]) => fields['address.geoLocation'] === '2dsphere'
      );
      expect(geoIndex).toBeDefined();
    });

    it('should have index on fraudFlag.flagged for fraud detection', () => {
      const indexes = getSchemaIndexes('customers');
      const fraudIndex = indexes.find(
        ([fields]) => fields['fraudFlag.flagged'] === 1
      );
      expect(fraudIndex).toBeDefined();
    });
  });

  describe('RTOEvent indexes', () => {
    it('should have compound index on courierId + receivedAt for courier escalation', () => {
      const indexes = getSchemaIndexes('rto_events');
      const courierIndex = indexes.find(
        ([fields]) => fields['courierId'] === 1 && fields['receivedAt'] === -1
      );
      expect(courierIndex).toBeDefined();
    });

    it('should have compound index on classification.primaryCategory + courierId', () => {
      const indexes = getSchemaIndexes('rto_events');
      const classificationIndex = indexes.find(
        ([fields]) =>
          fields['classification.primaryCategory'] === 1 && fields['courierId'] === 1
      );
      expect(classificationIndex).toBeDefined();
    });

    it('should have compound index on customerId + receivedAt for fraud detection', () => {
      const indexes = getSchemaIndexes('rto_events');
      const customerIndex = indexes.find(
        ([fields]) => fields['customerId'] === 1 && fields['receivedAt'] === -1
      );
      expect(customerIndex).toBeDefined();
    });
  });

  describe('HubEvent indexes', () => {
    it('should have compound index on rtoEventId + occurredAt for time-based evidence queries', () => {
      const indexes = getSchemaIndexes('hub_events');
      const timeIndex = indexes.find(
        ([fields]) => fields['rtoEventId'] === 1 && fields['occurredAt'] === -1
      );
      expect(timeIndex).toBeDefined();
    });
  });

  describe('EvidenceStore indexes', () => {
    it('should have compound index on rtoEventId + sourceType for evidence collection', () => {
      const indexes = getSchemaIndexes('evidence_store');
      const evidenceIndex = indexes.find(
        ([fields]) => fields['rtoEventId'] === 1 && fields['sourceType'] === 1
      );
      expect(evidenceIndex).toBeDefined();
    });

    it('should have TTL index on expiresAt with expireAfterSeconds: 0', () => {
      const indexes = getSchemaIndexes('evidence_store');
      const ttlExpiresIndex = indexes.find(
        ([fields, options]) =>
          fields['expiresAt'] === 1 && (options as Record<string, unknown>)['expireAfterSeconds'] === 0
      );
      expect(ttlExpiresIndex).toBeDefined();
    });

    it('should have TTL index on collectedAt with 90-day retention (7776000 seconds)', () => {
      const indexes = getSchemaIndexes('evidence_store');
      const ttlCollectedIndex = indexes.find(
        ([fields, options]) =>
          fields['collectedAt'] === 1 &&
          (options as Record<string, unknown>)['expireAfterSeconds'] === 7776000
      );
      expect(ttlCollectedIndex).toBeDefined();
    });
  });

  describe('DecisionRecord indexes', () => {
    it('should have index on rtoEventId for decision history', () => {
      const indexes = getSchemaIndexes('decision_records');
      const rtoIndex = indexes.find(([fields]) => fields['rtoEventId'] === 1);
      expect(rtoIndex).toBeDefined();
    });

    it('should have compound index on action + decidedAt for metrics aggregation', () => {
      const indexes = getSchemaIndexes('decision_records');
      const metricsIndex = indexes.find(
        ([fields]) => fields['action'] === 1 && fields['decidedAt'] === -1
      );
      expect(metricsIndex).toBeDefined();
    });
  });

  describe('EventStream indexes', () => {
    it('should have compound index on sourceEntityId + timestamp', () => {
      const indexes = getSchemaIndexes('event_stream');
      const entityIndex = indexes.find(
        ([fields]) => fields['sourceEntityId'] === 1 && fields['timestamp'] === -1
      );
      expect(entityIndex).toBeDefined();
    });

    it('should have compound index on eventType + timestamp', () => {
      const indexes = getSchemaIndexes('event_stream');
      const typeIndex = indexes.find(
        ([fields]) => fields['eventType'] === 1 && fields['timestamp'] === -1
      );
      expect(typeIndex).toBeDefined();
    });
  });

  describe('INDEX_DEFINITIONS documentation', () => {
    it('should document all customer indexes', () => {
      expect(INDEX_DEFINITIONS.customers).toHaveLength(2);
    });

    it('should document all rto_events indexes', () => {
      expect(INDEX_DEFINITIONS.rto_events).toHaveLength(3);
    });

    it('should document all hub_events indexes', () => {
      expect(INDEX_DEFINITIONS.hub_events).toHaveLength(1);
    });

    it('should document all evidence_store indexes', () => {
      expect(INDEX_DEFINITIONS.evidence_store).toHaveLength(3);
    });

    it('should document all decision_records indexes', () => {
      expect(INDEX_DEFINITIONS.decision_records).toHaveLength(2);
    });

    it('should document all event_stream indexes', () => {
      expect(INDEX_DEFINITIONS.event_stream).toHaveLength(2);
    });

    it('should have 90-day TTL defined for evidence retention', () => {
      const ttlIndex = INDEX_DEFINITIONS.evidence_store.find(
        (idx) => 'collectedAt' in idx.fields && idx.options.expireAfterSeconds === 7776000
      );
      expect(ttlIndex).toBeDefined();
      expect(ttlIndex?.purpose).toContain('90 days');
    });
  });
});
