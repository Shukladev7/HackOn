import { useState, useEffect, useRef, useCallback } from 'react';
import apiClient from '../api/client';

// ─── Types ───────────────────────────────────────────────────────────────────

interface SeedScenario {
  scenarioId: string;
  name: string;
  description: string;
  category: string;
  city: string;
  expectedDecision: string;
}

interface ScoreContributor {
  name: string;
  points: number;
  maximum: number;
}

interface Factor {
  label: string;
  featureName: string;
  value: number;
  percentile: number;
}

interface EvaluationResult {
  evaluationId: string;
  status: string;
  inputFeatures: {
    product: { category: string; mrp: number; currentMarketPrice: number; brandPopularityScore: number };
    condition: { inspectionGrade: string; packagingCondition: string; damageScore: number; batteryHealth: number };
    demand: { wishlistCount: number; cartCount: number; nearbyInterestedBuyers: number; historicalConversionRate: number };
    location: { city: string; demandDensity: number; distanceToBuyers: number };
    financial: { expectedRecoveryValue: number; warehouseCostAvoided: number; deliveryCostSaved: number };
  };
  result: {
    flashDealScore: number;
    confidenceScore: number;
    dispositionDecision: string;
    dispositionColor: string;
    matchedRule: string;
  } | null;
  explainability: {
    positiveFactors: Factor[];
    negativeFactors: Factor[];
    explanation: string;
  } | null;
  scoreBreakdown: ScoreContributor[] | null;
  businessImpact: {
    traditionalReturnCost: number;
    flashDealRouteCost: number;
    savingsAmount: number;
    costReductionPercentage: number;
    warehouseTouchesAvoided: number;
    estimatedRecoveryValue: number | null;
    revenueRecoveryRate: number | null;
  } | null;
  sustainability: {
    traditionalDistance: number;
    flashDealDistance: number;
    distanceSaved: number;
    co2Saved: number;
  } | null;
}

interface ReasoningStep {
  module: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'finding' | 'result';
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const DECISION_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  FLASH_DEAL: { bg: '#E3FCEF', text: '#067D62', label: '⚡ Flash Deal' },
  AMAZON_RENEWED: { bg: '#E8F4FD', text: '#0066C0', label: '🔄 Amazon Renewed' },
  NORMAL_RESALE: { bg: '#FFF8E1', text: '#B8860B', label: '🏷️ Normal Resale' },
  CIRCULAR_ROUTING: { bg: '#F3E8F9', text: '#7B2D8B', label: '♻️ Circular Routing' },
  WAREHOUSE_RETURN: { bg: '#FDE8E8', text: '#CC0C39', label: '📦 Warehouse Return' },
};

