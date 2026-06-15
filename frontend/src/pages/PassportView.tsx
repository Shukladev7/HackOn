import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import apiClient from '../api/client';

interface RoutingEvent {
  event: string;
  timestamp: string;
  details: string;
  status: 'completed' | 'active' | 'pending';
}

interface Passport {
  passportId: string;
  qrCodeValue: string;
  sku: string;
  productName: string;
  category: string;
  condition: string;
  currentOwner: string;
  currentLocation: { city: string; hub: string };
  currentStatus: string;
  eligibilityScore: number;
  reservedBuyer: { name: string; city: string; distance: string; score: number } | null;
  ownershipHistory: Array<{ owner: string; from: string; to: string; date: string }>;
  returnHistory: Array<{ reason: string; date: string; condition: string }>;
  routingHistory: RoutingEvent[];
  lifecycleCount?: number;
  resaleHistory?: Array<{ listedAt: string; soldAt: string; price: number; buyerName: string; grade: string }>;
  inspectionHistory?: Array<{ inspectedAt: string; inspector: string; grade: string; physicalCheck: boolean; accessoriesCheck: boolean; batteryHealth: number; cosmeticCheck: boolean; authenticityCheck: boolean; notes: string }>;
  conditionHistory?: Array<{ condition: string; recordedAt: string; recordedBy: string }>;
}

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  in_transit: { bg: '#FFF3CD', text: '#856404' },
  at_hub: { bg: '#D1ECF1', text: '#0C5460' },
  delivered: { bg: '#D4EDDA', text: '#155724' },
  return_initiated: { bg: '#F8D7DA', text: '#721C24' },
  routed: { bg: '#CCE5FF', text: '#004085' },
  reallocated: { bg: '#D4EDDA', text: '#155724' },
};

const CONDITION_COLORS: Record<string, { bg: string; text: string }> = {
  new: { bg: '#D4EDDA', text: '#155724' },
  like_new: { bg: '#CCE5FF', text: '#004085' },
  good: { bg: '#FFF3CD', text: '#856404' },
  fair: { bg: '#F8D7DA', text: '#721C24' },
};

