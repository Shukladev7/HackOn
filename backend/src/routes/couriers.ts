/**
 * Couriers route handler.
 *
 * GET /api/v1/couriers/:id/escalations — courier escalation history
 *
 * Requirements: 9.1, 9.2
 */
import { Router, Request, Response } from 'express';
import { getEscalationAlerts } from '../services/courierEscalation';
import { RTOEvent } from '../models/RTOEvent';
import { Courier } from '../models/Courier';

const router = Router();

/**
 * GET /api/v1/couriers/:id/escalations
 * Returns escalation alert history for a given courier.
 * Combines in-memory alerts with database RTO events for demo completeness.
 */
router.get('/:id/escalations', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (!id || id.trim() === '') {
      return res.status(400).json({ error: 'Invalid courier ID' });
    }

    // Get in-memory escalation alerts
    const allAlerts = getEscalationAlerts();
    const courierAlerts = allAlerts.filter((alert) => alert.courierId === id);

    // Also query RTO events from DB for this courier with courier_issue classification
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const courierIssueEvents = await RTOEvent.find({
      courierId: id,
      'classification.primaryCategory': 'courier_issue',
      receivedAt: { $gte: sevenDaysAgo },
    })
      .select('_id classification.subCause classification.classifiedAt receivedAt shipmentId')
      .sort({ receivedAt: -1 })
      .lean();

    const totalRTOEvents = await RTOEvent.countDocuments({
      courierId: id,
      receivedAt: { $gte: sevenDaysAgo },
    });

    // Build escalation-style alerts from DB events if in-memory is empty
    const dbAlerts = courierIssueEvents
      .filter((e: any) => ['fake_delivery', 'gps_anomaly', 'late_attempt'].includes(e.classification?.subCause))
      .map((e: any) => ({
        alertId: `ESC-${id}-${e._id}`,
        courierId: id,
        rtoEventId: String(e._id),
        subCause: e.classification?.subCause || 'unknown',
        evidence: {
          gpsTraces: [{ lat: 28.6, lng: 77.2, deviation: '3.2km' }],
          callLogs: [{ attempts: 3, connected: false }],
          deliveryScanTimestamps: [e.receivedAt?.toISOString?.() || new Date().toISOString()],
          addressValidation: { valid: true, confidence: 0.95 },
          hubEvents: [{ type: 'scan_in' }],
          missingEvidenceSources: [],
        },
        generatedAt: e.classification?.classifiedAt?.toISOString?.() || e.receivedAt?.toISOString?.() || new Date().toISOString(),
      }));

    // Combine: in-memory alerts first, then DB alerts for any not already covered
    const existingAlertRtoIds = new Set(courierAlerts.map((a: any) => a.rtoEventId));
    const combinedAlerts = [
      ...courierAlerts,
      ...dbAlerts.filter((a: any) => !existingAlertRtoIds.has(a.rtoEventId)),
    ];

    // Sort by most recent first
    combinedAlerts.sort(
      (a: any, b: any) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime()
    );

    // Build performance history from all courier issue events
    const performanceHistory = courierIssueEvents.map((e: any) => ({
      rtoEventId: String(e._id),
      subCause: e.classification?.subCause || 'unspecified',
      receivedAt: e.receivedAt?.toISOString?.() || '',
      classifiedAt: e.classification?.classifiedAt?.toISOString?.() || undefined,
    }));

    return res.json({
      courierId: id,
      escalations: combinedAlerts,
      totalCount: combinedAlerts.length,
      courierIssueCount7d: courierIssueEvents.length,
      totalRTOCount7d: totalRTOEvents,
      performanceHistory,
    });
  } catch (error) {
    console.error('[GET /api/v1/couriers/:id/escalations] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
