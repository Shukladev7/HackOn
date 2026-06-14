/**
 * RTO Events route handler.
 *
 * Exposes POST /api/v1/rto-events for receiving RTO event payloads
 * from logistics partners.
 *
 * Validates: Requirements 10.1, 10.2, 11.1
 */
import { Router, Request, Response } from 'express';
import { EventIngressService } from '../services/eventIngress';
import { RTOEvent } from '../models/RTOEvent';

const router = Router();

// Singleton service instance for the route
let eventIngressService: EventIngressService | null = null;

/**
 * Get or create the EventIngressService singleton.
 * Allows injection for testing via setEventIngressService.
 */
function getService(): EventIngressService {
  if (!eventIngressService) {
    eventIngressService = new EventIngressService();
  }
  return eventIngressService;
}

/**
 * Allows injecting a custom EventIngressService (useful for testing).
 */
export function setEventIngressService(service: EventIngressService | null): void {
  eventIngressService = service;
}

/**
 * GET /api/v1/rto-events
 *
 * Lists RTO events with optional filtering by status, rootCause, date range.
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { status, rootCause, startDate, endDate } = req.query;
    const filter: Record<string, unknown> = {};

    if (status && typeof status === 'string') {
      filter.status = status;
    }
    if (rootCause && typeof rootCause === 'string') {
      filter['classification.primaryCategory'] = rootCause;
    }
    if (startDate || endDate) {
      filter.receivedAt = {};
      if (startDate) (filter.receivedAt as Record<string, unknown>).$gte = new Date(startDate as string);
      if (endDate) (filter.receivedAt as Record<string, unknown>).$lte = new Date(endDate as string);
    }

    const events = await RTOEvent.find(filter)
      .sort({ receivedAt: -1 })
      .limit(100)
      .lean();

    return res.json({ events, totalCount: events.length });
  } catch (error) {
    console.error('[GET /api/v1/rto-events] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/v1/rto-events
 *
 * Receives an RTO event payload from a logistics partner.
 * Validates the schema, deduplicates, and publishes to Redis Stream.
 *
 * Response:
 * - 201: { eventId, accepted: true }
 * - 400: { eventId: '', accepted: false, errors: [...] }
 * - 409: { eventId: '', accepted: false, errors: ['Duplicate event...'] }
 * - 500: { eventId: '', accepted: false, errors: ['Internal server error'] }
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const service = getService();
    const result = await service.receiveEvent(req.body);

    if (result.accepted) {
      return res.status(201).json({
        eventId: result.eventId,
        accepted: result.accepted,
      });
    }

    // Determine status code based on error type
    const isDuplicate = result.errors?.some((e) => e.includes('Duplicate event'));
    const statusCode = isDuplicate ? 409 : 400;

    return res.status(statusCode).json(result);
  } catch (error) {
    console.error('[POST /api/v1/rto-events] Unexpected error:', error);
    return res.status(500).json({
      eventId: '',
      accepted: false,
      errors: ['Internal server error'],
    });
  }
});

export default router;