function generateReasoningSteps(scenario: SeedScenario): ReasoningStep[] {
  return [
    { module: 'INIT', message: `Loading product data for: ${scenario.name}`, type: 'info' },
    { module: 'FEATURES', message: `Category: ${scenario.category} | City: ${scenario.city}`, type: 'info' },
    { module: 'PIPELINE', message: 'Initializing 6-stage AI analysis pipeline...', type: 'info' },
    { module: 'STAGE-1', message: 'Analyzing Product — evaluating brand, MRP, market positioning...', type: 'info' },
    { module: 'STAGE-1', message: '✓ Product analysis complete', type: 'success' },
    { module: 'STAGE-2', message: 'Evaluating Demand Signals — wishlist, cart, buyer proximity...', type: 'info' },
    { module: 'STAGE-2', message: '✓ Demand signal evaluation complete', type: 'success' },
    { module: 'STAGE-3', message: 'Evaluating Product Condition — grade, packaging, damage, battery...', type: 'info' },
    { module: 'STAGE-3', message: '✓ Condition assessment complete', type: 'success' },
    { module: 'STAGE-4', message: 'Evaluating Recovery Value — financial viability analysis...', type: 'info' },
    { module: 'STAGE-4', message: '✓ Recovery value computed', type: 'success' },
    { module: 'STAGE-5', message: 'Evaluating Buyer Density — local demand, distance mapping...', type: 'info' },
    { module: 'STAGE-5', message: '✓ Buyer density analysis complete', type: 'success' },
    { module: 'STAGE-6', message: 'Evaluating Conversion Probability — historical rates, intent scores...', type: 'info' },
    { module: 'STAGE-6', message: '✓ Conversion probability computed', type: 'success' },
    { module: 'SCORING', message: 'Computing Flash Deal Score (weighted: condition 30%, demand 30%, financial 25%, location 15%)...', type: 'finding' },
    { module: 'SCORING', message: 'Computing Confidence Score (completeness + consistency)...', type: 'finding' },
    { module: 'DECISION', message: 'Applying disposition rules in priority order...', type: 'finding' },
    { module: 'DECISION', message: `→ Matched rule: ${scenario.expectedDecision.replace(/_/g, ' ')}`, type: 'result' },
    { module: 'EXPLAIN', message: 'Generating explainability report (positive/negative factors)...', type: 'info' },
    { module: 'IMPACT', message: 'Calculating business impact — cost savings, recovery rate...', type: 'info' },
    { module: 'SUSTAIN', message: 'Computing sustainability metrics — CO₂ saved, distance avoided...', type: 'info' },
    { module: 'PASSPORT', message: 'Updating Product Passport routing history...', type: 'info' },
    { module: 'COMPLETE', message: `✓ Evaluation complete — Decision: ${scenario.expectedDecision.replace(/_/g, ' ')}`, type: 'result' },
  ];
}

// ─── AI Reasoning Stream (inline, same style as AIReasoningStream component) ─

