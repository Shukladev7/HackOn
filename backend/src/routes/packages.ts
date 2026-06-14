/**
 * Packages route handler.
 *
 * GET /api/v1/packages/:id/history — package decision history by shipmentId
 *
 * Requirements: 10.4
 */
import { Router, Request, Response } from 'express';
import { RTOEvent } from '../models/RTOEvent';
import { DecisionRecord } from '../models/DecisionRecord';

const router = Router();

/**
 * GET /api/v1/packages/:id/history
 * Returns decision history for a given package (identified by shipmentId).
 */
router.get('/:id/history', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (!id || id.trim() === '') {
      return res.status(400).json({ error: 'Invalid package/shipment ID' });
    }

    // Find all RTO events associated with this shipment
    const rtoEvents = await RTOEvent.find({ shipmentId: id })
      .select('_id shipmentId orderId status receivedAt processedAt decision')
      .sort({ receivedAt: -1 })
      .lean();

    // Get decision records for all RTO events linked to this shipment
    const rtoEventIds = rtoEvents.map((e) => e._id);
    const decisions = await DecisionRecord.find({ rtoEventId: { $in: rtoEventIds } })
      .sort({ decidedAt: -1 })
      .lean();

    return res.json({
      shipmentId: id,
      rtoEvents: rtoEvents.map((event) => ({
        rtoEventId: event._id,
        orderId: event.orderId,
        status: event.status,
        receivedAt: event.receivedAt,
        processedAt: event.processedAt,
        decision: event.decision || null,
      })),
      decisions,
    });
  } catch (error) {
    console.error('[GET /api/v1/packages/:id/history] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
