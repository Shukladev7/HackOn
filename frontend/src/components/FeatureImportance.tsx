import { useState, useEffect } from 'react';

interface FeatureFactor {
  factor: string;
  contribution: number;
  direction: 'positive' | 'negative';
  description: string;
}

interface FeatureImportanceProps {
  factors: {
    classification: FeatureFactor[];
    recovery: FeatureFactor[];
  };
  finalConfidence: number;
  decision: string;
  animate?: boolean;
}

export default function FeatureImportance({ factors, finalConfidence, decision, animate = true }: FeatureImportanceProps) {
  const [animated, setAnimated] = useState(false);

  useEffect(() => {
    if (animate) {
      const timer = setTimeout(() => setAnimated(true), 100);
      return () => clearTimeout(timer);
    } else {
      setAnimated(false);
    }
  }, [animate]);

  const allClassification = [...factors.classification].sort(
    (a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)
  );
  const allRecovery = [...factors.recovery].sort(
    (a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)
  );

  const maxContribution = Math.max(
    ...allClassification.map((f) => Math.abs(f.contribution)),
    ...allRecovery.map((f) => Math.abs(f.contribution))
  );

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <h3 style={{ margin: 0, fontSize: '16px', color: '#0F1111', fontWeight: 600 }}>
            Feature Importance
          </h3>
          <span style={badgeStyle}>XAI</span>
        </div>
      </div>

      {/* Classification Factors */}
      <div style={{ marginBottom: '2rem' }}>
        <h4 style={sectionTitleStyle}>Root Cause Classification</h4>
        <div style={chartContainerStyle}>
          {allClassification.map((factor, index) => (
            <BarRow
              key={factor.factor}
              factor={factor}
              maxContribution={maxContribution}
              animated={animated}
              delay={index * 80}
            />
          ))}
        </div>
      </div>

      {/* Recovery Factors */}
      <div style={{ marginBottom: '2rem' }}>
        <h4 style={sectionTitleStyle}>Recovery Prediction</h4>
        <div style={chartContainerStyle}>
          {allRecovery.map((factor, index) => (
            <BarRow
              key={factor.factor}
              factor={factor}
              maxContribution={maxContribution}
              animated={animated}
              delay={(allClassification.length + index) * 80}
            />
          ))}
        </div>
      </div>

      {/* Final Decision */}
      <div style={decisionBoxStyle}>
        <div style={{ fontSize: '13px', color: '#565959', marginBottom: '0.5rem' }}>
          Final Confidence and Decision
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <span style={{ ...confidenceStyle, color: animated ? '#FF9900' : '#767676', transition: 'color 0.5s' }}>
            {animated ? `${finalConfidence}%` : '--'}
          </span>
          <span style={{ fontSize: '1.25rem', color: '#565959' }}>&rarr;</span>
          <span style={{ ...decisionTextStyle, color: animated ? '#0F1111' : '#767676', transition: 'color 0.5s' }}>
            {animated ? decision : 'Awaiting analysis...'}
          </span>
        </div>
      </div>
    </div>
  );
}

function BarRow({
  factor,
  maxContribution,
  animated,
  delay,
}: {
  factor: { factor: string; contribution: number; direction: 'positive' | 'negative'; description: string };
  maxContribution: number;
  animated: boolean;
  delay: number;
}) {
  const barWidth = (Math.abs(factor.contribution) / maxContribution) * 100;
  const isPositive = factor.direction === 'positive';

  return (
    <div style={rowStyle} title={factor.description}>
      {/* Factor name */}
      <div style={factorNameStyle}>{factor.factor}</div>

      {/* Bar area */}
      <div style={barAreaStyle}>
        {/* Negative side (left of center) */}
        <div style={negativeSideStyle}>
          {!isPositive && (
            <div
              style={{
                position: 'absolute',
                right: 0,
                top: '50%',
                transform: 'translateY(-50%)',
                height: '20px',
                width: animated ? `${barWidth}%` : '0%',
                background: 'linear-gradient(to left, #B12704, #ef5350)',
                borderRadius: '3px 0 0 3px',
                transition: `width 0.8s ease-out`,
                transitionDelay: `${delay}ms`,
              }}
            />
          )}
        </div>

        {/* Center line */}
        <div style={centerLineStyle} />

        {/* Positive side (right of center) */}
        <div style={positiveSideStyle}>
          {isPositive && (
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: '50%',
                transform: 'translateY(-50%)',
                height: '20px',
                width: animated ? `${barWidth}%` : '0%',
                background: 'linear-gradient(to right, #007600, #4caf50)',
                borderRadius: '0 3px 3px 0',
                transition: `width 0.8s ease-out`,
                transitionDelay: `${delay}ms`,
              }}
            />
          )}
        </div>
      </div>

      {/* Percentage */}
      <div
        style={{
          ...percentStyle,
          color: isPositive ? '#007600' : '#B12704',
        }}
      >
        {isPositive ? '+' : '-'}{Math.abs(factor.contribution)}%
      </div>
    </div>
  );
}

// Styles
const containerStyle: React.CSSProperties = {
  background: '#FFFFFF',
  borderRadius: '8px',
  padding: '1.5rem',
  border: '1px solid #D5D9D9',
  marginTop: '1.5rem',
  boxShadow: '0 2px 5px rgba(0,0,0,0.05)',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: '1.5rem',
};

const badgeStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '0.2rem 0.6rem',
  background: '#FF9900',
  color: '#FFFFFF',
  borderRadius: '12px',
  fontSize: '11px',
  fontWeight: 700,
  letterSpacing: '0.5px',
};

const sectionTitleStyle: React.CSSProperties = {
  margin: '0 0 0.75rem',
  fontSize: '13px',
  fontWeight: 600,
  color: '#565959',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
};

const chartContainerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.4rem',
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.75rem',
  padding: '0.25rem 0',
};

const factorNameStyle: React.CSSProperties = {
  width: '220px',
  minWidth: '220px',
  fontSize: '13px',
  color: '#0F1111',
  textAlign: 'right',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const barAreaStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  position: 'relative',
  height: '28px',
};

const negativeSideStyle: React.CSSProperties = {
  flex: 1,
  position: 'relative',
  height: '100%',
};

const centerLineStyle: React.CSSProperties = {
  width: '1px',
  height: '28px',
  background: '#D5D9D9',
  flexShrink: 0,
};

const positiveSideStyle: React.CSSProperties = {
  flex: 1,
  position: 'relative',
  height: '100%',
};

const percentStyle: React.CSSProperties = {
  width: '50px',
  minWidth: '50px',
  fontSize: '13px',
  fontWeight: 600,
  textAlign: 'right',
};

const decisionBoxStyle: React.CSSProperties = {
  padding: '1rem 1.5rem',
  background: '#F7F8F8',
  borderRadius: '8px',
  borderLeft: '4px solid #FF9900',
  border: '1px solid #D5D9D9',
};

const confidenceStyle: React.CSSProperties = {
  fontSize: '2rem',
  fontWeight: 700,
  color: '#FF9900',
};

const decisionTextStyle: React.CSSProperties = {
  fontSize: '16px',
  fontWeight: 600,
  color: '#0F1111',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
};
