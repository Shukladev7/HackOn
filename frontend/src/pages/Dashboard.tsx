import { useState, useEffect, useCallback, useRef } from 'react';
import apiClient from '../api/client';

// ─── Types ───────────────────────────────────────────────────────────────────

interface SystemMetrics {
  rtoReductionRate: number;
  reverseLogisticsSavings: number;
  deliverySuccessRate: number;
  inventoryRecoveryRate: number;
  co2Reduction: number;
  customerSatisfaction: number;
}

interface HistoricalComparison {
  current: SystemMetrics;
  previous: SystemMetrics;
  change: Record<keyof SystemMetrics, number>;
}

interface AnomalyAlert {
  metricName: string;
  currentValue: number;
  expectedRange: { low: number; high: number };
  deviationMagnitude: number;
  detectedAt: string;
}

type Period = 'daily' | 'weekly' | 'monthly';

// ─── Metric display configuration ───────────────────────────────────────────

interface MetricConfig {
  key: keyof SystemMetrics;
  label: string;
  unit: string;
  badge: string;
}

const METRIC_CONFIGS: MetricConfig[] = [
  { key: 'rtoReductionRate', label: 'RTO Reduction Rate', unit: '%', badge: 'RTO' },
  { key: 'reverseLogisticsSavings', label: 'Reverse Logistics Savings', unit: '/pkg', badge: 'SAVINGS' },
  { key: 'deliverySuccessRate', label: 'Delivery Success Rate', unit: '%', badge: 'DELIVERY' },
  { key: 'inventoryRecoveryRate', label: 'Inventory Recovery Rate', unit: '%', badge: 'RECOVERY' },
  { key: 'co2Reduction', label: 'CO2 Reduction', unit: 'kg/pkg', badge: 'CO2' },
  { key: 'customerSatisfaction', label: 'Customer Satisfaction', unit: '/5', badge: 'CSAT' },
];

const REFRESH_OPTIONS = [
  { label: '10s', value: 10000 },
  { label: '30s', value: 30000 },
  { label: '1m', value: 60000 },
  { label: '5m', value: 300000 },
  { label: 'Off', value: 0 },
];

const LIVE_EVENTS = [
  { id: 'EVT-7841', action: 'redeliver', cause: 'customer_not_home', time: '2s ago' },
  { id: 'EVT-7840', action: 'reallocate', cause: 'address_incorrect', time: '8s ago' },
  { id: 'EVT-7839', action: 'warehouse_return', cause: 'fraud_suspected', time: '15s ago' },
  { id: 'EVT-7838', action: 'redeliver', cause: 'courier_delay', time: '22s ago' },
  { id: 'EVT-7837', action: 'reallocate', cause: 'refused_delivery', time: '31s ago' },
];

// ─── Helper functions ────────────────────────────────────────────────────────

function getSeverity(deviationMagnitude: number): 'high' | 'medium' | 'low' {
  if (deviationMagnitude >= 4) return 'high';
  if (deviationMagnitude >= 3) return 'medium';
  return 'low';
}

function formatMetricName(name: string): string {
  return name
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
}

