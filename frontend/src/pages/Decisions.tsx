import { useState, useEffect, useCallback } from 'react';
import apiClient from '../api/client';

interface DecisionRecord {
  _id: string;
  rtoEventId: string;
  rootCause: {
    category: string;
    subCause: string;
    scores: { customer: number; courier: number; system: number };
  };
  action: string;
  reasoning: string;
  inputs: {
    recoveryProbability: number;
    candidateBuyerCount: number;
    topBuyerScore: number | null;
  };
  selectedBuyerId: string | null;
  timestamp: string;
}

export default function Decisions() {
  const [decisions, setDecisions] = useState<DecisionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [actionFilter, setActionFilter] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');

  const fetchDecisions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string> = {};
      if (actionFilter) params.action = actionFilter;
      if (categoryFilter) params.rootCause = categoryFilter;

      const response = await apiClient.get('/rto-events', { params: { ...params, includeDecisions: 'true' } });
      const events = response.data.events ?? response.data ?? [];

      const decisionRecords: DecisionRecord[] = events
        .filter((evt: Record<string, unknown>) => evt && (evt as { decision?: unknown }).decision)
        .map((evt: Record<string, unknown>) => {
          const event = evt as {
            _id: string;
            classification?: { primaryCategory: string; subCause: string; customerScore: number; courierScore: number; systemScore: number };
            decision: { action: string; reasoning: string; inputs: { recoveryProbability: number; candidateBuyerCount: number; topBuyerScore: number | null }; selectedBuyerId?: string | null; decidedAt?: string };
            processedAt?: string;
          };
          return {
            _id: event._id + '_decision',
            rtoEventId: event._id,
            rootCause: {
              category: event.classification?.primaryCategory ?? 'unknown',
              subCause: event.classification?.subCause ?? 'unknown',
              scores: {
                customer: event.classification?.customerScore ?? 0,
                courier: event.classification?.courierScore ?? 0,
                system: event.classification?.systemScore ?? 0,
              },
            },
            action: event.decision.action,
            reasoning: event.decision.reasoning,
            inputs: event.decision.inputs,
            selectedBuyerId: event.decision.selectedBuyerId ?? null,
            timestamp: event.decision.decidedAt ?? event.processedAt ?? new Date().toISOString(),
          };
        });

      let filtered = decisionRecords;
      if (actionFilter) {
        filtered = filtered.filter((d) => d.action === actionFilter);
      }
      if (categoryFilter) {
        filtered = filtered.filter((d) => d.rootCause.category === categoryFilter);
      }

      setDecisions(filtered);
    } catch (err) {
      setError('Failed to fetch decisions');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [actionFilter, categoryFilter]);

  useEffect(() => {
    fetchDecisions();
  }, [fetchDecisions]);

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString();
  };

  const getActionBadgeStyle = (action: string): React.CSSProperties => {
    const colors: Record<string, { bg: string; text: string }> = {
      redeliver: { bg: '#E7F7EF', text: '#007600' },
      reallocate: { bg: '#FFF3E0', text: '#c45500' },
      warehouse_return: { bg: '#FEF0EF', text: '#B12704' },
    };
    const c = colors[action] ?? { bg: '#F5F5F5', text: '#565959' };
    return {
      display: 'inline-block',
      padding: '3px 10px',
      borderRadius: '12px',
      fontSize: '12px',
      fontWeight: 600,
      color: c.text,
      background: c.bg,
    };
  };

  const getCategoryColor = (category: string): string => {
    const colors: Record<string, string> = {
      customer_issue: '#c45500',
      courier_issue: '#B12704',
      system_issue: '#6A1B9A',
    };
    return colors[category] ?? '#565959';
  };

  return (
    <div>
      <h1 style={{ marginBottom: '0.25rem', color: '#0F1111', fontWeight: 700, fontSize: '21px' }}>Decision History</h1>
      <p style={{ color: '#565959', marginBottom: '1.5rem', fontSize: '14px' }}>Full audit trail of AI-driven operational decisions</p>

      {/* Filters */}
      <div style={filterBarStyle}>
        <div style={filterGroupStyle}>
          <label style={filterLabelStyle}>Action</label>
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            style={selectStyle}
          >
            <option value="">All</option>
            <option value="redeliver">Redeliver</option>
            <option value="reallocate">Reallocate</option>
            <option value="warehouse_return">Warehouse Return</option>
          </select>
        </div>

        <div style={filterGroupStyle}>
          <label style={filterLabelStyle}>Root Cause</label>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            style={selectStyle}
          >
            <option value="">All</option>
            <option value="customer_issue">Customer Issue</option>
            <option value="courier_issue">Courier Issue</option>
            <option value="system_issue">System Issue</option>
          </select>
        </div>

        <button onClick={fetchDecisions} style={searchButtonStyle}>
          Search
        </button>
      </div>

      {error && <div style={errorStyle}>{error}</div>}
      {loading && <p style={{ color: '#565959' }}>Loading decisions...</p>}

      {!loading && !error && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {decisions.length === 0 ? (
            <p style={{ color: '#565959', textAlign: 'center', padding: '2rem' }}>
              No decision records found matching the selected filters.
            </p>
          ) : (
            decisions.map((decision) => (
              <div key={decision._id} style={cardStyle}>
                <div
                  style={cardHeaderStyle}
                  onClick={() => toggleExpand(decision._id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter') toggleExpand(decision._id); }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flex: 1 }}>
                    <span style={getActionBadgeStyle(decision.action)}>
                      {decision.action.replace(/_/g, ' ')}
                    </span>
                    <span
                      style={{
                        fontSize: '12px',
                        padding: '2px 8px',
                        borderRadius: 4,
                        background: '#F7F8F8',
                        color: getCategoryColor(decision.rootCause.category),
                        fontWeight: 600,
                        textTransform: 'capitalize',
                        border: '1px solid #D5D9D9',
                      }}
                    >
                      {decision.rootCause.category.replace(/_/g, ' ')}
                    </span>
                    <span style={{ fontSize: '13px', color: '#565959' }}>
                      Event: <code style={{ color: '#0F1111' }}>{decision.rtoEventId.slice(0, 12)}...</code>
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <span style={{ fontSize: '13px', color: '#767676' }}>
                      {formatDate(decision.timestamp)}
                    </span>
                    <span style={{ fontSize: '1.2rem', color: '#565959' }}>
                      {expandedId === decision._id ? '\u25BC' : '\u25B8'}
                    </span>
                  </div>
                </div>

                {expandedId === decision._id && (
                  <div style={cardBodyStyle}>
                    <div style={{ marginBottom: '1rem' }}>
                      <h4 style={{ margin: '0 0 0.5rem', fontSize: '12px', color: '#565959', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600 }}>
                        Reasoning
                      </h4>
                      <p style={{ margin: 0, lineHeight: 1.6, color: '#0F1111', fontSize: '14px' }}>{decision.reasoning}</p>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                      <div>
                        <h4 style={{ margin: '0 0 0.5rem', fontSize: '12px', color: '#565959', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600 }}>
                          Root Cause Detail
                        </h4>
                        <div style={{ fontSize: '14px', color: '#0F1111' }}>
                          <div>Sub-cause: <strong style={{ textTransform: 'capitalize' }}>{decision.rootCause.subCause.replace(/_/g, ' ')}</strong></div>
                          <div style={{ marginTop: '0.25rem', color: '#565959' }}>
                            Scores: Customer {(decision.rootCause.scores.customer * 100).toFixed(0)}% |
                            Courier {(decision.rootCause.scores.courier * 100).toFixed(0)}% |
                            System {(decision.rootCause.scores.system * 100).toFixed(0)}%
                          </div>
                        </div>
                      </div>
                      <div>
                        <h4 style={{ margin: '0 0 0.5rem', fontSize: '12px', color: '#565959', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600 }}>
                          Decision Inputs
                        </h4>
                        <div style={{ fontSize: '14px', color: '#0F1111' }}>
                          <div>Recovery: <strong style={{ color: '#FF9900' }}>{(decision.inputs.recoveryProbability * 100).toFixed(1)}%</strong></div>
                          <div>Candidates: <strong>{decision.inputs.candidateBuyerCount}</strong></div>
                          <div>Top Score: <strong>{decision.inputs.topBuyerScore?.toFixed(3) ?? 'N/A'}</strong></div>
                        </div>
                      </div>
                    </div>

                    {decision.selectedBuyerId && (
                      <div style={{ fontSize: '14px', color: '#565959' }}>
                        Selected Buyer: <code style={{ color: '#c45500' }}>{decision.selectedBuyerId}</code>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// Styles
const filterBarStyle: React.CSSProperties = {
  display: 'flex',
  gap: '1rem',
  alignItems: 'flex-end',
  marginBottom: '1.5rem',
  flexWrap: 'wrap',
  padding: '1rem 1.25rem',
  background: '#FFFFFF',
  borderRadius: '8px',
  border: '1px solid #D5D9D9',
  boxShadow: '0 2px 5px rgba(0,0,0,0.05)',
};

const filterGroupStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.25rem',
};

const filterLabelStyle: React.CSSProperties = {
  fontSize: '12px',
  fontWeight: 600,
  color: '#565959',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
};

const selectStyle: React.CSSProperties = {
  padding: '0.5rem 0.75rem',
  borderRadius: '4px',
  border: '1px solid #D5D9D9',
  fontSize: '14px',
  minWidth: '140px',
  background: '#FFFFFF',
  color: '#0F1111',
};

const searchButtonStyle: React.CSSProperties = {
  padding: '0.5rem 1.25rem',
  background: '#FF9900',
  color: '#0F1111',
  border: '1px solid #a88734',
  borderRadius: '4px',
  cursor: 'pointer',
  fontSize: '14px',
  fontWeight: 600,
};

const cardStyle: React.CSSProperties = {
  background: '#FFFFFF',
  borderRadius: '8px',
  border: '1px solid #D5D9D9',
  overflow: 'hidden',
  boxShadow: '0 2px 5px rgba(0,0,0,0.05)',
};

const cardHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '0.75rem 1rem',
  cursor: 'pointer',
  userSelect: 'none',
};

const cardBodyStyle: React.CSSProperties = {
  padding: '0 1rem 1rem',
  borderTop: '1px solid #D5D9D9',
  paddingTop: '1rem',
};

const errorStyle: React.CSSProperties = {
  padding: '0.75rem 1rem',
  background: '#FFFFFF',
  color: '#B12704',
  borderRadius: '8px',
  marginBottom: '1rem',
  border: '1px solid #D5D9D9',
  borderLeft: '4px solid #B12704',
  fontSize: '14px',
};
