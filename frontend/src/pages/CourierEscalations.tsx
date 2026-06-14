import { useState, useEffect, useCallback } from 'react';
import apiClient from '../api/client';

// ─── Types ───────────────────────────────────────────────────────────────────

interface EscalationEvidence {
  gpsTraces: unknown[];
  callLogs: unknown[];
  deliveryScanTimestamps: string[];
  addressValidation: unknown;
  hubEvents: unknown[];
  missingEvidenceSources: string[];
}

interface EscalationAlert {
  alertId: string;
  courierId: string;
  rtoEventId: string;
  subCause: string;
  evidence: EscalationEvidence;
  generatedAt: string;
  status?: 'active' | 'acknowledged' | 'resolved';
}

interface PerformanceRecord {
  rtoEventId: string;
  subCause: string;
  receivedAt: string;
  classifiedAt?: string;
}

interface CourierEscalationData {
  courierId: string;
  alerts: EscalationAlert[];
  performanceHistory: PerformanceRecord[];
  totalRTOCount7d: number;
  courierIssueCount7d: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatSubCause(subCause: string): string {
  return subCause.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatTimestamp(ts: string): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

function getAlertCardStyle(status?: string): React.CSSProperties {
  const base: React.CSSProperties = {
    background: '#FFFFFF',
    borderRadius: 8,
    padding: '1.25rem',
    marginBottom: '1rem',
    border: '1px solid #D5D9D9',
    boxShadow: '0 2px 5px rgba(0,0,0,0.05)',
  };
  if (status === 'resolved') return { ...base, borderLeft: '4px solid #007600' };
  if (status === 'acknowledged') return { ...base, borderLeft: '4px solid #FF9900' };
  return { ...base, borderLeft: '4px solid #B12704' };
}

function getStatusBadgeStyle(status?: string): React.CSSProperties {
  const base: React.CSSProperties = {
    display: 'inline-block',
    padding: '0.2rem 0.5rem',
    borderRadius: 12,
    fontSize: '11px',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.3px',
  };
  if (status === 'resolved') return { ...base, background: '#E7F7EF', color: '#007600' };
  if (status === 'acknowledged') return { ...base, background: '#FFF3E0', color: '#c45500' };
  return { ...base, background: '#FEF0EF', color: '#B12704' };
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function CourierEscalations() {
  const [courierId, setCourierId] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [data, setData] = useState<CourierEscalationData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [alertStatuses, setAlertStatuses] = useState<Record<string, 'acknowledged' | 'resolved'>>({});

  const fetchEscalations = useCallback(async (id: string) => {
    if (!id.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.get(`/couriers/${id.trim()}/escalations`);
      const apiData = response.data;
      setData({
        courierId: apiData.courierId,
        alerts: apiData.escalations ?? [],
        performanceHistory: apiData.performanceHistory ?? [],
        totalRTOCount7d: apiData.totalRTOCount7d ?? apiData.totalCount ?? 0,
        courierIssueCount7d: apiData.courierIssueCount7d ?? apiData.totalCount ?? 0,
      });
      setCourierId(id.trim());
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Failed to fetch escalation data';
      setError(message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSearch = () => {
    fetchEscalations(searchInput);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const handleAcknowledge = (alertId: string) => {
    setAlertStatuses((prev) => ({ ...prev, [alertId]: 'acknowledged' }));
  };

  const handleResolve = (alertId: string) => {
    setAlertStatuses((prev) => ({ ...prev, [alertId]: 'resolved' }));
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const paramCourierId = params.get('courierId');
    if (paramCourierId) {
      setSearchInput(paramCourierId);
      fetchEscalations(paramCourierId);
    } else {
      apiClient.get('/rto-events')
        .then((res) => {
          const events = res.data.events ?? [];
          const courierCounts: Record<string, number> = {};
          for (const evt of events) {
            if (evt.courierId) {
              courierCounts[evt.courierId] = (courierCounts[evt.courierId] || 0) + 1;
            }
          }
          const topCourier = Object.entries(courierCounts).sort((a, b) => b[1] - a[1])[0];
          if (topCourier) {
            setSearchInput(topCourier[0]);
            fetchEscalations(topCourier[0]);
          }
        })
        .catch(() => {});
    }
  }, [fetchEscalations]);

  const getAlertStatus = (alert: EscalationAlert): string => {
    return alertStatuses[alert.alertId] || alert.status || 'active';
  };

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ margin: 0, color: '#0F1111', fontWeight: 700, fontSize: '21px' }}>Escalation Center</h1>
        <p style={{ margin: '0.25rem 0 0', color: '#565959', fontSize: '14px' }}>Monitor courier performance and manage escalation alerts</p>
      </div>

      {/* Search Bar */}
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem', alignItems: 'center' }}>
        <input
          type="text"
          placeholder="Enter Courier ID..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={handleKeyDown}
          style={{
            padding: '0.5rem 0.75rem',
            border: '1px solid #D5D9D9',
            borderRadius: 4,
            fontSize: '14px',
            width: 260,
            background: '#FFFFFF',
            color: '#0F1111',
          }}
          aria-label="Courier ID"
        />
        <button onClick={handleSearch} disabled={loading} style={{
          padding: '0.5rem 1.25rem',
          background: '#FF9900',
          color: '#0F1111',
          border: '1px solid #a88734',
          borderRadius: 4,
          cursor: 'pointer',
          fontSize: '14px',
          fontWeight: 600,
        }}>
          {loading ? 'Loading...' : 'Search'}
        </button>
      </div>

      {error && (
        <div style={{
          padding: '1rem',
          background: '#FFFFFF',
          color: '#B12704',
          borderRadius: 8,
          marginBottom: '1rem',
          border: '1px solid #D5D9D9',
          borderLeft: '4px solid #B12704',
          fontSize: '14px',
        }}>{error}</div>
      )}
      {loading && <div style={{ textAlign: 'center', padding: '2rem', color: '#565959' }}>Loading escalation data...</div>}

      {!loading && !data && !error && (
        <div style={{ textAlign: 'center', padding: '3rem', color: '#565959' }}>
          <p>Enter a Courier ID to view escalation alerts and performance history.</p>
        </div>
      )}

      {data && !loading && (
        <>
          {/* Performance Summary */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
            <div style={{
              background: '#FFFFFF',
              borderRadius: 8,
              padding: '1.25rem',
              border: '1px solid #D5D9D9',
              boxShadow: '0 2px 5px rgba(0,0,0,0.05)',
            }}>
              <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#FF9900' }}>{data.courierIssueCount7d}</div>
              <div style={{ fontSize: '13px', color: '#565959', marginTop: '0.25rem' }}>Courier Issues (7-day window)</div>
            </div>
            <div style={{
              background: '#FFFFFF',
              borderRadius: 8,
              padding: '1.25rem',
              border: '1px solid #D5D9D9',
              boxShadow: '0 2px 5px rgba(0,0,0,0.05)',
            }}>
              <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#FF9900' }}>{data.totalRTOCount7d}</div>
              <div style={{ fontSize: '13px', color: '#565959', marginTop: '0.25rem' }}>Total RTOs (7-day window)</div>
            </div>
          </div>

          {/* Escalation Alerts */}
          <h2 style={{ fontSize: '16px', marginBottom: '0.75rem', color: '#0F1111', fontWeight: 600 }}>
            Escalation Alerts ({data.alerts.length})
          </h2>

          {data.alerts.length === 0 ? (
            <div style={{
              background: '#FFFFFF',
              borderRadius: 8,
              padding: '2rem',
              textAlign: 'center',
              color: '#565959',
              border: '1px solid #D5D9D9',
            }}>
              <p>No escalation alerts for courier {courierId}.</p>
            </div>
          ) : (
            data.alerts.map((alert) => {
              const status = getAlertStatus(alert);
              return (
                <div key={alert.alertId} style={getAlertCardStyle(status)}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
                        <span style={{
                          display: 'inline-block',
                          padding: '0.2rem 0.5rem',
                          borderRadius: 4,
                          fontSize: '12px',
                          background: '#E3F2FD',
                          color: '#1565C0',
                          fontWeight: 500,
                        }}>
                          {formatSubCause(alert.subCause)}
                        </span>
                        <span style={getStatusBadgeStyle(status)}>
                          {status}
                        </span>
                      </div>
                      <div style={{ fontSize: '13px', color: '#565959' }}>
                        <strong style={{ color: '#0F1111' }}>Alert ID:</strong> <span>{alert.alertId}</span>
                      </div>
                      <div style={{ fontSize: '13px', color: '#565959' }}>
                        <strong style={{ color: '#0F1111' }}>RTO Event:</strong> <span>{alert.rtoEventId}</span>
                      </div>
                      <div style={{ fontSize: '13px', color: '#565959' }}>
                        <strong style={{ color: '#0F1111' }}>Generated:</strong> {formatTimestamp(alert.generatedAt)}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      {status === 'active' && (
                        <button
                          style={{
                            padding: '0.4rem 0.75rem',
                            background: '#FFFFFF',
                            color: '#0F1111',
                            border: '1px solid #D5D9D9',
                            borderRadius: 4,
                            cursor: 'pointer',
                            fontSize: '13px',
                          }}
                          onClick={() => handleAcknowledge(alert.alertId)}
                        >
                          Acknowledge
                        </button>
                      )}
                      {status !== 'resolved' && (
                        <button
                          style={{
                            padding: '0.4rem 0.75rem',
                            background: '#FF9900',
                            color: '#0F1111',
                            border: '1px solid #a88734',
                            borderRadius: 4,
                            cursor: 'pointer',
                            fontSize: '13px',
                            fontWeight: 600,
                          }}
                          onClick={() => handleResolve(alert.alertId)}
                        >
                          Resolve
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Evidence Summary */}
                  <div style={{
                    marginTop: '0.75rem',
                    padding: '0.75rem',
                    background: '#F7F8F8',
                    borderRadius: 4,
                    fontSize: '13px',
                    border: '1px solid #D5D9D9',
                  }}>
                    <strong style={{ fontSize: '13px', color: '#0F1111' }}>Evidence Summary</strong>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.3rem 0', borderBottom: '1px solid #D5D9D9', color: '#565959' }}>
                      <span>GPS Traces</span>
                      <span>{alert.evidence.gpsTraces.length} records</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.3rem 0', borderBottom: '1px solid #D5D9D9', color: '#565959' }}>
                      <span>Call Logs</span>
                      <span>{alert.evidence.callLogs.length} records</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.3rem 0', borderBottom: '1px solid #D5D9D9', color: '#565959' }}>
                      <span>Delivery Scans</span>
                      <span>{alert.evidence.deliveryScanTimestamps.length} timestamps</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.3rem 0', borderBottom: '1px solid #D5D9D9', color: '#565959' }}>
                      <span>Hub Events</span>
                      <span>{alert.evidence.hubEvents.length} events</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.3rem 0', borderBottom: '1px solid #D5D9D9', color: '#565959' }}>
                      <span>Address Validation</span>
                      <span>{alert.evidence.addressValidation ? 'Available' : 'N/A'}</span>
                    </div>
                    {alert.evidence.missingEvidenceSources.length > 0 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.3rem 0', color: '#c45500' }}>
                        <span>Missing Sources</span>
                        <span>{alert.evidence.missingEvidenceSources.join(', ')}</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}

          {/* Performance History Table */}
          <h2 style={{ fontSize: '16px', margin: '1.5rem 0 0.75rem', color: '#0F1111', fontWeight: 600 }}>
            RTO Pattern History
          </h2>

          {data.performanceHistory.length === 0 ? (
            <div style={{
              background: '#FFFFFF',
              borderRadius: 8,
              padding: '2rem',
              textAlign: 'center',
              color: '#565959',
              border: '1px solid #D5D9D9',
            }}>
              <p>No performance history records found.</p>
            </div>
          ) : (
            <div style={{
              background: '#FFFFFF',
              borderRadius: 8,
              border: '1px solid #D5D9D9',
              boxShadow: '0 2px 5px rgba(0,0,0,0.05)',
              overflow: 'hidden',
            }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                <thead>
                  <tr>
                    <th style={thStyle}>RTO Event</th>
                    <th style={thStyle}>Sub-Cause</th>
                    <th style={thStyle}>Received</th>
                    <th style={thStyle}>Classified</th>
                  </tr>
                </thead>
                <tbody>
                  {data.performanceHistory.map((record) => (
                    <tr key={record.rtoEventId}>
                      <td style={tdStyle}>
                        <code style={{ fontSize: '13px', color: '#0F1111' }}>{record.rtoEventId}</code>
                      </td>
                      <td style={tdStyle}>
                        <span style={{
                          display: 'inline-block',
                          padding: '0.2rem 0.5rem',
                          borderRadius: 4,
                          fontSize: '12px',
                          background: '#E3F2FD',
                          color: '#1565C0',
                          fontWeight: 500,
                        }}>
                          {formatSubCause(record.subCause)}
                        </span>
                      </td>
                      <td style={tdStyle}>{formatTimestamp(record.receivedAt)}</td>
                      <td style={tdStyle}>
                        {record.classifiedAt ? formatTimestamp(record.classifiedAt) : '--'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '0.6rem 0.75rem',
  background: '#F7F8F8',
  borderBottom: '1px solid #D5D9D9',
  fontWeight: 600,
  color: '#565959',
  fontSize: '12px',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
};

const tdStyle: React.CSSProperties = {
  padding: '0.6rem 0.75rem',
  borderBottom: '1px solid #D5D9D9',
  color: '#0F1111',
};
