/**
 * Unit tests for metrics routes.
 *
 * Validates: Requirements 13.1, 13.3
 *  - GET /api/v1/metrics — returns current system metrics with optional window parameter
 *  - GET /api/v1/metrics/compare — returns period-over-period comparison
 *  - GET /api/v1/metrics/anomalies — returns active anomaly alerts
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express, { Express } from 'express';
import metricsRouter, { setMetricsService } from './metrics';
import { MetricsService, SystemMetrics, HistoricalComparison, AnomalyAlert } from '../services/metricsService';

// Helper to make requests without supertest (using the app directly)
async function makeRequest(app: Express, method: 'GET', path: string): Promise<{
  status: number;
  body: any;
}> {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      const url = `http://127.0.0.1:${port}${path}`;

      fetch(url, { method })
        .then(async (res) => {
          const body = await res.json();
          server.close();
          resolve({ status: res.status, body });
        })
        .catch((err) => {
          server.close();
          resolve({ status: 500, body: { error: err.message } });
        });
    });
  });
}

function createTestApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/metrics', metricsRouter);
  return app;
}

function makeMockMetrics(overrides?: Partial<SystemMetrics>): SystemMetrics {
  return {
    rtoReductionRate: 45.5,
    reverseLogisticsSavings: 90.0,
    deliverySuccessRate: 72.3,
    inventoryRecoveryRate: 38.1,
    co2Reduction: 15.6,
    customerSatisfaction: 3.91,
    ...overrides,
  };
}

describe('Metrics Routes', () => {
  let app: Express;
  let mockService: MetricsService;

  beforeEach(() => {
    mockService = {
      getCurrentMetrics: vi.fn().mockResolvedValue(makeMockMetrics()),
      getHistoricalComparison: vi.fn().mockResolvedValue({
        current: makeMockMetrics(),
        previous: makeMockMetrics({ rtoReductionRate: 40.0 }),
        change: {
          rtoReductionRate: 13.75,
          reverseLogisticsSavings: 0,
          deliverySuccessRate: 0,
          inventoryRecoveryRate: 0,
          co2Reduction: 0,
          customerSatisfaction: 0,
        },
      } as HistoricalComparison),
      checkAnomalies: vi.fn().mockResolvedValue([]),
    } as unknown as MetricsService;

    setMetricsService(mockService);
    app = createTestApp();
  });

  afterEach(() => {
    setMetricsService(null);
    vi.restoreAllMocks();
  });

  describe('GET /api/v1/metrics', () => {
    it('should return 200 with current metrics using default weekly window', async () => {
      const res = await makeRequest(app, 'GET', '/api/v1/metrics');

      expect(res.status).toBe(200);
      expect(res.body.window).toBe('weekly');
      expect(res.body.metrics).toBeDefined();
      expect(res.body.metrics.rtoReductionRate).toBe(45.5);
      expect(res.body.metrics.reverseLogisticsSavings).toBe(90.0);
      expect(res.body.metrics.deliverySuccessRate).toBe(72.3);
      expect(res.body.metrics.inventoryRecoveryRate).toBe(38.1);
      expect(res.body.metrics.co2Reduction).toBe(15.6);
      expect(res.body.metrics.customerSatisfaction).toBe(3.91);
      expect(res.body.timestamp).toBeDefined();
      expect(mockService.getCurrentMetrics).toHaveBeenCalledWith('weekly');
    });

    it('should accept window=daily query parameter', async () => {
      const res = await makeRequest(app, 'GET', '/api/v1/metrics?window=daily');

      expect(res.status).toBe(200);
      expect(res.body.window).toBe('daily');
      expect(mockService.getCurrentMetrics).toHaveBeenCalledWith('daily');
    });

    it('should accept window=weekly query parameter', async () => {
      const res = await makeRequest(app, 'GET', '/api/v1/metrics?window=weekly');

      expect(res.status).toBe(200);
      expect(res.body.window).toBe('weekly');
      expect(mockService.getCurrentMetrics).toHaveBeenCalledWith('weekly');
    });

    it('should accept window=monthly query parameter', async () => {
      const res = await makeRequest(app, 'GET', '/api/v1/metrics?window=monthly');

      expect(res.status).toBe(200);
      expect(res.body.window).toBe('monthly');
      expect(mockService.getCurrentMetrics).toHaveBeenCalledWith('monthly');
    });

    it('should return 400 for invalid window parameter', async () => {
      const res = await makeRequest(app, 'GET', '/api/v1/metrics?window=yearly');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid window parameter');
    });

    it('should return 500 when service throws an error', async () => {
      vi.mocked(mockService.getCurrentMetrics).mockRejectedValue(new Error('DB connection failed'));

      const res = await makeRequest(app, 'GET', '/api/v1/metrics');

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Internal server error');
    });
  });

  describe('GET /api/v1/metrics/compare', () => {
    it('should return 200 with period-over-period comparison for daily', async () => {
      const res = await makeRequest(app, 'GET', '/api/v1/metrics/compare?period=daily');

      expect(res.status).toBe(200);
      expect(res.body.period).toBe('daily');
      expect(res.body.current).toBeDefined();
      expect(res.body.previous).toBeDefined();
      expect(res.body.change).toBeDefined();
      expect(res.body.timestamp).toBeDefined();
      expect(mockService.getHistoricalComparison).toHaveBeenCalledWith('daily');
    });

    it('should return 200 with weekly comparison', async () => {
      const res = await makeRequest(app, 'GET', '/api/v1/metrics/compare?period=weekly');

      expect(res.status).toBe(200);
      expect(res.body.period).toBe('weekly');
      expect(mockService.getHistoricalComparison).toHaveBeenCalledWith('weekly');
    });

    it('should return 200 with monthly comparison', async () => {
      const res = await makeRequest(app, 'GET', '/api/v1/metrics/compare?period=monthly');

      expect(res.status).toBe(200);
      expect(res.body.period).toBe('monthly');
      expect(mockService.getHistoricalComparison).toHaveBeenCalledWith('monthly');
    });

    it('should return 400 when period is missing', async () => {
      const res = await makeRequest(app, 'GET', '/api/v1/metrics/compare');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Missing or invalid period parameter');
    });

    it('should return 400 for invalid period parameter', async () => {
      const res = await makeRequest(app, 'GET', '/api/v1/metrics/compare?period=yearly');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Missing or invalid period parameter');
    });

    it('should return 500 when service throws an error', async () => {
      vi.mocked(mockService.getHistoricalComparison).mockRejectedValue(new Error('DB timeout'));

      const res = await makeRequest(app, 'GET', '/api/v1/metrics/compare?period=daily');

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Internal server error');
    });
  });

  describe('GET /api/v1/metrics/anomalies', () => {
    it('should return 200 with empty anomalies when none detected', async () => {
      const res = await makeRequest(app, 'GET', '/api/v1/metrics/anomalies');

      expect(res.status).toBe(200);
      expect(res.body.anomalies).toEqual([]);
      expect(res.body.count).toBe(0);
      expect(res.body.timestamp).toBeDefined();
    });

    it('should return 200 with anomaly alerts when detected', async () => {
      const mockAnomalies: AnomalyAlert[] = [
        {
          metricName: 'rtoReductionRate',
          currentValue: 10.0,
          expectedRange: { low: 35.0, high: 55.0 },
          deviationMagnitude: 3.5,
          detectedAt: '2024-01-15T10:00:00.000Z',
        },
        {
          metricName: 'deliverySuccessRate',
          currentValue: 95.0,
          expectedRange: { low: 60.0, high: 80.0 },
          deviationMagnitude: 2.8,
          detectedAt: '2024-01-15T10:00:00.000Z',
        },
      ];
      vi.mocked(mockService.checkAnomalies).mockResolvedValue(mockAnomalies);

      const res = await makeRequest(app, 'GET', '/api/v1/metrics/anomalies');

      expect(res.status).toBe(200);
      expect(res.body.anomalies).toHaveLength(2);
      expect(res.body.count).toBe(2);
      expect(res.body.anomalies[0].metricName).toBe('rtoReductionRate');
      expect(res.body.anomalies[0].deviationMagnitude).toBe(3.5);
      expect(res.body.anomalies[1].metricName).toBe('deliverySuccessRate');
    });

    it('should return 500 when service throws an error', async () => {
      vi.mocked(mockService.checkAnomalies).mockRejectedValue(new Error('Calculation failed'));

      const res = await makeRequest(app, 'GET', '/api/v1/metrics/anomalies');

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Internal server error');
    });
  });
});
