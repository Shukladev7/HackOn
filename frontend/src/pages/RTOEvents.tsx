import { useState, useEffect, useCallback } from 'react';
import apiClient from '../api/client';
import AIReasoningStream from '../components/AIReasoningStream';
import FeatureImportance from '../components/FeatureImportance';

interface RTOEvent {
  _id: string;
  shipmentId: string;
  orderId: string;
  customerId: string;
  courierId: string;
  packageDetails: {
    sku: string;
    category: string;
    price: number;
  };
  classification?: {
    primaryCategory: string;
    subCause: string;
    customerScore: number;
    courierScore: number;
    systemScore: number;
  };
  decision?: {
    action: string;
    reasoning: string;
    inputs: {
      recoveryProbability: number;
      candidateBuyerCount: number;
      topBuyerScore: number | null;
    };
  };
  status: string;
  receivedAt: string;
  processedAt?: string;
}

interface TimelineEntry {
  eventType: string;
  actorModule: string;
  outcomeStatus: string;
  timestamp: string;
  inputParams?: Record<string, unknown>;
}

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

interface ReasoningStep {
  timestamp: string;
  module: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'finding' | 'result';
}

interface FeatureFactor {
  factor: string;
  contribution: number;
  direction: 'positive' | 'negative';
  description: string;
}

interface ReasoningData {
  steps: ReasoningStep[];
  featureImportance: {
    classification: FeatureFactor[];
    recovery: FeatureFactor[];
  };
  finalConfidence: number;
  decision: string;
  processingTimeMs: number;
}

type ViewMode = 'list' | 'timeline' | 'decision';

