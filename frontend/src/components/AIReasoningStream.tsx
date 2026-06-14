import { useState, useEffect, useRef, useCallback } from 'react';

interface ReasoningStep {
  timestamp: string;
  module: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'finding' | 'result';
}

interface AIReasoningStreamProps {
  steps: ReasoningStep[];
  autoPlay?: boolean;
  onComplete?: () => void;
  onReplay?: () => void;
}

export default function AIReasoningStream({ steps, autoPlay = true, onComplete, onReplay }: AIReasoningStreamProps) {
  const [visibleLines, setVisibleLines] = useState(0);
  const [isPlaying, setIsPlaying] = useState(autoPlay);
  const containerRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetAndPlay = useCallback(() => {
    setVisibleLines(0);
    setIsPlaying(false);
    onReplay?.();
    setTimeout(() => setIsPlaying(true), 800);
  }, [onReplay]);

  useEffect(() => {
    if (!isPlaying || visibleLines >= steps.length) {
      if (visibleLines >= steps.length && isPlaying) {
        setIsPlaying(false);
        onComplete?.();
      }
      return;
    }

    const currentStep = steps[visibleLines];
    let delay = 600;
    if (currentStep) {
      switch (currentStep.type) {
        case 'info': delay = 500 + Math.random() * 300; break;
        case 'success': delay = 700 + Math.random() * 400; break;
        case 'warning': delay = 900 + Math.random() * 500; break;
        case 'finding': delay = 1000 + Math.random() * 600; break;
        case 'result': delay = 1200 + Math.random() * 500; break;
      }
    }

    timerRef.current = setTimeout(() => {
      setVisibleLines((prev) => prev + 1);
    }, delay);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isPlaying, visibleLines, steps.length, steps, onComplete]);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [visibleLines]);

  useEffect(() => {
    setVisibleLines(0);
    setIsPlaying(autoPlay);
  }, [steps, autoPlay]);

  const getLineColor = (type: ReasoningStep['type']): string => {
    switch (type) {
      case 'success': return '#4ecca3';
      case 'warning': return '#ffd93d';
      case 'finding': return '#6ef3d6';
      case 'result': return '#4ecca3';
      case 'info':
      default: return '#8b949e';
    }
  };

  const getModuleColor = (_type: ReasoningStep['type']): string => {
    return '#FF9900';
  };

  return (
    <div style={wrapperStyle}>
      {/* White card header */}
      <div style={cardHeaderStyle}>
        <span style={{ fontWeight: 600, fontSize: '16px', color: '#0F1111' }}>
          AI Classification Engine
        </span>
        <span style={{ fontSize: '13px', color: '#565959' }}>
          {isPlaying ? 'Processing...' : visibleLines === 0 ? 'Initializing...' : 'Classification Complete'}
        </span>
        <button onClick={resetAndPlay} style={replayBtnStyle}>
          Replay Analysis
        </button>
      </div>

      {/* Dark terminal body */}
      <div style={containerStyle}>
        <div ref={containerRef} style={bodyStyle}>
          {steps.slice(0, visibleLines).map((step, index) => (
            <div
              key={index}
              style={{
                marginBottom: '0.25rem',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              <span style={{ color: getModuleColor(step.type) }}>
                [{step.module}]
              </span>{' '}
              <span style={{ color: getLineColor(step.type) }}>
                {step.message}
              </span>
            </div>
          ))}
          {visibleLines < steps.length && (
            <span style={cursorStyle}>|</span>
          )}
        </div>
      </div>

      {/* CSS Animations */}
      <style>{`
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}

const wrapperStyle: React.CSSProperties = {
  background: '#FFFFFF',
  border: '1px solid #D5D9D9',
  borderRadius: '8px',
  overflow: 'hidden',
  marginBottom: '1.5rem',
  boxShadow: '0 2px 5px rgba(0,0,0,0.05)',
};

const cardHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '0.75rem 1rem',
  borderBottom: '1px solid #D5D9D9',
  background: '#FFFFFF',
  gap: '1rem',
};

const replayBtnStyle: React.CSSProperties = {
  background: '#FF9900',
  border: '1px solid #a88734',
  color: '#0F1111',
  padding: '0.3rem 0.75rem',
  borderRadius: '4px',
  fontSize: '13px',
  cursor: 'pointer',
  fontWeight: 600,
};

const containerStyle: React.CSSProperties = {
  background: '#0d1117',
  overflow: 'hidden',
};

const bodyStyle: React.CSSProperties = {
  padding: '1rem',
  fontFamily: "'Courier New', Courier, monospace",
  fontSize: '13px',
  maxHeight: '400px',
  overflowY: 'auto',
  lineHeight: 1.8,
};

const cursorStyle: React.CSSProperties = {
  color: '#FF9900',
  animation: 'blink 1s infinite',
  fontSize: '14px',
};
