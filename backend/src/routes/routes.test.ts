/**
 * Tests for all API routes created in task 18.1.
 *
 * Tests cover:
 * - GET /api/v1/rto-events/:id
 * - GET /api/v1/rto-events/:id/decision
 * - GET /api/v1/rto-events/:id/timeline
 * - GET /api/v1/orders/:id/history
 * - GET /api/v1/packages/:id/history
 * - GET /api/v1/couriers/:id/escalations
 * - GET /api/v1/config
 * - PATCH /api/v1/config
 * - GET /api/v1/health
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import app from '../index';
import { clearRuntimeOverrides } from './configRoutes';

// Mock mongoose models
vi.mock('../models/RTOEvent', () => {
  const mockRTOEvent = {
    findById: vi.fn(),
    find: vi.fn(),
    exists: vi.fn(),
  };
  return { RTOEvent: mockRTOEvent };
});

vi.mock('../models/DecisionRecord', () => {
  const mockDecisionRecord = {
    findOne: vi.fn(),
    find: vi.fn(),
  };
  return { DecisionRecord: mockDecisionRecord };
});

vi.mock('../models/EventStream', () => {
  const mockEventStream = {
    find: vi.fn(),
  };
  return { EventStream: mockEventStream };
});

vi.mock('../services/courierEscalation', () => ({
  getEscalationAlerts: vi.fn().mockReturnValue([]),
}));

// Import mocked modules
import { RTOEvent } from '../models/RTOEvent';
import { DecisionRecord } from '../models/DecisionRecord';
import { EventStream } from '../models/EventStream';
import { getEscalationAlerts } from '../services/courierEscalation';

describe('GET /api/v1/health', () => {
  it('should return healthy status', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
    expect(res.body.service).toBe('rto-reallocation-backend');
    expect(res.body.timestamp).toBeDefined();
  });
});

describe('GET /api/v1/rto-events/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 400 for invalid ObjectId', async () => {
    const res = await request(app).get('/api/v1/rto-events/invalid-id');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid event ID format');
  });

  it('should return 404 when event not found', async () => {
    (RTOEvent.findById as any).mockReturnValue({ lean: () => Promise.resolve(null) });

    const res = await request(app).get('/api/v1/rto-events/507f1f77bcf86cd799439011');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('RTO event not found');
  });

  it('should return event details for valid ID', async () => {
    const mockEvent = {
      _id: '507f1f77bcf86cd799439011',
      shipmentId: 'SHIP-001',
      status: 'decided',
      receivedAt: new Date().toISOString(),
    };
    (RTOEvent.findById as any).mockReturnValue({ lean: () => Promise.resolve(mockEvent) });

    const res = await request(app).get('/api/v1/rto-events/507f1f77bcf86cd799439011');
    expect(res.status).toBe(200);
    expect(res.body.shipmentId).toBe('SHIP-001');
    expect(res.body.status).toBe('decided');
  });
});

describe('GET /api/v1/rto-events/:id/decision', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 400 for invalid ObjectId', async () => {
    const res = await request(app).get('/api/v1/rto-events/bad-id/decision');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid event ID format');
  });

  it('should return 404 when decision not found', async () => {
    (DecisionRecord.findOne as any).mockReturnValue({ lean: () => Promise.resolve(null) });

    const res = await request(app).get('/api/v1/rto-events/507f1f77bcf86cd799439011/decision');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Decision record not found for this event');
  });

  it('should return decision record for valid event ID', async () => {
    const mockDecision = {
      _id: '607f1f77bcf86cd799439022',
      rtoEventId: '507f1f77bcf86cd799439011',
      action: 'redeliver',
      reasoning: 'Courier issue detected',
      rootCause: { category: 'courier_issue', subCause: 'fake_attempt', scores: { customer: 0.1, courier: 0.9, system: 0.05 } },
      inputs: { recoveryProbability: 0.7, candidateBuyerCount: 0, topBuyerScore: null },
    };
    (DecisionRecord.findOne as any).mockReturnValue({ lean: () => Promise.resolve(mockDecision) });

    const res = await request(app).get('/api/v1/rto-events/507f1f77bcf86cd799439011/decision');
    expect(res.status).toBe(200);
    expect(res.body.action).toBe('redeliver');
    expect(res.body.rtoEventId).toBe('507f1f77bcf86cd799439011');
  });
});

describe('GET /api/v1/rto-events/:id/timeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 400 for invalid ObjectId', async () => {
    const res = await request(app).get('/api/v1/rto-events/xyz/timeline');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid event ID format');
  });

  it('should return 404 when event does not exist', async () => {
    (RTOEvent.exists as any).mockResolvedValue(null);

    const res = await request(app).get('/api/v1/rto-events/507f1f77bcf86cd799439011/timeline');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('RTO event not found');
  });

  it('should return timeline events for valid event ID', async () => {
    (RTOEvent.exists as any).mockResolvedValue({ _id: '507f1f77bcf86cd799439011' });
    const mockTimeline = [
      { eventType: 'eligibility_check', sourceEntityId: '507f1f77bcf86cd799439011', timestamp: '2024-01-01T00:00:00Z' },
      { eventType: 'classification', sourceEntityId: '507f1f77bcf86cd799439011', timestamp: '2024-01-01T00:00:05Z' },
    ];
    (EventStream.find as any).mockReturnValue({
      sort: vi.fn().mockReturnValue({ lean: () => Promise.resolve(mockTimeline) }),
    });

    const res = await request(app).get('/api/v1/rto-events/507f1f77bcf86cd799439011/timeline');
    expect(res.status).toBe(200);
    expect(res.body.rtoEventId).toBe('507f1f77bcf86cd799439011');
    expect(res.body.events).toHaveLength(2);
    expect(res.body.events[0].eventType).toBe('eligibility_check');
  });
});

describe('GET /api/v1/orders/:id/history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 400 for invalid ObjectId', async () => {
    const res = await request(app).get('/api/v1/orders/not-valid/history');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid order ID format');
  });

  it('should return empty history when no RTO events exist for order', async () => {
    (RTOEvent.find as any).mockReturnValue({
      select: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnValue({ lean: () => Promise.resolve([]) }),
      }),
    });
    (DecisionRecord.find as any).mockReturnValue({
      sort: vi.fn().mockReturnValue({ lean: () => Promise.resolve([]) }),
    });

    const res = await request(app).get('/api/v1/orders/507f1f77bcf86cd799439011/history');
    expect(res.status).toBe(200);
    expect(res.body.orderId).toBe('507f1f77bcf86cd799439011');
    expect(res.body.rtoEvents).toHaveLength(0);
    expect(res.body.decisions).toHaveLength(0);
  });

  it('should return order history with RTO events and decisions', async () => {
    const mockRtoEvents = [
      {
        _id: '607f1f77bcf86cd799439022',
        shipmentId: 'SHIP-001',
        status: 'decided',
        receivedAt: '2024-01-01T00:00:00Z',
        processedAt: '2024-01-01T00:01:00Z',
        decision: { action: 'redeliver', reasoning: 'test' },
      },
    ];
    const mockDecisions = [
      { rtoEventId: '607f1f77bcf86cd799439022', action: 'redeliver', decidedAt: '2024-01-01T00:01:00Z' },
    ];

    (RTOEvent.find as any).mockReturnValue({
      select: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnValue({ lean: () => Promise.resolve(mockRtoEvents) }),
      }),
    });
    (DecisionRecord.find as any).mockReturnValue({
      sort: vi.fn().mockReturnValue({ lean: () => Promise.resolve(mockDecisions) }),
    });

    const res = await request(app).get('/api/v1/orders/507f1f77bcf86cd799439011/history');
    expect(res.status).toBe(200);
    expect(res.body.orderId).toBe('507f1f77bcf86cd799439011');
    expect(res.body.rtoEvents).toHaveLength(1);
    expect(res.body.rtoEvents[0].shipmentId).toBe('SHIP-001');
    expect(res.body.decisions).toHaveLength(1);
  });
});

describe('GET /api/v1/packages/:id/history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return package history for a valid shipmentId', async () => {
    const mockRtoEvents = [
      {
        _id: '607f1f77bcf86cd799439022',
        shipmentId: 'SHIP-001',
        orderId: '507f1f77bcf86cd799439011',
        status: 'decided',
        receivedAt: '2024-01-01T00:00:00Z',
        processedAt: '2024-01-01T00:01:00Z',
        decision: { action: 'reallocate', reasoning: 'customer issue, low recovery' },
      },
    ];
    const mockDecisions = [
      { rtoEventId: '607f1f77bcf86cd799439022', action: 'reallocate', decidedAt: '2024-01-01T00:01:00Z' },
    ];

    (RTOEvent.find as any).mockReturnValue({
      select: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnValue({ lean: () => Promise.resolve(mockRtoEvents) }),
      }),
    });
    (DecisionRecord.find as any).mockReturnValue({
      sort: vi.fn().mockReturnValue({ lean: () => Promise.resolve(mockDecisions) }),
    });

    const res = await request(app).get('/api/v1/packages/SHIP-001/history');
    expect(res.status).toBe(200);
    expect(res.body.shipmentId).toBe('SHIP-001');
    expect(res.body.rtoEvents).toHaveLength(1);
    expect(res.body.decisions).toHaveLength(1);
  });

  it('should return empty history for unknown shipmentId', async () => {
    (RTOEvent.find as any).mockReturnValue({
      select: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnValue({ lean: () => Promise.resolve([]) }),
      }),
    });
    (DecisionRecord.find as any).mockReturnValue({
      sort: vi.fn().mockReturnValue({ lean: () => Promise.resolve([]) }),
    });

    const res = await request(app).get('/api/v1/packages/NONEXISTENT/history');
    expect(res.status).toBe(200);
    expect(res.body.shipmentId).toBe('NONEXISTENT');
    expect(res.body.rtoEvents).toHaveLength(0);
  });
});

describe('GET /api/v1/couriers/:id/escalations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return empty escalations for courier with no alerts', async () => {
    (getEscalationAlerts as any).mockReturnValue([]);

    const res = await request(app).get('/api/v1/couriers/courier-123/escalations');
    expect(res.status).toBe(200);
    expect(res.body.courierId).toBe('courier-123');
    expect(res.body.escalations).toHaveLength(0);
    expect(res.body.totalCount).toBe(0);
  });

  it('should return escalations filtered by courier ID', async () => {
    const mockAlerts = [
      { alertId: 'ESC-1', courierId: 'courier-123', rtoEventId: 'evt-1', subCause: 'fake_delivery_attempt', generatedAt: '2024-01-02T00:00:00Z' },
      { alertId: 'ESC-2', courierId: 'courier-456', rtoEventId: 'evt-2', subCause: 'gps_anomaly', generatedAt: '2024-01-03T00:00:00Z' },
      { alertId: 'ESC-3', courierId: 'courier-123', rtoEventId: 'evt-3', subCause: 'route_deviation', generatedAt: '2024-01-04T00:00:00Z' },
    ];
    (getEscalationAlerts as any).mockReturnValue(mockAlerts);

    const res = await request(app).get('/api/v1/couriers/courier-123/escalations');
    expect(res.status).toBe(200);
    expect(res.body.courierId).toBe('courier-123');
    expect(res.body.escalations).toHaveLength(2);
    expect(res.body.totalCount).toBe(2);
    // Should be sorted by most recent first
    expect(res.body.escalations[0].alertId).toBe('ESC-3');
    expect(res.body.escalations[1].alertId).toBe('ESC-1');
  });
});

describe('GET /api/v1/config', () => {
  beforeEach(() => {
    clearRuntimeOverrides();
  });

  it('should return current configuration', async () => {
    const res = await request(app).get('/api/v1/config');
    expect(res.status).toBe(200);
    expect(res.body.config).toBeDefined();
    expect(res.body.config.confidenceThreshold).toBe(0.6);
    expect(res.body.config.searchRadiusKm).toBe(50);
    expect(res.body.config.minBuyerScore).toBe(0.4);
    expect(res.body.config.rankingWeights).toBeDefined();
    expect(res.body.config.rankingWeights.distance).toBe(0.25);
    expect(res.body.overrides).toEqual({});
  });
});

describe('PATCH /api/v1/config', () => {
  beforeEach(() => {
    clearRuntimeOverrides();
  });

  afterEach(() => {
    clearRuntimeOverrides();
  });

  it('should update valid configuration values', async () => {
    const res = await request(app)
      .patch('/api/v1/config')
      .send({ confidenceThreshold: 0.7, searchRadiusKm: 100 });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Configuration updated successfully');
    expect(res.body.applied.confidenceThreshold).toBe(0.7);
    expect(res.body.applied.searchRadiusKm).toBe(100);

    // Verify the update persists
    const getRes = await request(app).get('/api/v1/config');
    expect(getRes.body.config.confidenceThreshold).toBe(0.7);
    expect(getRes.body.config.searchRadiusKm).toBe(100);
    expect(getRes.body.overrides).toEqual({ confidenceThreshold: 0.7, searchRadiusKm: 100 });
  });

  it('should reject invalid keys', async () => {
    const res = await request(app)
      .patch('/api/v1/config')
      .send({ unknownKey: 123 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Some fields could not be updated');
    expect(res.body.invalidKeys).toContain('unknownKey');
  });

  it('should reject non-numeric values', async () => {
    const res = await request(app)
      .patch('/api/v1/config')
      .send({ confidenceThreshold: 'not-a-number' });

    expect(res.status).toBe(400);
    expect(res.body.invalidValues).toContain('confidenceThreshold');
  });

  it('should reject non-object body', async () => {
    const res = await request(app)
      .patch('/api/v1/config')
      .send('not-json')
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(400);
  });

  it('should reject array body', async () => {
    const res = await request(app)
      .patch('/api/v1/config')
      .send([{ confidenceThreshold: 0.7 }]);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Request body must be a JSON object');
  });
});
