/**
 * Metrics route handler.
 *
 * Exposes:
 *  - GET /api/v1/metrics — current system metrics (optional ?window=daily|weekly|monthly)
 *  - GET /api/v1/metrics/compare — period-over-period comparison (?period=daily|weekly|monthly)
 *  - GET /api/v1/metrics/anomalies — active anomaly alerts
 *
 * Validates: Requirements 13.1, 13.3
 */
import { Router, Request, Response } from 'express';
import { MetricsService } from '../services/metricsService';

const router = Router();

// Singleton service instance for the route
let metricsServiceInstance: MetricsService | null = null;

const VALID_WINDOWS = ['daily', 'weekly', 'monthly'] as const;
type MetricsWindow = (typeof VALID_WINDOWS)[number];

function isValidWindow(value: unknown): value is MetricsWindow {
  return typeof value === 'string' && VALID_WINDOWS.includes(value as MetricsWindow);
}

/**
 * Get or create the MetricsService singleton.
 */
function getService(): MetricsService {
  if (!metricsServiceInstance) {
    metricsServiceInstance = new MetricsService();
  }
  return metricsServiceInstance;
}

/**
 * Allows injecting a custom MetricsService (useful for testing).
 */
export function setMetricsService(service: MetricsService | null): void {
  metricsServiceInstance = service;
}

/**
 * GET /api/v1/metrics
 *
 * Returns current system metrics for the specified time window.
 * Query params:
 *  - window (optional): 'daily' | 'weekly' | 'monthly' (default: 'weekly')
 *
 * Requirement 13.1
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const windowParam = req.query.window;

    // Default to 'weekly' if not provided
    const window: MetricsWindow = isValidWindow(windowParam) ? windowParam : 'weekly';

    // If an invalid window was explicitly provided, return 400
    if (windowParam !== undefined && !isValidWindow(windowParam)) {
      return res.status(400).json({
        error: `Invalid window parameter. Must be one of: ${VALID_WINDOWS.join(', ')}`,
      });
    }

    const service = getService();
    const metrics = await service.getCurrentMetrics(window);

    return res.status(200).json({
      window,
      metrics,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[GET /api/v1/metrics] Unexpected error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/v1/metrics/compare
 *
 * Returns period-over-period comparison for the specified period.
 * Query params:
 *  - period (required): 'daily' | 'weekly' | 'monthly'
 *
 * Requirement 13.3
 */
router.get('/compare', async (req: Request, res: Response) => {
  try {
    const periodParam = req.query.period;

    if (!periodParam || !isValidWindow(periodParam)) {
      return res.status(400).json({
        error: `Missing or invalid period parameter. Must be one of: ${VALID_WINDOWS.join(', ')}`,
      });
    }

    const service = getService();
    const comparison = await service.getHistoricalComparison(periodParam);

    return res.status(200).json({
      period: periodParam,
      ...comparison,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[GET /api/v1/metrics/compare] Unexpected error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/v1/metrics/anomalies
 *
 * Returns active anomaly alerts.
 * An anomaly is detected when a metric deviates > 2 standard deviations
 * from its 30-day moving average.
 *
 * Requirements 13.4, 13.5
 */
router.get('/anomalies', async (req: Request, res: Response) => {
  try {
    const service = getService();
    const anomalies = await service.checkAnomalies();

    return res.status(200).json({
      anomalies,
      count: anomalies.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[GET /api/v1/metrics/anomalies] Unexpected error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
