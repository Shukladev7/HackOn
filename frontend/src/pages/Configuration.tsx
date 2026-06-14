import { useState, useEffect, useCallback } from 'react';
import apiClient from '../api/client';

interface ConfigData {
  confidenceThreshold: number;
  subCauseConfidenceThreshold: number;
  recoveryProbabilityThreshold: number;
  courierRedeliveryRecoveryThreshold: number;
  searchRadiusKm: number;
  cartRecencyDays: number;
  intentThreshold: number;
  refusalLookbackDays: number;
  minBuyerScore: number;
  maxRankedBuyers: number;
  fraudRtoCountThreshold: number;
  fraudTimeWindowDays: number;
  courierEscalationWindowDays: number;
  courierEscalationThreshold: number;
  eventBufferCapacity: number;
  retryMaxAttempts: number;
  retryInitialDelayMs: number;
  evidenceSourceTimeoutMs: number;
  minEvidenceSources: number;
  evidenceLookbackHours: number;
  rankingWeights: {
    distance: number;
    conversion: number;
    speed: number;
    margin: number;
  };
}

interface ConfigGroup {
  title: string;
  description: string;
  fields: ConfigField[];
}

interface ConfigField {
  key: string;
  label: string;
  description: string;
  min?: number;
  max?: number;
  step?: number;
}

const CONFIG_GROUPS: ConfigGroup[] = [
  {
    title: 'Root Cause Classification',
    description: 'Thresholds for AI-based root cause determination',
    fields: [
      { key: 'confidenceThreshold', label: 'Confidence Threshold', description: 'Min score to assign a primary root cause category', min: 0, max: 1, step: 0.05 },
      { key: 'subCauseConfidenceThreshold', label: 'Sub-Cause Confidence Threshold', description: 'Min confidence to assign specific sub-cause', min: 0, max: 1, step: 0.05 },
    ],
  },
  {
    title: 'Sale Recovery',
    description: 'Thresholds controlling redelivery vs. reallocation decisions',
    fields: [
      { key: 'recoveryProbabilityThreshold', label: 'Recovery Probability Threshold', description: 'Min probability to attempt redelivery for customer issues', min: 0, max: 1, step: 0.05 },
      { key: 'courierRedeliveryRecoveryThreshold', label: 'Courier Redelivery Recovery Threshold', description: 'Min recovery probability for courier issue redelivery', min: 0, max: 1, step: 0.05 },
    ],
  },
  {
    title: 'Demand Matching',
    description: 'Controls for geographic and demand-based buyer search',
    fields: [
      { key: 'searchRadiusKm', label: 'Search Radius (km)', description: 'Max distance from hub for candidate buyers', min: 1, max: 500, step: 5 },
      { key: 'cartRecencyDays', label: 'Cart Recency (days)', description: 'Max age of cart items to consider as demand signal', min: 1, max: 30, step: 1 },
      { key: 'intentThreshold', label: 'Intent Threshold', description: 'Min predicted intent score to include as candidate', min: 0, max: 1, step: 0.05 },
      { key: 'refusalLookbackDays', label: 'Refusal Lookback (days)', description: 'Period to check for prior refusals', min: 1, max: 365, step: 1 },
    ],
  },
  {
    title: 'Buyer Ranking Weights',
    description: 'Weights for composite buyer scoring (must sum to 1.0)',
    fields: [
      { key: 'rankingWeights.distance', label: 'Distance Weight', description: 'Weight for geographic proximity', min: 0, max: 1, step: 0.05 },
      { key: 'rankingWeights.conversion', label: 'Conversion Probability Weight', description: 'Weight for purchase likelihood', min: 0, max: 1, step: 0.05 },
      { key: 'rankingWeights.speed', label: 'Delivery Speed Weight', description: 'Weight for delivery time factor', min: 0, max: 1, step: 0.05 },
      { key: 'rankingWeights.margin', label: 'Margin Impact Weight', description: 'Weight for margin preservation', min: 0, max: 1, step: 0.05 },
    ],
  },
  {
    title: 'Buyer Ranking Filters',
    description: 'Controls for candidate filtering and limits',
    fields: [
      { key: 'minBuyerScore', label: 'Min Buyer Score', description: 'Minimum composite score to include in results', min: 0, max: 1, step: 0.05 },
      { key: 'maxRankedBuyers', label: 'Max Ranked Buyers', description: 'Maximum candidates to return', min: 1, max: 50, step: 1 },
    ],
  },
  {
    title: 'Fraud Detection',
    description: 'Thresholds for flagging suspicious RTO patterns',
    fields: [
      { key: 'fraudRtoCountThreshold', label: 'Fraud RTO Count Threshold', description: 'RTO events within window to trigger fraud flag', min: 1, max: 50, step: 1 },
      { key: 'fraudTimeWindowDays', label: 'Fraud Time Window (days)', description: 'Lookback window for counting RTO events', min: 1, max: 90, step: 1 },
    ],
  },
  {
    title: 'Courier Escalation',
    description: 'Controls for courier performance monitoring',
    fields: [
      { key: 'courierEscalationWindowDays', label: 'Escalation Window (days)', description: 'Rolling window for counting courier issues', min: 1, max: 30, step: 1 },
      { key: 'courierEscalationThreshold', label: 'Escalation Threshold', description: 'Issue count within window to trigger review', min: 1, max: 20, step: 1 },
    ],
  },
  {
    title: 'System & Infrastructure',
    description: 'Buffering, retry, and evidence collection settings',
    fields: [
      { key: 'eventBufferCapacity', label: 'Event Buffer Capacity', description: 'Max events in buffer before rejection', min: 1000, max: 1000000, step: 10000 },
      { key: 'retryMaxAttempts', label: 'Max Retry Attempts', description: 'Downstream service retry count', min: 1, max: 10, step: 1 },
      { key: 'retryInitialDelayMs', label: 'Retry Initial Delay (ms)', description: 'First retry delay (doubles each attempt)', min: 100, max: 10000, step: 100 },
      { key: 'evidenceSourceTimeoutMs', label: 'Evidence Source Timeout (ms)', description: 'Per-source timeout during evidence collection', min: 1000, max: 30000, step: 500 },
      { key: 'minEvidenceSources', label: 'Min Evidence Sources', description: 'Minimum sources required to proceed', min: 1, max: 7, step: 1 },
      { key: 'evidenceLookbackHours', label: 'Evidence Lookback (hours)', description: 'Time window for evidence collection', min: 1, max: 168, step: 1 },
    ],
  },
];