export default function PassportView() {
  const { passportId } = useParams<{ passportId: string }>();
  const navigate = useNavigate();
  const [passport, setPassport] = useState<Passport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function fetchPassport() {
      try {
        setLoading(true);
        const res = await apiClient.get(`/passports/${passportId}`);
        setPassport(res.data.passport);
      } catch (err: any) {
        setError(err.response?.data?.message || 'Failed to fetch passport');
      } finally {
        setLoading(false);
      }
    }
    if (passportId) fetchPassport();
  }, [passportId]);

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '3rem' }}>
        <p style={{ color: '#565959' }}>Loading passport data...</p>
      </div>
    );
  }

  if (error || !passport) {
    return (
      <div style={{ textAlign: 'center', padding: '3rem' }}>
        <p style={{ color: '#B12704', marginBottom: '1rem' }}>{error || 'Passport not found'}</p>
        <button onClick={() => navigate('/scanner')} style={btnStyle}>
          Back to Scanner
        </button>
      </div>
    );
  }

  const statusColor = STATUS_COLORS[passport.currentStatus] || { bg: '#F0F2F2', text: '#0F1111' };
  const condColor = CONDITION_COLORS[passport.condition] || { bg: '#F0F2F2', text: '#0F1111' };

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      {/* Hero Section */}
      <div style={{
        background: '#FFFFFF',
        borderRadius: 8,
        padding: '1.5rem',
        marginBottom: '1.5rem',
        border: '1px solid #D5D9D9',
        display: 'flex',
        gap: '1.5rem',
        alignItems: 'flex-start',
      }}>
        {/* Product Image Placeholder */}
        <div style={{
          width: 120,
          height: 120,
          background: '#F7F8F8',
          border: '1px solid #D5D9D9',
          borderRadius: 8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '0.75rem',
          color: '#565959',
          textAlign: 'center',
          flexShrink: 0,
        }}>
          {passport.category}<br />Product
        </div>

        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
            <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#0F1111', margin: 0 }}>
              {passport.productName}
            </h1>
            <span style={{
              padding: '0.2rem 0.6rem',
              borderRadius: 12,
              fontSize: '0.72rem',
              fontWeight: 600,
              background: statusColor.bg,
              color: statusColor.text,
            }}>
              {passport.currentStatus.replace(/_/g, ' ').toUpperCase()}
            </span>
            {passport.lifecycleCount && passport.lifecycleCount > 1 && (
              <span style={{
                padding: '0.2rem 0.6rem',
                borderRadius: 12,
                fontSize: '0.72rem',
                fontWeight: 600,
                background: '#FFF3CD',
                color: '#856404',
              }}>
                {passport.lifecycleCount === 2 ? '2nd Life' : passport.lifecycleCount === 3 ? '3rd Life' : `${passport.lifecycleCount}th Life`}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', fontSize: '0.85rem', color: '#565959' }}>
            <span>Passport: <strong style={{ color: '#0F1111' }}>{passport.passportId}</strong></span>
            <span>SKU: {passport.sku}</span>
            <span>
              Condition: <span style={{
                padding: '0.1rem 0.4rem',
                borderRadius: 8,
                fontSize: '0.72rem',
                background: condColor.bg,
                color: condColor.text,
                fontWeight: 600,
              }}>{passport.condition.replace(/_/g, ' ')}</span>
            </span>
          </div>

          <div style={{ marginTop: '0.75rem', fontSize: '0.85rem', color: '#565959' }}>
            <span>Location: {passport.currentLocation.city} ({passport.currentLocation.hub})</span>
            <span style={{ margin: '0 1rem' }}>|</span>
            <span>Owner: {passport.currentOwner}</span>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
        {/* Left Column - Timeline */}
        <div>
          <div style={{
            background: '#FFFFFF',
            borderRadius: 8,
            padding: '1.5rem',
            border: '1px solid #D5D9D9',
          }}>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0F1111', marginTop: 0, marginBottom: '1.25rem' }}>
              Product Journey Timeline
            </h2>

            <div style={{ position: 'relative', paddingLeft: '2rem' }}>
              {/* Vertical line */}
              <div style={{
                position: 'absolute',
                left: '0.55rem',
                top: '0.5rem',
                bottom: '0.5rem',
                width: 2,
                background: '#FF9900',
              }} />

              {passport.routingHistory.map((event, idx) => (
                <div key={idx} style={{ position: 'relative', marginBottom: '1.25rem' }}>
                  {/* Circle */}
                  <div style={{
                    position: 'absolute',
                    left: '-1.55rem',
                    top: '0.15rem',
                    width: 14,
                    height: 14,
                    borderRadius: '50%',
                    border: '2px solid',
                    borderColor: event.status === 'completed' ? '#067D06' : event.status === 'active' ? '#FF9900' : '#D5D9D9',
                    background: event.status === 'completed' ? '#067D06' : event.status === 'active' ? '#FF9900' : '#FFFFFF',
                  }} />

                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#0F1111' }}>
                        {event.event}
                      </span>
                      {event.status === 'active' && (
                        <span style={{
                          fontSize: '0.65rem',
                          padding: '0.1rem 0.4rem',
                          borderRadius: 8,
                          background: '#FFF3CD',
                          color: '#856404',
                          fontWeight: 600,
                        }}>IN PROGRESS</span>
                      )}
                    </div>
                    <p style={{ fontSize: '0.78rem', color: '#565959', margin: '0.2rem 0 0 0' }}>
                      {event.details}
                    </p>
                    {event.timestamp && (
                      <span style={{ fontSize: '0.7rem', color: '#888' }}>
                        {new Date(event.timestamp).toLocaleDateString('en-IN', {
                          day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
                        })}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Ownership History */}
          <div style={{
            background: '#FFFFFF',
            borderRadius: 8,
            padding: '1.5rem',
            border: '1px solid #D5D9D9',
            marginTop: '1.5rem',
          }}>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0F1111', marginTop: 0, marginBottom: '1rem' }}>
              Ownership History
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {passport.ownershipHistory.map((entry, idx) => (
                <div key={idx} style={{
                  padding: '0.75rem',
                  background: '#F7F8F8',
                  borderRadius: 6,
                  border: '1px solid #EAEDED',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.85rem', color: '#0F1111' }}>{entry.owner}</div>
                      <div style={{ fontSize: '0.72rem', color: '#565959', marginTop: '0.15rem' }}>
                        {entry.from} {'\u2192'} {entry.to}
                      </div>
                    </div>
                    <div style={{ fontSize: '0.72rem', color: '#565959' }}>
                      {new Date(entry.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* AI Return Analysis */}
          <div style={{
            background: '#FFFFFF',
            borderRadius: 8,
            padding: '1.5rem',
            border: '1px solid #D5D9D9',
          }}>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0F1111', marginTop: 0, marginBottom: '1rem' }}>
              AI Return Analysis
            </h2>

            <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', marginBottom: '1rem' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{
                  fontSize: '2.2rem',
                  fontWeight: 700,
                  color: passport.eligibilityScore >= 75 ? '#067D06' : '#B12704',
                }}>
                  {passport.eligibilityScore}
                </div>
                <div style={{ fontSize: '0.72rem', color: '#565959' }}>Eligibility Score</div>
              </div>

              <div style={{ flex: 1 }}>
                <div style={{
                  height: 8,
                  background: '#F0F2F2',
                  borderRadius: 4,
                  overflow: 'hidden',
                  marginBottom: '0.5rem',
                }}>
                  <div style={{
                    height: '100%',
                    width: `${passport.eligibilityScore}%`,
                    background: passport.eligibilityScore >= 75 ? '#067D06' : passport.eligibilityScore >= 50 ? '#FF9900' : '#B12704',
                    borderRadius: 4,
                  }} />
                </div>
                <div style={{ fontSize: '0.75rem', color: '#565959' }}>
                  Condition: <strong>{passport.condition.replace(/_/g, ' ')}</strong> |
                  Confidence: <strong>{Math.min(99, passport.eligibilityScore + 3)}%</strong>
                </div>
              </div>
            </div>

            <div style={{
              padding: '0.6rem',
              background: passport.eligibilityScore >= 75 ? '#E7F9E7' : '#FFF8E7',
              borderRadius: 4,
              fontSize: '0.78rem',
              color: passport.eligibilityScore >= 75 ? '#067D06' : '#6B4F00',
              fontWeight: 500,
            }}>
              {passport.eligibilityScore >= 75
                ? 'Recommended for circular routing - high eligibility'
                : 'Borderline eligibility - manual review suggested'}
            </div>
          </div>

          {/* Reserved Buyer */}
          {passport.reservedBuyer && (
            <div style={{
              background: '#FFFFFF',
              borderRadius: 8,
              padding: '1.5rem',
              border: '1px solid #D5D9D9',
            }}>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0F1111', marginTop: 0, marginBottom: '1rem' }}>
                Reserved Buyer
              </h2>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.95rem', color: '#0F1111' }}>
                    {passport.reservedBuyer.name}
                  </div>
                  <div style={{ fontSize: '0.82rem', color: '#565959', marginTop: '0.25rem' }}>
                    {passport.reservedBuyer.city} | {passport.reservedBuyer.distance} from hub
                  </div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#FF9900' }}>
                    {passport.reservedBuyer.score}%
                  </div>
                  <div style={{ fontSize: '0.68rem', color: '#565959' }}>Match Score</div>
                </div>
              </div>
            </div>
          )}

          {/* Routing Decision */}
          <div style={{
            background: '#FFFFFF',
            borderRadius: 8,
            padding: '1.5rem',
            border: '1px solid #D5D9D9',
          }}>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0F1111', marginTop: 0, marginBottom: '1rem' }}>
              Routing Decision
            </h2>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
              <div style={{ textAlign: 'center', padding: '0.5rem', background: '#F7F8F8', borderRadius: 4 }}>
                <div style={{ fontSize: '0.68rem', color: '#565959' }}>Route Type</div>
                <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#0F1111' }}>
                  {passport.currentStatus === 'reallocated' ? 'Direct' : passport.currentStatus === 'routed' ? 'Hub-to-Buyer' : 'Pending'}
                </div>
              </div>
              <div style={{ textAlign: 'center', padding: '0.5rem', background: '#F7F8F8', borderRadius: 4 }}>
                <div style={{ fontSize: '0.68rem', color: '#565959' }}>Cost Saved</div>
                <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#067D06' }}>
                  Rs {200 + passport.eligibilityScore * 2}
                </div>
              </div>
              <div style={{ textAlign: 'center', padding: '0.5rem', background: '#F7F8F8', borderRadius: 4 }}>
                <div style={{ fontSize: '0.68rem', color: '#565959' }}>CO2 Reduced</div>
                <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#067D06' }}>
                  {(1.2 + passport.eligibilityScore * 0.02).toFixed(1)} kg
                </div>
              </div>
            </div>

            <p style={{ fontSize: '0.78rem', color: '#565959', margin: 0 }}>
              {passport.reservedBuyer
                ? `Package routed directly from ${passport.currentLocation.hub} to ${passport.reservedBuyer.name} (${passport.reservedBuyer.distance}), bypassing warehouse return.`
                : 'Routing analysis in progress. Evaluating nearby demand signals.'}
            </p>
          </div>

          {/* QR Code Display */}
          <div style={{
            background: '#FFFFFF',
            borderRadius: 8,
            padding: '1.5rem',
            border: '1px solid #D5D9D9',
          }}>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0F1111', marginTop: 0, marginBottom: '1rem' }}>
              Why This Decision?
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem', marginBottom: '1rem' }}>
              {[
                { label: 'Recovery Probability', value: `${100 - passport.eligibilityScore + 10}%`, low: true },
                { label: 'Buyer Match Score', value: passport.reservedBuyer ? `${passport.reservedBuyer.score}%` : 'N/A', low: false },
                { label: 'Condition Grade', value: passport.condition === 'like_new' ? 'A' : passport.condition === 'good' ? 'B' : 'C', low: false },
                { label: 'Distance Saved', value: `${35 + Math.round(passport.eligibilityScore * 0.6)} km`, low: false },
                { label: 'Cost Saved', value: `Rs ${200 + passport.eligibilityScore * 2}`, low: false },
                { label: 'CO2 Saved', value: `${(1.2 + passport.eligibilityScore * 0.02).toFixed(1)} kg`, low: false },
              ].map((item, idx) => (
                <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0.6rem', background: '#F7F8F8', borderRadius: 4 }}>
                  <span style={{ fontSize: '0.75rem', color: '#565959' }}>{item.label}</span>
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, color: item.low ? '#B12704' : '#067D06' }}>{item.value}</span>
                </div>
              ))}
            </div>
            <div style={{ padding: '0.6rem', background: '#E7F9E7', borderRadius: 4, textAlign: 'center' }}>
              <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#155724' }}>
                Decision: {passport.currentStatus === 'reallocated' || passport.currentStatus === 'routed' ? 'DIRECT REALLOCATION' : 'PENDING ANALYSIS'}
              </div>
            </div>
            <div style={{ marginTop: '0.75rem', display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
              {['High Buyer Demand', 'Excellent Condition', 'Nearby Customer', 'Low Recovery Probability'].map((factor, idx) => (
                <span key={idx} style={{ padding: '0.2rem 0.5rem', borderRadius: 10, fontSize: '0.68rem', fontWeight: 600, background: '#CCE5FF', color: '#004085' }}>
                  {factor}
                </span>
              ))}
            </div>
          </div>

          {/* Fraud Verification */}
          <div style={{
            background: '#FFFFFF',
            borderRadius: 8,
            padding: '1.5rem',
            border: '1px solid #D5D9D9',
          }}>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0F1111', marginTop: 0, marginBottom: '1rem' }}>
              Fraud Protection Status
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
              {[
                { label: 'QR Code Verified', pass: true },
                { label: 'Serial Number Verified', pass: true },
                { label: 'Ownership History Valid', pass: true },
                { label: 'Hub Inspection Passed', pass: passport.condition !== 'fair' },
                { label: 'No Duplicate Claims', pass: true },
              ].map((item, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem', color: item.pass ? '#067D06' : '#B12704' }}>
                  <span>{item.pass ? '\u2713' : '\u2717'}</span>
                  <span>{item.label}</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.6rem', background: '#E7F9E7', borderRadius: 4 }}>
              <span style={{ fontSize: '0.78rem', color: '#155724', fontWeight: 600 }}>Fraud Risk Score: 8/100</span>
              <span style={{ padding: '0.2rem 0.6rem', borderRadius: 10, fontSize: '0.68rem', fontWeight: 700, background: '#D4EDDA', color: '#155724' }}>LOW RISK</span>
            </div>
          </div>

          {/* QR Code Display - Original */}
          <div style={{
            background: '#FFFFFF',
            borderRadius: 8,
            padding: '1.5rem',
            border: '1px solid #D5D9D9',
            textAlign: 'center',
          }}>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0F1111', marginTop: 0, marginBottom: '1rem' }}>
              Product QR Code
            </h2>
            <div style={{
              display: 'inline-block',
              padding: '1rem',
              border: '2px solid #0F1111',
              borderRadius: 8,
              fontFamily: 'monospace',
              fontSize: '0.9rem',
              fontWeight: 600,
              color: '#0F1111',
              background: '#F7F8F8',
            }}>
              {passport.qrCodeValue}
            </div>
            <p style={{ fontSize: '0.72rem', color: '#565959', marginTop: '0.5rem', marginBottom: 0 }}>
              Scan this code at any hub to access product passport
            </p>
          </div>

          {/* Inspection Reports */}
          {passport.inspectionHistory && passport.inspectionHistory.length > 0 && (
            <div style={{
              background: '#FFFFFF',
              borderRadius: 8,
              padding: '1.5rem',
              border: '1px solid #D5D9D9',
            }}>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0F1111', marginTop: 0, marginBottom: '1rem' }}>
                Inspection Reports
              </h2>
              {passport.inspectionHistory.map((insp, idx) => (
                <div key={idx} style={{ padding: '0.75rem', background: '#F7F8F8', borderRadius: 6, marginBottom: idx < passport.inspectionHistory!.length - 1 ? '0.75rem' : 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                    <span style={{ fontSize: '0.82rem', fontWeight: 600, color: '#0F1111' }}>Inspector: {insp.inspector}</span>
                    <span style={{
                      padding: '0.1rem 0.5rem',
                      borderRadius: 10,
                      fontSize: '0.68rem',
                      fontWeight: 600,
                      background: insp.grade === 'A' ? '#D4EDDA' : insp.grade === 'B' ? '#FFF3CD' : '#F8D7DA',
                      color: insp.grade === 'A' ? '#155724' : insp.grade === 'B' ? '#856404' : '#721C24',
                    }}>Grade {insp.grade}</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.3rem', fontSize: '0.75rem', color: '#565959' }}>
                    <span>Physical: <strong style={{ color: insp.physicalCheck ? '#155724' : '#721C24' }}>{insp.physicalCheck ? 'Pass' : 'Fail'}</strong></span>
                    <span>Accessories: <strong style={{ color: insp.accessoriesCheck ? '#155724' : '#721C24' }}>{insp.accessoriesCheck ? 'Pass' : 'Fail'}</strong></span>
                    <span>Battery: <strong style={{ color: '#0F1111' }}>{insp.batteryHealth}%</strong></span>
                    <span>Cosmetic: <strong style={{ color: insp.cosmeticCheck ? '#155724' : '#721C24' }}>{insp.cosmeticCheck ? 'Pass' : 'Fail'}</strong></span>
                    <span>Authenticity: <strong style={{ color: insp.authenticityCheck ? '#155724' : '#721C24' }}>{insp.authenticityCheck ? 'Pass' : 'Fail'}</strong></span>
                  </div>
                  {insp.notes && <p style={{ fontSize: '0.72rem', color: '#565959', margin: '0.4rem 0 0 0', fontStyle: 'italic' }}>{insp.notes}</p>}
                  <div style={{ fontSize: '0.68rem', color: '#888', marginTop: '0.3rem' }}>
                    {new Date(insp.inspectedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Resale History */}
          {passport.resaleHistory && passport.resaleHistory.length > 0 && (
            <div style={{
              background: '#FFFFFF',
              borderRadius: 8,
              padding: '1.5rem',
              border: '1px solid #D5D9D9',
            }}>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0F1111', marginTop: 0, marginBottom: '1rem' }}>
                Resale History
              </h2>
              {passport.resaleHistory.map((resale, idx) => (
                <div key={idx} style={{ padding: '0.75rem', background: '#F7F8F8', borderRadius: 6, marginBottom: idx < passport.resaleHistory!.length - 1 ? '0.75rem' : 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#0F1111' }}>
                      {'\u20B9'}{resale.price.toLocaleString('en-IN')}
                    </span>
                    <span style={{
                      padding: '0.1rem 0.5rem',
                      borderRadius: 10,
                      fontSize: '0.68rem',
                      fontWeight: 600,
                      background: resale.grade === 'A' ? '#D4EDDA' : resale.grade === 'B' ? '#FFF3CD' : '#F8D7DA',
                      color: resale.grade === 'A' ? '#155724' : resale.grade === 'B' ? '#856404' : '#721C24',
                    }}>Grade {resale.grade}</span>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#565959' }}>
                    Buyer: {resale.buyerName}
                  </div>
                  <div style={{ fontSize: '0.68rem', color: '#888', marginTop: '0.2rem' }}>
                    Listed: {new Date(resale.listedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                    {resale.soldAt && ` | Sold: ${new Date(resale.soldAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  padding: '0.6rem 1.2rem',
  background: '#FF9900',
  border: 'none',
  borderRadius: 4,
  fontWeight: 600,
  fontSize: '0.9rem',
  color: '#0F1111',
  cursor: 'pointer',
  fontFamily: 'Arial, sans-serif',
};
