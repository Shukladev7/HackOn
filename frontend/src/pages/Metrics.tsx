import { useState, useEffect, useCallback } from 'react';
import apiClient from '../api/client';

interface SystemMetrics {
  rtoReductionRate: number;
  reverseLogisticsSavings: number;
  deliverySuccessRate: number;
  inventoryRecoveryRate: number;
  co2Reduction: number;
  customerSatisfaction: number;
}

interface AnomalyAlert {
  metricName: string;
  currentValue: number;
  expectedRange: { low: number; high: number };
  deviationMagnitude: number;
  detectedAt: string;
}

type Period = 'daily' | 'weekly' | 'monthly';

const METRIC_LABELS: Record<keyof SystemMetrics, { label: string; unit: string; badge: string }> = {
  rtoReductionRate: { label: 'RTO Reduction Rate', unit: '%', badge: 'RTO' },
  reverseLogisticsSavings: { label: 'Logistics Savings', unit: '/pkg', badge: 'SAVINGS' },
  deliverySuccessRate: { label: 'Delivery Success', unit: '%', badge: 'DELIVERY' },
  inventoryRecoveryRate: { label: 'Inventory Recovery', unit: '%', badge: 'RECOVERY' },
  co2Reduction: { label: 'CO2 Saved', unit: 'kg/pkg', badge: 'CO2' },
  customerSatisfaction: { label: 'CSAT Score', unit: '/5', badge: 'CSAT' },
};

export default function Metrics() {
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [comparison, setComparison] = useState<{ current: SystemMetrics; previous: SystemMetrics; change: Record<string, number> } | null>(null);
  const [anomalies, setAnomalies] = useState<AnomalyAlert[]>([]);
  const [period, setPeriod] = useState<Period>('weekly');
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [metricsRes, compareRes, anomalyRes] = await Promise.all([
        apiClient.get('/metrics', { params: { window: period } }),
        apiClient.get('/metrics/compare', { params: { period } }),
        apiClient.get('/metrics/anomalies'),
      ]);
      setMetrics(metricsRes.data.metrics);
      setComparison({ current: compareRes.data.current, previous: compareRes.data.previous, change: compareRes.data.change });
      setAnomalies(anomalyRes.data.anomalies ?? []);
    } catch (err) {
      console.error('Failed to fetch metrics', err);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ margin: 0, color: '#0F1111', fontWeight: 700, fontSize: '21px' }}>Performance Metrics</h1>
          <p style={{ margin: '0.25rem 0 0', color: '#565959', fontSize: '14px' }}>Performance analytics and anomaly detection</p>
        </div>
        <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: '1px solid #D5D9D9' }}>
          {(['daily', 'weekly', 'monthly'] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              style={{
                padding: '0.4rem 0.75rem',
                border: 'none',
                cursor: 'pointer',
                fontSize: '13px',
                background: period === p ? '#FF9900' : '#FFFFFF',
                color: period === p ? '#0F1111' : '#565959',
                fontWeight: period === p ? 600 : 400,
              }}
            >
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {loading && !metrics ? (
        <p style={{ color: '#565959' }}>Loading metrics...</p>
      ) : metrics ? (
        <>
          {/* Metrics Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
            {(Object.keys(METRIC_LABELS) as (keyof SystemMetrics)[]).map((key) => {
              const { label, unit, badge } = METRIC_LABELS[key];
              const value = metrics[key];
              const change = comparison?.change?.[key] ?? 0;
              const prev = comparison?.previous?.[key] ?? 0;
              return (
                <div key={key} style={{
                  background: '#FFFFFF',
                  borderRadius: 8,
                  padding: '1.25rem',
                  border: '1px solid #D5D9D9',
                  boxShadow: '0 2px 5px rgba(0,0,0,0.05)',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <span style={{ fontSize: '13px', color: '#565959' }}>{label}</span>
                    <span style={{
                      fontSize: '11px',
                      fontWeight: 700,
                      padding: '0.15rem 0.5rem',
                      borderRadius: 4,
                      background: 'rgba(255,153,0,0.1)',
                      color: '#FF9900',
                      letterSpacing: '0.5px',
                    }}>
                      {badge}
                    </span>
                  </div>
                  <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#FF9900' }}>
                    {value.toFixed(2)}{unit}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem' }}>
                    <span style={{ fontSize: '13px', color: change >= 0 ? '#007600' : '#B12704' }}>
                      {change >= 0 ? '\u25B2' : '\u25BC'} {Math.abs(change).toFixed(1)}% vs prev {period}
                    </span>
                    <span style={{ fontSize: '12px', color: '#767676' }}>
                      prev: {prev.toFixed(2)}{unit}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Anomaly Alerts */}
          <h2 style={{ fontSize: '21px', marginBottom: '0.75rem', color: '#0F1111', fontWeight: 700 }}>Anomaly Alerts</h2>
          {anomalies.length === 0 ? (
            <div style={{
              background: '#FFFFFF',
              borderRadius: 8,
              padding: '2rem',
              textAlign: 'center',
              color: '#565959',
              border: '1px solid #D5D9D9',
              boxShadow: '0 2px 5px rgba(0,0,0,0.05)',
            }}>
              No active anomalies. All metrics within expected ranges.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {anomalies.map((alert, i) => (
                <div key={i} style={{
                  background: '#FFFFFF',
                  borderRadius: 8,
                  padding: '1rem',
                  borderLeft: '4px solid #B12704',
                  border: '1px solid #D5D9D9',
                  boxShadow: '0 2px 5px rgba(0,0,0,0.05)',
                }}>
                  <div style={{ fontWeight: 600, fontSize: '14px', color: '#0F1111' }}>{alert.metricName.replace(/([A-Z])/g, ' $1').trim()}</div>
                  <div style={{ fontSize: '13px', color: '#565959', marginTop: '0.25rem' }}>
                    Current: {alert.currentValue.toFixed(2)} | Expected: {alert.expectedRange.low.toFixed(2)} - {alert.expectedRange.high.toFixed(2)} | Deviation: {alert.deviationMagnitude.toFixed(1)} sigma
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <p style={{ color: '#565959' }}>No metrics data available. Try loading sample data first.</p>
      )}
    </div>
  );
}
