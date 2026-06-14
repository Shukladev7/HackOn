/**
 * Orders route handler.
 *
 * GET /api/v1/orders/:id/history — order decision history (within 2 seconds)
 *
 * Requirements: 10.4
 */
import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { RTOEvent } from '../models/RTOEvent';
import { DecisionRecord } from '../models/DecisionRecord';

const router = Router();

/**
 * Validates that a string is a valid MongoDB ObjectId.
 */
function isValidObjectId(id: string | undefined): boolean {
  if (!id) return false;
  return mongoose.Types.ObjectId.isValid(id);
}

/**
 * GET /api/v1/orders/:id/history
 * Returns decision history for a given order.
 * Must respond within 2 seconds.
 */
router.get('/:id/history', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ error: 'Invalid order ID format' });
    }

    // Find all RTO events associated with this order
    const rtoEvents = await RTOEvent.find({ orderId: id })
      .select('_id shipmentId status receivedAt processedAt decision')
      .sort({ receivedAt: -1 })
      .lean();

    // Get decision records for all RTO events linked to this order
    const rtoEventIds = rtoEvents.map((e) => e._id);
    const decisions = await DecisionRecord.find({ rtoEventId: { $in: rtoEventIds } })
      .sort({ decidedAt: -1 })
      .lean();

    return res.json({
      orderId: id,
      rtoEvents: rtoEvents.map((event) => ({
        rtoEventId: event._id,
        shipmentId: event.shipmentId,
        status: event.status,
        receivedAt: event.receivedAt,
        processedAt: event.processedAt,
        decision: event.decision || null,
      })),
      decisions,
    });
  } catch (error) {
    console.error('[GET /api/v1/orders/:id/history] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