export default function RTOEvents() {
  const [events, setEvents] = useState<RTOEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<string>('');
  const [rootCauseFilter, setRootCauseFilter] = useState<string>('');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [decision, setDecision] = useState<DecisionRecord | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [reasoning, setReasoning] = useState<ReasoningData | null>(null);
  const [reasoningLoading, setReasoningLoading] = useState(false);
  const [analysisComplete, setAnalysisComplete] = useState(false);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string> = {};
      if (statusFilter) params.status = statusFilter;
      if (rootCauseFilter) params.rootCause = rootCauseFilter;
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;

      const response = await apiClient.get('/rto-events', { params });
      setEvents(response.data.events ?? response.data ?? []);
    } catch (err) {
      setError('Failed to fetch RTO events');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, rootCauseFilter, startDate, endDate]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const fetchTimeline = async (eventId: string) => {
    setDetailLoading(true);
    try {
      const response = await apiClient.get(`/rto-events/${eventId}/timeline`);
      setTimeline(response.data.events ?? response.data.timeline ?? []);
    } catch (err) {
      console.error('Failed to fetch timeline', err);
      setTimeline([]);
    } finally {
      setDetailLoading(false);
    }
  };

  const fetchDecision = async (eventId: string) => {
    setDetailLoading(true);
    try {
      const response = await apiClient.get(`/rto-events/${eventId}/decision`);
      setDecision(response.data.decision ?? response.data ?? null);
    } catch (err) {
      console.error('Failed to fetch decision', err);
      setDecision(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const fetchReasoning = async (eventId: string) => {
    setReasoningLoading(true);
    try {
      const response = await apiClient.get(`/rto-events/${eventId}/reasoning`);
      setReasoning(response.data);
    } catch (err) {
      console.error('Failed to fetch reasoning', err);
      setReasoning(null);
    } finally {
      setReasoningLoading(false);
    }
  };

  const handleViewTimeline = (eventId: string) => {
    setSelectedEventId(eventId);
    setViewMode('timeline');
    fetchTimeline(eventId);
  };

  const handleViewDecision = (eventId: string) => {
    setSelectedEventId(eventId);
    setViewMode('decision');
    setAnalysisComplete(false);
    fetchDecision(eventId);
    fetchReasoning(eventId);
  };

  const handleBackToList = () => {
    setViewMode('list');
    setSelectedEventId(null);
    setTimeline([]);
    setDecision(null);
    setReasoning(null);
    setAnalysisComplete(false);
  };

  const getStatusBadgeStyle = (status: string): React.CSSProperties => {
    const colors: Record<string, { bg: string; text: string }> = {
      received: { bg: '#E3F2FD', text: '#1565C0' },
      eligible: { bg: '#E0F2F1', text: '#00695C' },
      ineligible: { bg: '#FEF0EF', text: '#B12704' },
      classified: { bg: '#FFF8E1', text: '#c45500' },
      decided: { bg: '#F3E5F5', text: '#6A1B9A' },
      executed: { bg: '#E7F7EF', text: '#007600' },
    };
    const c = colors[status] ?? { bg: '#F5F5F5', text: '#565959' };
    return {
      display: 'inline-block',
      padding: '3px 10px',
      borderRadius: '12px',
      fontSize: '12px',
      fontWeight: 600,
      color: c.text,
      background: c.bg,
      textTransform: 'uppercase',
      letterSpacing: '0.3px',
    };
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

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString();
  };

  // Timeline View
  if (viewMode === 'timeline' && selectedEventId) {
    return (
      <div>
        <button onClick={handleBackToList} style={backButtonStyle}>
          &larr; Back to exceptions
        </button>
        <h1 style={{ marginBottom: '0.5rem', color: '#0F1111', fontWeight: 700, fontSize: '21px' }}>Event Timeline</h1>
        <p style={{ color: '#565959', marginBottom: '1.5rem', fontSize: '14px' }}>
          Event ID: <code style={{ color: '#c45500' }}>{selectedEventId}</code>
        </p>

        {detailLoading ? (
          <p style={{ color: '#565959' }}>Loading timeline...</p>
        ) : timeline.length === 0 ? (
          <p style={{ color: '#565959' }}>No timeline entries found for this event.</p>
        ) : (
          <div style={{ position: 'relative', paddingLeft: '2rem' }}>
            <div
              style={{
                position: 'absolute',
                left: '0.75rem',
                top: 0,
                bottom: 0,
                width: '2px',
                background: '#FF9900',
                opacity: 0.4,
              }}
            />
            {timeline.map((entry, index) => (
              <div key={index} style={timelineEntryStyle}>
                <div
                  style={{
                    position: 'absolute',
                    left: '-1.6rem',
                    top: '0.5rem',
                    width: '12px',
                    height: '12px',
                    borderRadius: '50%',
                    background:
                      entry.outcomeStatus === 'success'
                        ? '#007600'
                        : entry.outcomeStatus === 'failure'
                        ? '#B12704'
                        : '#FF9900',
                    border: '2px solid #FFFFFF',
                    boxShadow: '0 0 0 2px #D5D9D9',
                  }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                  <strong style={{ textTransform: 'capitalize', color: '#0F1111', fontSize: '14px' }}>
                    {entry.eventType.replace(/_/g, ' ')}
                  </strong>
                  <span style={{ fontSize: '12px', color: '#767676' }}>
                    {formatDate(entry.timestamp)}
                  </span>
                </div>
                <div style={{ fontSize: '13px', color: '#565959' }}>
                  <span>Module: {entry.actorModule.replace(/_/g, ' ')}</span>
                  <span style={{ marginLeft: '1rem' }}>
                    Status: <span style={getStatusBadgeStyle(entry.outcomeStatus)}>{entry.outcomeStatus}</span>
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Decision Detail View
  if (viewMode === 'decision' && selectedEventId) {
    return (
      <div>
        <button onClick={handleBackToList} style={backButtonStyle}>
          &larr; Back to exceptions
        </button>
        <h1 style={{ marginBottom: '0.5rem', color: '#0F1111', fontWeight: 700, fontSize: '21px' }}>Decision Record</h1>
        <p style={{ color: '#565959', marginBottom: '1.5rem', fontSize: '14px' }}>
          Event ID: <code style={{ color: '#c45500' }}>{selectedEventId}</code>
        </p>

        {/* AI Reasoning Stream */}
        {reasoningLoading ? (
          <div style={{ padding: '1rem', background: '#FFFFFF', borderRadius: '8px', marginBottom: '1.5rem', border: '1px solid #D5D9D9' }}>
            <p style={{ color: '#565959', margin: 0, fontSize: '14px' }}>
              Loading AI analysis...
            </p>
          </div>
        ) : reasoning ? (
          <AIReasoningStream steps={reasoning.steps} autoPlay={true} onComplete={() => setAnalysisComplete(true)} onReplay={() => setAnalysisComplete(false)} />
        ) : null}

        {detailLoading ? (
          <p style={{ color: '#565959' }}>Loading decision...</p>
        ) : !decision ? (
          <p style={{ color: '#565959' }}>No decision record found for this event.</p>
        ) : (
          <div style={decisionCardStyle}>
            <div style={decisionSectionStyle}>
              <h3 style={{ margin: '0 0 0.75rem', color: '#0F1111', fontSize: '16px', fontWeight: 600 }}>Root Cause</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                <div>
                  <span style={{ color: '#565959', fontSize: '13px' }}>Category:</span>
                  <div style={{ fontWeight: 600, textTransform: 'capitalize', color: analysisComplete ? '#0F1111' : '#767676', transition: 'color 0.5s', fontSize: '14px' }}>
                    {analysisComplete ? decision.rootCause.category.replace(/_/g, ' ') : '--'}
                  </div>
                </div>
                <div>
                  <span style={{ color: '#565959', fontSize: '13px' }}>Sub-cause:</span>
                  <div style={{ fontWeight: 600, textTransform: 'capitalize', color: analysisComplete ? '#0F1111' : '#767676', transition: 'color 0.5s', fontSize: '14px' }}>
                    {analysisComplete ? decision.rootCause.subCause.replace(/_/g, ' ') : '--'}
                  </div>
                </div>
              </div>
            </div>

            <div style={decisionSectionStyle}>
              <h3 style={{ margin: '0 0 0.75rem', color: '#0F1111', fontSize: '16px', fontWeight: 600 }}>Confidence Scores</h3>
              <div style={{ display: 'flex', gap: '2rem' }}>
                <ScoreBar label="Customer" value={analysisComplete ? decision.rootCause.scores.customer : 0} />
                <ScoreBar label="Courier" value={analysisComplete ? decision.rootCause.scores.courier : 0} />
                <ScoreBar label="System" value={analysisComplete ? decision.rootCause.scores.system : 0} />
              </div>
            </div>

            <div style={decisionSectionStyle}>
              <h3 style={{ margin: '0 0 0.75rem', color: '#0F1111', fontSize: '16px', fontWeight: 600 }}>Action</h3>
              {analysisComplete ? (
                <>
                  <span style={getActionBadgeStyle(decision.action)}>
                    {decision.action.replace(/_/g, ' ')}
                  </span>
                  {decision.selectedBuyerId && (
                    <div style={{ marginTop: '0.5rem', fontSize: '13px', color: '#565959' }}>
                      Selected Buyer: <code style={{ color: '#c45500' }}>{decision.selectedBuyerId}</code>
                    </div>
                  )}
                </>
              ) : (
                <span style={{ padding: '3px 10px', borderRadius: 12, fontSize: '12px', fontWeight: 600, background: '#F5F5F5', color: '#767676' }}>
                  Awaiting analysis...
                </span>
              )}
            </div>

            <div style={decisionSectionStyle}>
              <h3 style={{ margin: '0 0 0.75rem', color: '#0F1111', fontSize: '16px', fontWeight: 600 }}>Reasoning</h3>
              <p style={{ margin: 0, color: analysisComplete ? '#565959' : '#767676', lineHeight: 1.6, transition: 'color 0.5s', fontSize: '14px' }}>
                {analysisComplete ? decision.reasoning : 'AI analysis in progress...'}
              </p>
            </div>

            <div style={decisionSectionStyle}>
              <h3 style={{ margin: '0 0 0.75rem', color: '#0F1111', fontSize: '16px', fontWeight: 600 }}>Decision Inputs</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
                <div style={metricBoxStyle}>
                  <div style={{ fontSize: '12px', color: '#565959' }}>Recovery Probability</div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 700, color: analysisComplete ? '#FF9900' : '#767676', transition: 'color 0.5s' }}>
                    {analysisComplete ? `${(decision.inputs.recoveryProbability * 100).toFixed(1)}%` : '--'}
                  </div>
                </div>
                <div style={metricBoxStyle}>
                  <div style={{ fontSize: '12px', color: '#565959' }}>Candidate Buyers</div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 700, color: analysisComplete ? '#FF9900' : '#767676', transition: 'color 0.5s' }}>
                    {analysisComplete ? decision.inputs.candidateBuyerCount : '--'}
                  </div>
                </div>
                <div style={metricBoxStyle}>
                  <div style={{ fontSize: '12px', color: '#565959' }}>Top Buyer Score</div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 700, color: analysisComplete ? '#FF9900' : '#767676', transition: 'color 0.5s' }}>
                    {analysisComplete
                      ? (decision.inputs.topBuyerScore != null ? decision.inputs.topBuyerScore.toFixed(3) : 'N/A')
                      : '--'}
                  </div>
                </div>
              </div>
            </div>

            <div style={{ fontSize: '12px', color: '#767676', marginTop: '1rem' }}>
              {analysisComplete ? `Decided at: ${formatDate(decision.timestamp)}` : ''}
            </div>
          </div>
        )}

        {reasoning && (
          <FeatureImportance
            factors={reasoning.featureImportance}
            finalConfidence={reasoning.finalConfidence}
            decision={reasoning.decision}
            animate={analysisComplete}
          />
        )}
      </div>
    );
  }

  // List View
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h1 style={{ margin: 0, color: '#0F1111', fontWeight: 700, fontSize: '21px' }}>
          Delivery Exceptions
          <span style={{ marginLeft: '0.75rem', fontSize: '14px', fontWeight: 400, color: '#565959' }}>
            ({events.length} records)
          </span>
        </h1>
      </div>

      {/* Filters */}
      <div style={filterBarStyle}>
        <div style={filterGroupStyle}>
          <label style={filterLabelStyle}>Status</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={selectStyle}
          >
            <option value="">All</option>
            <option value="received">Received</option>
            <option value="eligible">Eligible</option>
            <option value="ineligible">Ineligible</option>
            <option value="classified">Classified</option>
            <option value="decided">Decided</option>
            <option value="executed">Executed</option>
          </select>
        </div>

        <div style={filterGroupStyle}>
          <label style={filterLabelStyle}>Root Cause</label>
          <select
            value={rootCauseFilter}
            onChange={(e) => setRootCauseFilter(e.target.value)}
            style={selectStyle}
          >
            <option value="">All</option>
            <option value="customer_issue">Customer Issue</option>
            <option value="courier_issue">Courier Issue</option>
            <option value="system_issue">System Issue</option>
          </select>
        </div>

        <div style={filterGroupStyle}>
          <label style={filterLabelStyle}>From</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            style={inputStyle}
          />
        </div>

        <div style={filterGroupStyle}>
          <label style={filterLabelStyle}>To</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            style={inputStyle}
          />
        </div>

        <button onClick={fetchEvents} style={searchButtonStyle}>
          Search
        </button>
      </div>

      {error && <div style={errorStyle}>{error}</div>}
      {loading && <p style={{ color: '#565959' }}>Loading events...</p>}

      {!loading && !error && (
        <div style={{ overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Shipment ID</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Root Cause</th>
                <th style={thStyle}>Action</th>
                <th style={thStyle}>Received</th>
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {events.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '2rem', color: '#565959' }}>
                    No exceptions found matching the selected filters.
                  </td>
                </tr>
              ) : (
                events.map((event) => (
                  <tr key={event._id} style={trStyle}>
                    <td style={tdStyle}>
                      <code style={{ fontSize: '13px', color: '#0F1111' }}>{event.shipmentId}</code>
                    </td>
                    <td style={tdStyle}>
                      <span style={getStatusBadgeStyle(event.status)}>{event.status}</span>
                    </td>
                    <td style={tdStyle}>
                      {event.classification?.primaryCategory ? (
                        <span style={{ textTransform: 'capitalize', fontSize: '14px', color: '#0F1111' }}>
                          {event.classification.primaryCategory.replace(/_/g, ' ')}
                        </span>
                      ) : (
                        <span style={{ color: '#767676', fontSize: '14px' }}>Pending</span>
                      )}
                    </td>
                    <td style={tdStyle}>
                      {event.decision?.action ? (
                        <span style={getActionBadgeStyle(event.decision.action)}>
                          {event.decision.action.replace(/_/g, ' ')}
                        </span>
                      ) : (
                        <span style={{ color: '#767676', fontSize: '14px' }}>--</span>
                      )}
                    </td>
                    <td style={tdStyle}>
                      <span style={{ fontSize: '13px', color: '#565959' }}>{formatDate(event.receivedAt)}</span>
                    </td>
                    <td style={tdStyle}>
                      <button
                        onClick={() => handleViewTimeline(event._id)}
                        style={actionBtnStyle}
                        title="View Timeline"
                      >
                        View Timeline
                      </button>
                      <button
                        onClick={() => handleViewDecision(event._id)}
                        style={{ ...actionBtnStyle, marginLeft: '0.5rem' }}
                        title="View Decision"
                      >
                        View Decision
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Score bar sub-component
function ScoreBar({ label, value }: { label: string; value: number }) {
  const percent = Math.round(value * 100);
  return (
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: '13px', color: '#565959', marginBottom: '0.25rem' }}>{label}</div>
      <div style={{ background: '#EAEDED', borderRadius: '4px', height: '8px', overflow: 'hidden' }}>
        <div
          style={{
            width: `${percent}%`,
            height: '100%',
            background: percent > 60 ? '#007600' : percent > 30 ? '#FF9900' : '#B12704',
            borderRadius: '4px',
            transition: 'width 0.3s',
          }}
        />
      </div>
      <div style={{ fontSize: '12px', color: '#0F1111', marginTop: '0.15rem' }}>{percent}%</div>
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

const inputStyle: React.CSSProperties = {
  padding: '0.5rem 0.75rem',
  borderRadius: '4px',
  border: '1px solid #D5D9D9',
  fontSize: '14px',
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

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  background: '#FFFFFF',
  borderRadius: '8px',
  overflow: 'hidden',
  border: '1px solid #D5D9D9',
  boxShadow: '0 2px 5px rgba(0,0,0,0.05)',
};

const thStyle: React.CSSProperties = {
  padding: '0.75rem 1rem',
  textAlign: 'left',
  borderBottom: '1px solid #D5D9D9',
  fontSize: '12px',
  fontWeight: 600,
  color: '#565959',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  background: '#F7F8F8',
};

const trStyle: React.CSSProperties = {
  borderBottom: '1px solid #D5D9D9',
};

const tdStyle: React.CSSProperties = {
  padding: '0.75rem 1rem',
  verticalAlign: 'middle',
  fontSize: '14px',
};

const actionBtnStyle: React.CSSProperties = {
  padding: '0.3rem 0.6rem',
  fontSize: '12px',
  background: '#FFFFFF',
  color: '#c45500',
  border: '1px solid #FF9900',
  borderRadius: '4px',
  cursor: 'pointer',
  fontWeight: 600,
};

const backButtonStyle: React.CSSProperties = {
  padding: '0.5rem 1rem',
  background: 'transparent',
  color: '#FF9900',
  border: '1px solid #D5D9D9',
  borderRadius: '4px',
  cursor: 'pointer',
  fontSize: '14px',
  marginBottom: '1rem',
  fontWeight: 600,
};

const timelineEntryStyle: React.CSSProperties = {
  position: 'relative',
  padding: '0.75rem 1rem',
  marginBottom: '1rem',
  background: '#FFFFFF',
  borderRadius: '8px',
  border: '1px solid #D5D9D9',
  boxShadow: '0 2px 5px rgba(0,0,0,0.05)',
};

const decisionCardStyle: React.CSSProperties = {
  background: '#FFFFFF',
  borderRadius: '8px',
  padding: '1.5rem',
  border: '1px solid #D5D9D9',
  boxShadow: '0 2px 5px rgba(0,0,0,0.05)',
};

const decisionSectionStyle: React.CSSProperties = {
  marginBottom: '1.5rem',
  paddingBottom: '1rem',
  borderBottom: '1px solid #D5D9D9',
};

const metricBoxStyle: React.CSSProperties = {
  padding: '0.75rem',
  background: '#F7F8F8',
  borderRadius: '6px',
  textAlign: 'center',
  border: '1px solid #D5D9D9',
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