function FlashDealReasoning({ steps, autoPlay, onComplete }: { steps: ReasoningStep[]; autoPlay: boolean; onComplete?: () => void }) {
  const [visibleLines, setVisibleLines] = useState(0);
  const [isPlaying, setIsPlaying] = useState(autoPlay);
  const containerRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetAndPlay = useCallback(() => {
    setVisibleLines(0);
    setIsPlaying(false);
    setTimeout(() => setIsPlaying(true), 300);
  }, []);

  useEffect(() => {
    if (!isPlaying || visibleLines >= steps.length) {
      if (visibleLines >= steps.length && isPlaying) {
        setIsPlaying(false);
        onComplete?.();
      }
      return;
    }
    const currentStep = steps[visibleLines];
    let delay = 150;
    if (currentStep) {
      switch (currentStep.type) {
        case 'info': delay = 100 + Math.random() * 60; break;
        case 'success': delay = 120 + Math.random() * 80; break;
        case 'warning': delay = 150 + Math.random() * 100; break;
        case 'finding': delay = 180 + Math.random() * 120; break;
        case 'result': delay = 220 + Math.random() * 130; break;
      }
    }
    timerRef.current = setTimeout(() => setVisibleLines(prev => prev + 1), delay);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [isPlaying, visibleLines, steps, onComplete]);

  useEffect(() => {
    if (containerRef.current) containerRef.current.scrollTop = containerRef.current.scrollHeight;
  }, [visibleLines]);

  useEffect(() => { setVisibleLines(0); setIsPlaying(autoPlay); }, [steps, autoPlay]);

  const getLineColor = (type: ReasoningStep['type']) => {
    switch (type) {
      case 'success': return '#067D62';
      case 'warning': return '#B8860B';
      case 'finding': return '#0066C0';
      case 'result': return '#067D62';
      default: return '#565959';
    }
  };

  return (
    <div style={{ background: '#FFFFFF', border: '1px solid #D5D9D9', borderRadius: 8, overflow: 'hidden', marginBottom: '1rem', boxShadow: '0 2px 5px rgba(0,0,0,0.05)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', borderBottom: '1px solid #D5D9D9', background: '#FFFFFF' }}>
        <span style={{ fontWeight: 700, fontSize: '16px', color: '#0F1111' }}>⚡ Flash Deal AI Engine</span>
        <span style={{ fontSize: '13px', color: '#565959', fontWeight: 600 }}>
          {isPlaying ? 'Processing...' : visibleLines === 0 ? 'Initializing...' : 'Analysis Complete'}
        </span>
        <button onClick={resetAndPlay} style={{ background: '#FF9900', border: '1px solid #a88734', color: '#0F1111', padding: '0.3rem 0.75rem', borderRadius: 4, fontSize: '13px', cursor: 'pointer', fontWeight: 600 }}>
          Replay
        </button>
      </div>
      <div style={{ background: '#FAFAFA', overflow: 'hidden' }}>
        <div ref={containerRef} style={{ padding: '1rem', fontFamily: "'Courier New', Courier, monospace", fontSize: '14px', fontWeight: 600, maxHeight: '320px', overflowY: 'auto', lineHeight: 1.9, color: '#0F1111' }}>
          {steps.slice(0, visibleLines).map((step, index) => (
            <div key={index} style={{ marginBottom: '0.2rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              <span style={{ color: '#C7511F' }}>[{step.module}]</span>{' '}
              <span style={{ color: getLineColor(step.type) }}>{step.message}</span>
            </div>
          ))}
          {visibleLines < steps.length && <span style={{ color: '#C7511F', animation: 'blink 1s infinite', fontSize: '14px', fontWeight: 700 }}>|</span>}
        </div>
      </div>
      <style>{`@keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }`}</style>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function FlashDeals() {
  const [scenarios, setScenarios] = useState<SeedScenario[]>([]);
  const [selectedCase, setSelectedCase] = useState<SeedScenario | null>(null);
  const [evaluationId, setEvaluationId] = useState<string | null>(null);
  const [result, setResult] = useState<EvaluationResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [showReasoning, setShowReasoning] = useState(false);
  const [reasoningSteps, setReasoningSteps] = useState<ReasoningStep[]>([]);
  const [reasoningDone, setReasoningDone] = useState(false);

  useEffect(() => {
    apiClient.get('/flash-deals/seed-scenarios').then(res => {
      setScenarios(res.data.scenarios || []);
    });
  }, []);

  const runEvaluation = async (scenario: SeedScenario) => {
    setSelectedCase(scenario);
    setIsRunning(true);
    setResult(null);
    setShowReasoning(true);
    setReasoningDone(false);
    setReasoningSteps(generateReasoningSteps(scenario));

    try {
      const res = await apiClient.post(`/flash-deals/evaluate/seed/${scenario.scenarioId}`);
      setEvaluationId(res.data.evaluationId);
    } catch {
      setIsRunning(false);
    }
  };

  const onReasoningComplete = useCallback(() => {
    setReasoningDone(true);
    // Poll for result
    if (evaluationId) {
      const poll = async () => {
        const res = await apiClient.get(`/flash-deals/evaluations/${evaluationId}`);
        if (res.data.status === 'completed') {
          setResult(res.data);
          setIsRunning(false);
        } else {
          setTimeout(poll, 500);
        }
      };
      poll();
    }
  }, [evaluationId]);

  // Also poll once evaluationId changes and reasoning is done
  useEffect(() => {
    if (!reasoningDone || !evaluationId) return;
    const poll = async () => {
      const res = await apiClient.get(`/flash-deals/evaluations/${evaluationId}`);
      if (res.data.status === 'completed') {
        setResult(res.data);
        setIsRunning(false);
      } else {
        setTimeout(poll, 500);
      }
    };
    poll();
  }, [reasoningDone, evaluationId]);

  return (
    <div>
      {/* Page Header */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.6rem', fontWeight: 700, color: '#0F1111', margin: 0 }}>
          ⚡ Flash Deal Eligibility Engine
        </h1>
        <p style={{ color: '#565959', margin: '0.3rem 0 0', fontSize: '0.95rem' }}>
          AI-powered decision engine for hyperlocal flash deal routing of returned products
        </p>
      </div>

      {/* Stats Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
        {Object.entries(DECISION_STYLES).map(([key, style]) => (
          <div key={key} style={{ background: '#FFFFFF', borderRadius: 8, padding: '1rem', border: '1px solid #D5D9D9', textAlign: 'center' }}>
            <div style={{ fontSize: '1.3rem', fontWeight: 700, color: style.text }}>{style.label}</div>
            <div style={{ fontSize: '0.72rem', color: '#565959', marginTop: '0.25rem' }}>{key.replace(/_/g, ' ')}</div>
          </div>
        ))}
      </div>

      {/* Cases Grid */}
      <div style={{ background: '#FFFFFF', borderRadius: 8, padding: '1.5rem', border: '1px solid #D5D9D9', marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0F1111', margin: '0 0 1rem' }}>
          Product Cases ({scenarios.length})
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
          {scenarios.map(s => {
            const decisionStyle = DECISION_STYLES[s.expectedDecision] || { bg: '#F7F7F7', text: '#565959', label: s.expectedDecision };
            const isSelected = selectedCase?.scenarioId === s.scenarioId;
            return (
              <div
                key={s.scenarioId}
                onClick={() => !isRunning && runEvaluation(s)}
                style={{
                  padding: '1rem',
                  border: isSelected ? `2px solid ${decisionStyle.text}` : '1px solid #D5D9D9',
                  borderRadius: 8,
                  cursor: isRunning ? 'default' : 'pointer',
                  transition: 'box-shadow 0.15s, transform 0.1s',
                  background: isSelected ? decisionStyle.bg : '#FFFFFF',
                  opacity: isRunning && !isSelected ? 0.5 : 1,
                }}
                onMouseEnter={e => { if (!isRunning) e.currentTarget.style.boxShadow = '0 3px 10px rgba(0,0,0,0.1)'; }}
                onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#0F1111' }}>{s.name}</div>
                  <span style={{ padding: '0.15rem 0.5rem', borderRadius: 10, fontSize: '0.65rem', fontWeight: 700, background: decisionStyle.bg, color: decisionStyle.text, whiteSpace: 'nowrap' }}>
                    {s.expectedDecision.replace(/_/g, ' ')}
                  </span>
                </div>
                <div style={{ fontSize: '0.78rem', color: '#565959', marginBottom: '0.4rem' }}>
                  {s.category} • {s.city}
                </div>
                <div style={{ fontSize: '0.75rem', color: '#565959', lineHeight: 1.4 }}>
                  {s.description.slice(0, 100)}{s.description.length > 100 ? '...' : ''}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* AI Reasoning Stream */}
      {showReasoning && reasoningSteps.length > 0 && (
        <FlashDealReasoning steps={reasoningSteps} autoPlay={true} onComplete={onReasoningComplete} />
      )}

      {/* Results */}
      {result && result.result && (
        <>
          {/* Decision Banner */}
          <div style={{ ...cardStyle, background: (DECISION_STYLES[result.result.dispositionDecision]?.bg || '#F7F7F7'), borderLeft: `4px solid ${DECISION_STYLES[result.result.dispositionDecision]?.text || '#565959'}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.4rem', color: DECISION_STYLES[result.result.dispositionDecision]?.text || '#0F1111', fontWeight: 700 }}>
                  {DECISION_STYLES[result.result.dispositionDecision]?.label || result.result.dispositionDecision}
                </h2>
                <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: '#565959' }}>
                  Rule: {result.result.matchedRule}
                </p>
              </div>
              <div style={{ display: 'flex', gap: '2rem' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '2.2rem', fontWeight: 700, color: '#0F1111' }}>{result.result.flashDealScore}</div>
                  <div style={{ fontSize: '0.75rem', color: '#565959' }}>Flash Deal Score</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '2.2rem', fontWeight: 700, color: '#0F1111' }}>{result.result.confidenceScore}</div>
                  <div style={{ fontSize: '0.75rem', color: '#565959' }}>Confidence</div>
                </div>
              </div>
            </div>
          </div>

          {/* Score Breakdown + Explainability */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            {result.scoreBreakdown && (
              <div style={cardStyle}>
                <h2 style={sectionTitle}>Score Breakdown</h2>
                <div style={{ display: 'grid', gap: '0.6rem' }}>
                  {result.scoreBreakdown.map(c => (
                    <div key={c.name} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ width: 130, fontSize: '0.85rem', fontWeight: 600 }}>{c.name}</span>
                      <div style={{ flex: 1, height: 12, background: '#E6E6E6', borderRadius: 6, overflow: 'hidden' }}>
                        <div style={{ width: `${(c.points / c.maximum) * 100}%`, height: '100%', background: '#FF9900', borderRadius: 6 }} />
                      </div>
                      <span style={{ width: 55, textAlign: 'right', fontSize: '0.85rem', fontWeight: 700 }}>{c.points}/{c.maximum}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {result.explainability && (
              <div style={cardStyle}>
                <h2 style={sectionTitle}>AI Explainability</h2>
                <div style={{ marginBottom: '0.75rem' }}>
                  <h4 style={{ margin: '0 0 0.4rem', fontSize: '0.8rem', color: '#067D62', textTransform: 'uppercase', fontWeight: 700 }}>Positive Factors</h4>
                  {result.explainability.positiveFactors.map((f, i) => (
                    <div key={i} style={{ fontSize: '0.9rem', padding: '0.2rem 0', color: '#0F1111', fontWeight: 500 }}>{f.label}</div>
                  ))}
                </div>
                <div style={{ marginBottom: '0.75rem' }}>
                  <h4 style={{ margin: '0 0 0.4rem', fontSize: '0.8rem', color: '#CC0C39', textTransform: 'uppercase', fontWeight: 700 }}>Risk Factors</h4>
                  {result.explainability.negativeFactors.map((f, i) => (
                    <div key={i} style={{ fontSize: '0.9rem', padding: '0.2rem 0', color: '#0F1111', fontWeight: 500 }}>{f.label}</div>
                  ))}
                </div>
                <div style={{ background: '#F7F7F7', padding: '0.75rem', borderRadius: 6, fontSize: '0.85rem', color: '#333', lineHeight: 1.6 }}>
                  {result.explainability.explanation}
                </div>
              </div>
            )}
          </div>

          {/* Business Impact + Sustainability */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            {result.businessImpact && (
              <div style={cardStyle}>
                <h2 style={sectionTitle}>💰 Business Impact</h2>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <MetricCard label="Traditional Cost" value={`₹${result.businessImpact.traditionalReturnCost}`} />
                  <MetricCard label="Flash Deal Cost" value={`₹${result.businessImpact.flashDealRouteCost}`} />
                  <MetricCard label="Savings" value={`₹${result.businessImpact.savingsAmount}`} highlight />
                  <MetricCard label="Cost Reduction" value={`${result.businessImpact.costReductionPercentage}%`} highlight />
                  <MetricCard label="Warehouse Touches Avoided" value={`${result.businessImpact.warehouseTouchesAvoided}`} />
                  <MetricCard label="Recovery Rate" value={result.businessImpact.revenueRecoveryRate ? `${result.businessImpact.revenueRecoveryRate}%` : 'N/A'} />
                </div>
              </div>
            )}

            {result.sustainability && (
              <div style={cardStyle}>
                <h2 style={sectionTitle}>🌍 Sustainability Impact</h2>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <MetricCard label="Traditional Distance" value={`${result.sustainability.traditionalDistance} km`} />
                  <MetricCard label="Flash Deal Distance" value={`${result.sustainability.flashDealDistance} km`} />
                  <MetricCard label="Distance Saved" value={`${result.sustainability.distanceSaved} km`} highlight />
                  <MetricCard label="CO₂ Saved" value={`${result.sustainability.co2Saved} kg`} highlight />
                </div>
              </div>
            )}
          </div>

          {/* Input Features */}
          <div style={cardStyle}>
            <h2 style={sectionTitle}>Input Feature Vector</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
              <FeatureGroup title="Product" features={[
                { label: 'Category', value: result.inputFeatures.product.category },
                { label: 'MRP', value: `₹${result.inputFeatures.product.mrp.toLocaleString()}` },
                { label: 'Market Price', value: `₹${result.inputFeatures.product.currentMarketPrice.toLocaleString()}` },
                { label: 'Brand Popularity', value: `${result.inputFeatures.product.brandPopularityScore}/100` },
              ]} />
              <FeatureGroup title="Condition" features={[
                { label: 'Grade', value: result.inputFeatures.condition.inspectionGrade },
                { label: 'Packaging', value: result.inputFeatures.condition.packagingCondition },
                { label: 'Damage', value: `${result.inputFeatures.condition.damageScore}/100` },
                { label: 'Battery', value: `${result.inputFeatures.condition.batteryHealth}%` },
              ]} />
              <FeatureGroup title="Demand" features={[
                { label: 'Wishlist', value: `${result.inputFeatures.demand.wishlistCount}` },
                { label: 'Cart', value: `${result.inputFeatures.demand.cartCount}` },
                { label: 'Nearby Buyers', value: `${result.inputFeatures.demand.nearbyInterestedBuyers}` },
                { label: 'Conversion', value: `${(result.inputFeatures.demand.historicalConversionRate * 100).toFixed(0)}%` },
              ]} />
              <FeatureGroup title="Location" features={[
                { label: 'City', value: result.inputFeatures.location.city },
                { label: 'Demand Density', value: `${result.inputFeatures.location.demandDensity}/100` },
                { label: 'Distance', value: `${result.inputFeatures.location.distanceToBuyers} km` },
              ]} />
              <FeatureGroup title="Financial" features={[
                { label: 'Recovery Value', value: `₹${result.inputFeatures.financial.expectedRecoveryValue.toLocaleString()}` },
                { label: 'Warehouse Saved', value: `₹${result.inputFeatures.financial.warehouseCostAvoided}` },
                { label: 'Delivery Saved', value: `₹${result.inputFeatures.financial.deliveryCostSaved}` },
              ]} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Sub-Components ──────────────────────────────────────────────────────────

function MetricCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div style={{ background: highlight ? '#E3FCEF' : '#F7F7F7', padding: '0.7rem 0.75rem', borderRadius: 6 }}>
      <div style={{ fontSize: '0.72rem', color: '#565959', marginBottom: '0.2rem' }}>{label}</div>
      <div style={{ fontSize: '1.15rem', fontWeight: 700, color: highlight ? '#067D62' : '#0F1111' }}>{value}</div>
    </div>
  );
}

function FeatureGroup({ title, features }: { title: string; features: { label: string; value: string }[] }) {
  return (
    <div style={{ background: '#F7F7F7', padding: '0.75rem', borderRadius: 6 }}>
      <h4 style={{ margin: '0 0 0.4rem', fontSize: '0.78rem', color: '#FF9900', textTransform: 'uppercase', fontWeight: 700 }}>{title}</h4>
      {features.map(f => (
        <div key={f.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.15rem 0', fontSize: '0.85rem' }}>
          <span style={{ color: '#565959' }}>{f.label}</span>
          <span style={{ fontWeight: 600, color: '#0F1111' }}>{f.value}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  background: '#FFFFFF',
  border: '1px solid #D5D9D9',
  borderRadius: 8,
  padding: '1.25rem',
  marginBottom: '1rem',
  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
};

const sectionTitle: React.CSSProperties = {
  fontSize: '1rem',
  fontWeight: 700,
  color: '#0F1111',
  margin: '0 0 0.75rem',
};
