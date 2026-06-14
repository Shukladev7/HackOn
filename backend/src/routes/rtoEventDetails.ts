/**
 * RTO Event detail routes.
 *
 * GET /api/v1/rto-events/:id — event details
 * GET /api/v1/rto-events/:id/decision — decision record for event
 * GET /api/v1/rto-events/:id/timeline — full event timeline
 * GET /api/v1/rto-events/:id/reasoning — AI reasoning stream & feature importance
 *
 * Requirements: 10.4
 */
import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { RTOEvent } from '../models/RTOEvent';
import { DecisionRecord } from '../models/DecisionRecord';
import { EventStream } from '../models/EventStream';
import { generateReasoningFromEvent } from '../services/reasoningGenerator';

const router = Router();

/**
 * Validates that a string is a valid MongoDB ObjectId.
 */
function isValidObjectId(id: string | undefined): boolean {
  if (!id) return false;
  return mongoose.Types.ObjectId.isValid(id);
}

/**
 * GET /api/v1/rto-events/:id
 * Returns the full RTO event document.
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ error: 'Invalid event ID format' });
    }

    const event = await RTOEvent.findById(id).lean();

    if (!event) {
      return res.status(404).json({ error: 'RTO event not found' });
    }

    return res.json(event);
  } catch (error) {
    console.error('[GET /api/v1/rto-events/:id] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/v1/rto-events/:id/decision
 * Returns the decision record associated with an RTO event.
 */
router.get('/:id/decision', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ error: 'Invalid event ID format' });
    }

    const decision = await DecisionRecord.findOne({ rtoEventId: id }).lean();

    if (!decision) {
      return res.status(404).json({ error: 'Decision record not found for this event' });
    }

    return res.json(decision);
  } catch (error) {
    console.error('[GET /api/v1/rto-events/:id/decision] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/v1/rto-events/:id/timeline
 * Returns the full event timeline (all EventStream entries) for an RTO event.
 */
router.get('/:id/timeline', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ error: 'Invalid event ID format' });
    }

    // Verify the event exists
    const eventExists = await RTOEvent.exists({ _id: id });
    if (!eventExists) {
      return res.status(404).json({ error: 'RTO event not found' });
    }

    const timeline = await EventStream.find({ sourceEntityId: id })
      .sort({ timestamp: 1 })
      .lean();

    return res.json({ rtoEventId: id, events: timeline });
  } catch (error) {
    console.error('[GET /api/v1/rto-events/:id/timeline] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/v1/rto-events/:id/reasoning
 * Returns AI reasoning stream and SHAP-style feature importance for an RTO event.
 */
router.get('/:id/reasoning', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ error: 'Invalid event ID format' });
    }

    const event = await RTOEvent.findById(id).lean();

    if (!event) {
      return res.status(404).json({ error: 'RTO event not found' });
    }

    const reasoning = generateReasoningFromEvent(event as any);

    return res.json(reasoning);
  } catch (error) {
    console.error('[GET /api/v1/rto-events/:id/reasoning] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