function getNestedValue(obj: ConfigData, path: string): number {
  const parts = path.split('.');
  if (parts.length === 2 && parts[0] === 'rankingWeights') {
    const weightKey = parts[1] as keyof ConfigData['rankingWeights'];
    return obj.rankingWeights[weightKey];
  }
  return (obj as unknown as Record<string, number>)[path] as number;
}

function setNestedValue(obj: ConfigData, path: string, value: number): ConfigData {
  const copy = { ...obj, rankingWeights: { ...obj.rankingWeights } };
  const parts = path.split('.');
  if (parts.length === 2 && parts[0] === 'rankingWeights') {
    const weightKey = parts[1] as keyof ConfigData['rankingWeights'];
    copy.rankingWeights[weightKey] = value;
  } else {
    (copy as unknown as Record<string, number>)[path] = value;
  }
  return copy;
}

export default function Configuration() {
  const [config, setConfig] = useState<ConfigData | null>(null);
  const [editedConfig, setEditedConfig] = useState<ConfigData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [seedLoading, setSeedLoading] = useState(false);
  const [seedResult, setSeedResult] = useState<string | null>(null);

  const handleSeed = async () => {
    setSeedLoading(true);
    setSeedResult(null);
    try {
      const res = await apiClient.post('/demo/seed');
      setSeedResult(`Seeded: ${res.data.counts.rtoEvents} RTO events, ${res.data.counts.decisionRecords} decisions, ${res.data.counts.orders} orders`);
    } catch { setSeedResult('Seed failed'); }
    finally { setSeedLoading(false); }
  };

  const handleResetAndReseed = async () => {
    setSeedLoading(true);
    setSeedResult(null);
    try {
      const res = await apiClient.post('/demo/reset');
      setSeedResult(`Reset complete: ${res.data.counts.rtoEvents} RTO events, ${res.data.counts.decisionRecords} decisions`);
    } catch { setSeedResult('Reset failed'); }
    finally { setSeedLoading(false); }
  };

  const fetchConfig = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await apiClient.get('/config');
      const data = response.data.config as ConfigData;
      setConfig(data);
      setEditedConfig(data);
    } catch (err) {
      setError('Failed to load configuration. Ensure the backend is running.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const hasChanges = (): boolean => {
    if (!config || !editedConfig) return false;
    return JSON.stringify(config) !== JSON.stringify(editedConfig);
  };

  const getChangedKeys = (): Record<string, number> => {
    if (!config || !editedConfig) return {};
    const changes: Record<string, number> = {};
    for (const group of CONFIG_GROUPS) {
      for (const field of group.fields) {
        const original = getNestedValue(config, field.key);
        const current = getNestedValue(editedConfig, field.key);
        if (original !== current) {
          if (!field.key.startsWith('rankingWeights.')) {
            changes[field.key] = current;
          }
        }
      }
    }
    return changes;
  };

  const handleSave = async () => {
    const changes = getChangedKeys();
    if (Object.keys(changes).length === 0) return;

    try {
      setSaving(true);
      setError(null);
      setSuccess(null);
      await apiClient.patch('/config', changes);
      setSuccess(`Updated ${Object.keys(changes).length} setting(s) successfully.`);
      await fetchConfig();
    } catch (err) {
      setError('Failed to save configuration. Please check the values and try again.');
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    if (config) {
      setEditedConfig(config);
      setSuccess(null);
    }
  };

  const handleFieldChange = (key: string, value: string) => {
    if (!editedConfig) return;
    const numValue = parseFloat(value);
    if (isNaN(numValue)) return;
    setEditedConfig(setNestedValue(editedConfig, key, numValue));
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '3rem', color: '#565959' }}>Loading configuration...</div>;
  }

  if (!editedConfig) {
    return (
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <h1 style={{ margin: 0, fontSize: '21px', color: '#0F1111', fontWeight: 700 }}>System Settings</h1>
        <div style={{
          padding: '0.75rem 1rem',
          background: '#FFFFFF',
          color: '#B12704',
          borderRadius: 8,
          marginTop: '1rem',
          border: '1px solid #D5D9D9',
          borderLeft: '4px solid #B12704',
          fontSize: '14px',
        }}>
          {error || 'Unable to load configuration.'}
        </div>
        <button onClick={fetchConfig} style={{
          marginTop: '1rem',
          padding: '0.5rem 1.25rem',
          background: '#FF9900',
          color: '#0F1111',
          border: '1px solid #a88734',
          borderRadius: 4,
          fontWeight: 600,
          cursor: 'pointer',
          fontSize: '14px',
        }}>Retry</button>
      </div>
    );
  }

  const weightsSum = editedConfig.rankingWeights.distance + editedConfig.rankingWeights.conversion + editedConfig.rankingWeights.speed + editedConfig.rankingWeights.margin;
  const weightsSumValid = Math.abs(weightsSum - 1.0) < 0.001;

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '21px', color: '#0F1111', fontWeight: 700 }}>System Settings</h1>
          <p style={{ color: '#565959', marginTop: 4, fontSize: '14px' }}>Configuration and thresholds</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {hasChanges() && (
            <button onClick={handleReset} style={{
              padding: '0.5rem 1.25rem',
              background: '#FFFFFF',
              color: '#0F1111',
              border: '1px solid #D5D9D9',
              borderRadius: 4,
              fontWeight: 600,
              cursor: 'pointer',
              fontSize: '14px',
            }}>
              Reset
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={!hasChanges() || saving}
            style={{
              padding: '0.5rem 1.5rem',
              background: '#FF9900',
              color: '#0F1111',
              border: '1px solid #a88734',
              borderRadius: 4,
              fontWeight: 600,
              cursor: (!hasChanges() || saving) ? 'not-allowed' : 'pointer',
              fontSize: '14px',
              opacity: (!hasChanges() || saving) ? 0.5 : 1,
            }}
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{
          padding: '0.75rem 1rem',
          background: '#FFFFFF',
          color: '#B12704',
          borderRadius: 8,
          marginBottom: '1rem',
          border: '1px solid #D5D9D9',
          borderLeft: '4px solid #B12704',
          fontSize: '14px',
        }}>{error}</div>
      )}
      {success && (
        <div style={{
          padding: '0.75rem 1rem',
          background: '#FFFFFF',
          color: '#007600',
          borderRadius: 8,
          marginBottom: '1rem',
          border: '1px solid #D5D9D9',
          borderLeft: '4px solid #007600',
          fontSize: '14px',
        }}>{success}</div>
      )}

      {CONFIG_GROUPS.map((group) => (
        <div key={group.title} style={{
          background: '#FFFFFF',
          borderRadius: 8,
          padding: '1.25rem 1.5rem',
          marginBottom: '1rem',
          border: '1px solid #D5D9D9',
          boxShadow: '0 2px 5px rgba(0,0,0,0.05)',
        }}>
          <h3 style={{ margin: '0 0 0.25rem', fontSize: '16px', color: '#0F1111', fontWeight: 600 }}>{group.title}</h3>
          <p style={{ margin: '0 0 1rem', color: '#767676', fontSize: '13px' }}>{group.description}</p>
          {group.fields.map((field) => {
            const currentValue = getNestedValue(editedConfig, field.key);
            const originalValue = config ? getNestedValue(config, field.key) : currentValue;
            const isChanged = currentValue !== originalValue;
            return (
              <div key={field.key} style={{
                display: 'grid',
                gridTemplateColumns: '1fr 160px',
                gap: '0.5rem',
                alignItems: 'center',
                padding: '0.6rem 0',
                borderBottom: '1px solid #D5D9D9',
              }}>
                <div>
                  <div style={{ fontWeight: 500, fontSize: '14px', color: '#0F1111' }}>{field.label}</div>
                  <div style={{ fontSize: '12px', color: '#767676', marginTop: 2 }}>{field.description}</div>
                </div>
                <input
                  type="number"
                  value={currentValue}
                  onChange={(e) => handleFieldChange(field.key, e.target.value)}
                  min={field.min}
                  max={field.max}
                  step={field.step}
                  style={{
                    width: '100%',
                    padding: '0.4rem 0.5rem',
                    border: `1px solid ${isChanged ? '#FF9900' : '#D5D9D9'}`,
                    borderRadius: 4,
                    fontSize: '14px',
                    textAlign: 'right',
                    background: isChanged ? '#FFF8E1' : '#FFFFFF',
                    color: '#0F1111',
                  }}
                  aria-label={field.label}
                />
              </div>
            );
          })}
          {group.title === 'Buyer Ranking Weights' && (
            <div style={{
              fontSize: '13px',
              marginTop: '0.5rem',
              padding: '0.4rem 0.6rem',
              borderRadius: 4,
              background: weightsSumValid ? '#E7F7EF' : '#FFF3E0',
              color: weightsSumValid ? '#007600' : '#c45500',
            }}>
              Sum of weights: {weightsSum.toFixed(2)} {weightsSumValid ? '\u2713' : '(should equal 1.0)'}
            </div>
          )}
        </div>
      ))}

      {/* Demo Data Management */}
      <div style={{
        background: '#FFFFFF',
        borderRadius: 8,
        padding: '1.25rem 1.5rem',
        marginTop: '2rem',
        border: '1px solid #D5D9D9',
        borderTop: '3px solid #FF9900',
        boxShadow: '0 2px 5px rgba(0,0,0,0.05)',
      }}>
        <h3 style={{ margin: '0 0 0.25rem', fontSize: '16px', color: '#0F1111', fontWeight: 600 }}>Demo Data Management</h3>
        <p style={{ margin: '0 0 1rem', color: '#767676', fontSize: '13px' }}>Seed or reset the database with realistic demo data for testing and demonstrations</p>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={handleSeed}
            disabled={seedLoading}
            style={{
              padding: '0.5rem 1.25rem',
              background: '#FF9900',
              color: '#0F1111',
              border: '1px solid #a88734',
              borderRadius: 4,
              fontWeight: 600,
              cursor: seedLoading ? 'not-allowed' : 'pointer',
              opacity: seedLoading ? 0.6 : 1,
              fontSize: '14px',
            }}
          >
            {seedLoading ? 'Processing...' : 'Load Sample Data'}
          </button>
          <button
            onClick={handleResetAndReseed}
            disabled={seedLoading}
            style={{
              padding: '0.5rem 1.25rem',
              background: '#FFFFFF',
              color: '#B12704',
              border: '1px solid #B12704',
              borderRadius: 4,
              fontWeight: 600,
              cursor: seedLoading ? 'not-allowed' : 'pointer',
              opacity: seedLoading ? 0.6 : 1,
              fontSize: '14px',
            }}
          >
            {seedLoading ? 'Processing...' : 'Reset Database'}
          </button>
          {seedResult && (
            <span style={{ fontSize: '13px', color: '#565959' }}>{seedResult}</span>
          )}
        </div>
      </div>
    </div>
  );
}