function formatTimestamp(isoStr: string): string {
  const date = new Date(isoStr);
  return date.toLocaleString();
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [comparison, setComparison] = useState<HistoricalComparison | null>(null);
  const [anomalies, setAnomalies] = useState<AnomalyAlert[]>([]);
  const [period, setPeriod] = useState<Period>('weekly');
  const [refreshInterval, setRefreshInterval] = useState(30000);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const [compRes, anomalyRes] = await Promise.all([
        apiClient.get('/metrics/compare', { params: { period } }),
        apiClient.get('/metrics/anomalies'),
      ]);
      const compData = compRes.data;
      setComparison({ current: compData.current, previous: compData.previous, change: compData.change });
      setAnomalies(anomalyRes.data.anomalies ?? []);
      setLastUpdated(new Date());
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch metrics';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    setLoading(true);
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (refreshInterval > 0) {
      intervalRef.current = setInterval(fetchData, refreshInterval);
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [refreshInterval, fetchData]);

  return (
    <div>
      {/* Hero Banner */}
      <div style={{
        background: 'linear-gradient(135deg, #f0f4f8 0%, #e2e8f0 100%)',
        borderRadius: 8,
        padding: '2rem 2.5rem',
        marginBottom: '1.5rem',
        border: '1px solid #D5D9D9',
      }}>
        <h1 style={{ margin: 0, fontSize: '21px', color: '#0F1111', fontWeight: 700 }}>
          Welcome to RTO Operations Console
        </h1>
        <p style={{ margin: '0.5rem 0 0', fontSize: '14px', color: '#565959' }}>
          Real-time monitoring and intelligence for delivery exception management
        </p>
        {lastUpdated && (
          <span style={{ fontSize: '12px', color: '#767676', marginTop: '0.5rem', display: 'block' }}>
            Last sync: {lastUpdated.toLocaleTimeString()}
          </span>
        )}
      </div>

      {/* Controls */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '1.25rem',
        flexWrap: 'wrap',
        gap: '0.75rem',
      }}>
        <h2 style={{ margin: 0, fontSize: '21px', color: '#0F1111', fontWeight: 700 }}>
          Operations Overview
        </h2>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: '1px solid #D5D9D9' }}>
            {(['daily', 'weekly', 'monthly'] as Period[]).map((p) => (
              <button
                key={p}
                style={{
                  padding: '0.4rem 0.75rem',
                  border: 'none',
                  background: period === p ? '#FF9900' : '#FFFFFF',
                  color: period === p ? '#0F1111' : '#565959',
                  cursor: 'pointer',
                  fontSize: '13px',
                  fontWeight: period === p ? 600 : 400,
                }}
                onClick={() => setPeriod(p)}
                aria-pressed={period === p}
              >
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            ))}
          </div>
          <span style={{ fontSize: '13px', color: '#565959' }}>Refresh:</span>
          <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: '1px solid #D5D9D9' }}>
            {REFRESH_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                style={{
                  padding: '0.4rem 0.6rem',
                  border: 'none',
                  background: refreshInterval === opt.value ? '#FF9900' : '#FFFFFF',
                  color: refreshInterval === opt.value ? '#0F1111' : '#565959',
                  cursor: 'pointer',
                  fontSize: '12px',
                  fontWeight: refreshInterval === opt.value ? 600 : 400,
                }}
                onClick={() => setRefreshInterval(opt.value)}
                aria-pressed={refreshInterval === opt.value}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div style={{
          background: '#FFFFFF',
          color: '#B12704',
          padding: '0.75rem 1rem',
          borderRadius: 8,
          marginBottom: '1rem',
          fontSize: '14px',
          border: '1px solid #D5D9D9',
          borderLeft: '4px solid #B12704',
        }}>
          {error}
        </div>
      )}

      {/* Loading state */}
      {loading && !comparison && (
        <div style={{ padding: '2rem', textAlign: 'center', color: '#565959' }}>Loading metrics...</div>
      )}

      {/* KPI Metrics Grid */}
      {comparison && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: '1rem',
          marginBottom: '2rem',
        }}>
          {METRIC_CONFIGS.map((config) => {
            const value = comparison.current[config.key];
            const change = comparison.change[config.key];
            const isPositive = change >= 0;

            return (
              <div key={config.key} style={{
                background: '#FFFFFF',
                borderRadius: 8,
                padding: '1.25rem',
                border: '1px solid #D5D9D9',
                boxShadow: '0 2px 5px rgba(0,0,0,0.05)',
                transition: 'box-shadow 0.2s',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <span style={{ fontSize: '13px', color: '#565959' }}>{config.label}</span>
                  <span style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    padding: '0.15rem 0.5rem',
                    borderRadius: 4,
                    background: 'rgba(255,153,0,0.1)',
                    color: '#FF9900',
                    letterSpacing: '0.5px',
                  }}>
                    {config.badge}
                  </span>
                </div>
                <div style={{
                  fontSize: '1.75rem',
                  fontWeight: 700,
                  color: '#FF9900',
                  margin: '0.25rem 0',
                }}>
                  {value.toFixed(2)}{config.unit}
                </div>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginTop: '0.5rem',
                }}>
                  <span style={{ fontSize: '13px', color: isPositive ? '#007600' : '#B12704' }}>
                    {isPositive ? '\u25B2' : '\u25BC'} {Math.abs(change).toFixed(1)}% vs prev {period}
                  </span>
                </div>
                <span style={{ fontSize: '12px', color: '#007185', cursor: 'pointer', marginTop: '0.5rem', display: 'inline-block' }}>
                  View details &rsaquo;
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Anomaly Alerts */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <h2 style={{ margin: 0, fontSize: '21px', color: '#0F1111', fontWeight: 700 }}>Active Anomaly Alerts</h2>
        <span style={{ fontSize: '13px', color: '#007185', cursor: 'pointer' }}>See all &rsaquo;</span>
      </div>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '2rem' }}>
          {anomalies.map((alert, idx) => {
            const severity = getSeverity(alert.deviationMagnitude);
            const borderColor = severity === 'high' ? '#B12704' : severity === 'medium' ? '#c45500' : '#FF9900';
            return (
              <div key={idx} style={{
                background: '#FFFFFF',
                borderRadius: 8,
                padding: '1rem 1.25rem',
                border: '1px solid #D5D9D9',
                borderLeft: `4px solid ${borderColor}`,
                boxShadow: '0 2px 5px rgba(0,0,0,0.05)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '0.5rem',
              }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  <span style={{ fontWeight: 600, fontSize: '14px', color: '#0F1111' }}>
                    {formatMetricName(alert.metricName)}
                  </span>
                  <span style={{ fontSize: '13px', color: '#565959' }}>
                    Current: {alert.currentValue.toFixed(2)} | Expected: {alert.expectedRange.low.toFixed(2)} - {alert.expectedRange.high.toFixed(2)} | Deviation: {alert.deviationMagnitude.toFixed(1)} sigma
                  </span>
                  <span style={{ fontSize: '12px', color: '#767676' }}>
                    Detected: {formatTimestamp(alert.detectedAt)}
                  </span>
                </div>
                <span style={{
                  padding: '0.2rem 0.6rem',
                  borderRadius: 12,
                  fontSize: '11px',
                  fontWeight: 600,
                  background: severity === 'high' ? '#FEF0EF' : severity === 'medium' ? '#FFF8E1' : '#FFF3E0',
                  color: borderColor,
                  textTransform: 'uppercase',
                }}>
                  {severity}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Live Event Feed */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', marginTop: '2rem' }}>
        <h2 style={{ margin: 0, fontSize: '21px', color: '#0F1111', fontWeight: 700 }}>Live Event Feed</h2>
        <span style={{ fontSize: '13px', color: '#007185', cursor: 'pointer' }}>See all &rsaquo;</span>
      </div>
      <div style={{
        background: '#FFFFFF',
        borderRadius: 8,
        border: '1px solid #D5D9D9',
        boxShadow: '0 2px 5px rgba(0,0,0,0.05)',
        overflow: 'hidden',
      }}>
        {LIVE_EVENTS.map((evt) => (
          <div
            key={evt.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '1rem',
              padding: '0.7rem 1.25rem',
              borderBottom: '1px solid #D5D9D9',
              fontSize: '14px',
            }}
          >
            <span style={{ color: '#565959', fontSize: '13px', minWidth: 70, fontWeight: 500 }}>{evt.id}</span>
            <span style={{
              padding: '0.15rem 0.5rem',
              borderRadius: 4,
              fontSize: '12px',
              fontWeight: 600,
              background: evt.action === 'redeliver' ? '#E7F7EF' : evt.action === 'reallocate' ? '#FFF3E0' : '#FEF0EF',
              color: evt.action === 'redeliver' ? '#007600' : evt.action === 'reallocate' ? '#c45500' : '#B12704',
            }}>
              {evt.action}
            </span>
            <span style={{ color: '#0F1111', flex: 1 }}>{evt.cause.replace(/_/g, ' ')}</span>
            <span style={{ color: '#767676', fontSize: '12px' }}>{evt.time}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
