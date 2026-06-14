import { useState } from 'react';
import apiClient from '../api/client';

const styles = {
  banner: {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    background: 'linear-gradient(90deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
    color: '#fff',
    padding: '6px 16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    fontSize: '0.8rem',
    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  left: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  label: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontWeight: 600,
    fontSize: '0.82rem',
    color: '#4ecca3',
  },
  status: {
    color: '#a8dadc',
    fontSize: '0.75rem',
  },
  right: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  button: (variant: 'seed' | 'reset') => ({
    padding: '4px 12px',
    borderRadius: '4px',
    border: 'none',
    cursor: 'pointer' as const,
    fontSize: '0.75rem',
    fontWeight: 600,
    background: variant === 'seed' ? '#4ecca3' : '#e94560',
    color: variant === 'seed' ? '#1a1a2e' : '#fff',
    transition: 'opacity 0.2s',
    opacity: 1,
  }),
  buttonDisabled: {
    opacity: 0.6,
    cursor: 'not-allowed' as const,
  },
  resultText: {
    color: '#a8dadc',
    fontSize: '0.72rem',
    maxWidth: '300px',
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
    whiteSpace: 'nowrap' as const,
  },
};

export default function DemoBanner() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const handleSeed = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await apiClient.post('/demo/seed');
      const data = res.data;
      setResult(`Seeded: ${data.counts.rtoEvents} RTO events, ${data.counts.decisionRecords} decisions, ${data.counts.orders} orders`);
      // Reload page after short delay to refresh dashboard
      setTimeout(() => window.location.reload(), 1500);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Seed failed';
      setResult(`Error: ${message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await apiClient.post('/demo/reset');
      const data = res.data;
      setResult(`Reset complete: ${data.counts.rtoEvents} RTO events, ${data.counts.decisionRecords} decisions`);
      setTimeout(() => window.location.reload(), 1500);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Reset failed';
      setResult(`Error: ${message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.banner}>
      <div style={styles.left}>
        <span style={styles.label}>Demo Mode</span>
        {result && <span style={styles.resultText}>{result}</span>}
        {loading && <span style={styles.status}>Processing...</span>}
      </div>
      <div style={styles.right}>
        <button
          style={{
            ...styles.button('seed'),
            ...(loading ? styles.buttonDisabled : {}),
          }}
          onClick={handleSeed}
          disabled={loading}
        >
          Seed Data
        </button>
        <button
          style={{
            ...styles.button('reset'),
            ...(loading ? styles.buttonDisabled : {}),
          }}
          onClick={handleReset}
          disabled={loading}
        >
          Reset & Re-seed
        </button>
      </div>
    </div>
  );
}
