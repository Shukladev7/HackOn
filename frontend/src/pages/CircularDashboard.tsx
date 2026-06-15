import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient from '../api/client';

interface Passport {
  passportId: string;
  productName: string;
  category: string;
  condition: string;
  currentStatus: string;
  eligibilityScore: number;
  currentLocation: { city: string; hub: string };
  reservedBuyer: { name: string; city: string; distance: string; score: number } | null;
}

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  in_transit: { bg: '#FFF3CD', text: '#856404' },
  at_hub: { bg: '#D1ECF1', text: '#0C5460' },
  delivered: { bg: '#D4EDDA', text: '#155724' },
  return_initiated: { bg: '#F8D7DA', text: '#721C24' },
  routed: { bg: '#CCE5FF', text: '#004085' },
  reallocated: { bg: '#D4EDDA', text: '#155724' },
};

export default function CircularDashboard() {
  const navigate = useNavigate();
  const [passports, setPassports] = useState<Passport[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchPassports() {
      try {
        const res = await apiClient.get('/passports');
        setPassports(res.data.passports || []);
      } catch {
        // silently fail for demo
      } finally {
        setLoading(false);
      }
    }
    fetchPassports();
  }, []);

  const reallocatedCount = passports.filter(p => p.currentStatus === 'reallocated' || p.currentStatus === 'routed').length;

  return (
    <div>
      {/* Hero Stats */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: '1rem',
        marginBottom: '2rem',
      }}>
        {[
          { label: 'Products Reallocated', value: '12,842', color: '#FF9900' },
          { label: 'Products Resold', value: '4,128', color: '#004085' },
          { label: 'Warehouse Returns Avoided', value: '8,214', color: '#067D06' },
          { label: 'Lifecycle Extensions', value: '6,847', color: '#155724' },
        ].map((stat, idx) => (
          <div key={idx} style={{
            background: '#FFFFFF',
            borderRadius: 8,
            padding: '1.25rem',
            border: '1px solid #D5D9D9',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: '1.8rem', fontWeight: 700, color: stat.color }}>
              {stat.value}
            </div>
            <div style={{ fontSize: '0.78rem', color: '#565959', marginTop: '0.25rem' }}>
              {stat.label}
            </div>
          </div>
        ))}
      </div>

      {/* How It Works */}
      <div style={{
        background: '#FFFFFF',
        borderRadius: 8,
        padding: '1.5rem',
        border: '1px solid #D5D9D9',
        marginBottom: '2rem',
      }}>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0F1111', marginTop: 0, marginBottom: '1.25rem' }}>
          How Circular Routing Works
        </h2>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', maxWidth: 700, margin: '0 auto' }}>
          {/* Step 1 */}
          <div style={{ textAlign: 'center', flex: 1 }}>
            <div style={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              background: '#FFF3CD',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 0.5rem',
              fontSize: '1.2rem',
              fontWeight: 700,
              color: '#856404',
            }}>1</div>
            <div style={{ fontWeight: 600, fontSize: '0.85rem', color: '#0F1111' }}>Return Initiated</div>
            <div style={{ fontSize: '0.72rem', color: '#565959', marginTop: '0.25rem' }}>Customer initiates return at hub</div>
          </div>

          {/* Arrow */}
          <div style={{ fontSize: '1.5rem', color: '#FF9900', fontWeight: 700, padding: '0 0.5rem' }}>{'\u2192'}</div>

          {/* Step 2 */}
          <div style={{ textAlign: 'center', flex: 1 }}>
            <div style={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              background: '#CCE5FF',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 0.5rem',
              fontSize: '1.2rem',
              fontWeight: 700,
              color: '#004085',
            }}>2</div>
            <div style={{ fontWeight: 600, fontSize: '0.85rem', color: '#0F1111' }}>AI Analysis</div>
            <div style={{ fontSize: '0.72rem', color: '#565959', marginTop: '0.25rem' }}>Condition + demand scoring</div>
          </div>

          {/* Arrow */}
          <div style={{ fontSize: '1.5rem', color: '#FF9900', fontWeight: 700, padding: '0 0.5rem' }}>{'\u2192'}</div>

          {/* Step 3 */}
          <div style={{ textAlign: 'center', flex: 1 }}>
            <div style={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              background: '#D4EDDA',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 0.5rem',
              fontSize: '1.2rem',
              fontWeight: 700,
              color: '#155724',
            }}>3</div>
            <div style={{ fontWeight: 600, fontSize: '0.85rem', color: '#0F1111' }}>Direct Routing</div>
            <div style={{ fontSize: '0.72rem', color: '#565959', marginTop: '0.25rem' }}>Hub to buyer, skip warehouse</div>
          </div>
        </div>
      </div>

      {/* Product Lifecycle */}
      <div style={{
        background: '#FFFFFF',
        borderRadius: 8,
        padding: '1.5rem',
        border: '1px solid #D5D9D9',
        marginBottom: '2rem',
      }}>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0F1111', marginTop: 0, marginBottom: '1.25rem' }}>
          Product Lifecycle
        </h2>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: '0.25rem' }}>
          {[
            { label: 'New Purchase', bg: '#D4EDDA', text: '#155724' },
            { label: 'Return / Resale', bg: '#F8D7DA', text: '#721C24' },
            { label: 'AI Analysis', bg: '#CCE5FF', text: '#004085' },
            { label: 'Buyer Match', bg: '#FFF3CD', text: '#856404' },
            { label: 'Direct Routing', bg: '#FFE0B2', text: '#E65100' },
            { label: 'New Owner', bg: '#D4EDDA', text: '#155724' },
          ].map((step, idx) => (
            <div key={idx} style={{ display: 'flex', alignItems: 'center' }}>
              <div style={{
                padding: '0.5rem 1rem',
                borderRadius: 20,
                background: step.bg,
                color: step.text,
                fontSize: '0.78rem',
                fontWeight: 600,
                whiteSpace: 'nowrap',
              }}>
                {step.label}
              </div>
              {idx < 5 && (
                <span style={{ fontSize: '1.2rem', color: '#FF9900', fontWeight: 700, margin: '0 0.3rem' }}>{'\u2192'}</span>
              )}
            </div>
          ))}
        </div>
        <div style={{ textAlign: 'center', marginTop: '0.75rem' }}>
          <span style={{ fontSize: '0.72rem', color: '#565959' }}>
            Circular loop: products re-enter the lifecycle instead of returning to warehouse
          </span>
        </div>
      </div>

      {/* Action Buttons */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem' }}>
        <button
          onClick={() => navigate('/scanner')}
          style={{
            padding: '0.7rem 1.5rem',
            background: '#FF9900',
            border: 'none',
            borderRadius: 4,
            fontWeight: 600,
            fontSize: '0.9rem',
            color: '#0F1111',
            cursor: 'pointer',
            fontFamily: 'Arial, sans-serif',
          }}
        >
          Open QR Scanner
        </button>
        <button
          onClick={() => navigate('/hub')}
          style={{
            padding: '0.7rem 1.5rem',
            background: '#232F3E',
            border: 'none',
            borderRadius: 4,
            fontWeight: 600,
            fontSize: '0.9rem',
            color: '#FFFFFF',
            cursor: 'pointer',
            fontFamily: 'Arial, sans-serif',
          }}
        >
          Hub Console
        </button>
      </div>

      {/* Return Economics Comparison */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '2rem' }}>
        {/* Traditional Return */}
        <div style={{ background: '#FFFFFF', borderRadius: 8, padding: '1.5rem', border: '1px solid #D5D9D9' }}>
          <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#B12704', margin: '0 0 1rem' }}>Traditional Return</h3>
          <div style={{ fontSize: '0.82rem', lineHeight: 2.2, color: '#0F1111' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Pickup Cost</span><span style={{ fontWeight: 600 }}>Rs 60</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Line Haul to Warehouse</span><span style={{ fontWeight: 600 }}>Rs 80</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Warehouse Handling</span><span style={{ fontWeight: 600 }}>Rs 120</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Repackaging</span><span style={{ fontWeight: 600 }}>Rs 40</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Redispatch to Buyer</span><span style={{ fontWeight: 600 }}>Rs 90</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '2px solid #B12704', marginTop: '0.5rem', paddingTop: '0.5rem', fontWeight: 700, fontSize: '0.95rem' }}>
              <span>Total</span><span style={{ color: '#B12704' }}>Rs 390</span>
            </div>
          </div>
        </div>

        {/* Circular Routing */}
        <div style={{ background: '#FFFFFF', borderRadius: 8, padding: '1.5rem', border: '1px solid #D5D9D9' }}>
          <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#067D06', margin: '0 0 1rem' }}>Circular Routing</h3>
          <div style={{ fontSize: '0.82rem', lineHeight: 2.2, color: '#0F1111' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Pickup Cost</span><span style={{ fontWeight: 600 }}>Rs 60</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Hub Processing</span><span style={{ fontWeight: 600 }}>Rs 40</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Direct Redispatch</span><span style={{ fontWeight: 600 }}>Rs 70</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '2px solid #067D06', marginTop: '0.5rem', paddingTop: '0.5rem', fontWeight: 700, fontSize: '0.95rem' }}>
              <span>Total</span><span style={{ color: '#067D06' }}>Rs 170</span>
            </div>
          </div>
          <div style={{ marginTop: '1rem', padding: '0.75rem', background: '#E7F9E7', borderRadius: 6, textAlign: 'center' }}>
            <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#067D06' }}>Rs 220 Saved</div>
            <div style={{ fontSize: '0.78rem', color: '#155724' }}>56% Cost Reduction Per Package</div>
          </div>
        </div>
      </div>

      {/* Sustainability + Fraud + Impact Row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', marginBottom: '2rem' }}>
        {/* Carbon Savings */}
        <div style={{ background: '#FFFFFF', borderRadius: 8, padding: '1.25rem', border: '1px solid #D5D9D9' }}>
          <h3 style={{ fontSize: '0.88rem', fontWeight: 700, color: '#0F1111', margin: '0 0 0.75rem' }}>Environmental Impact</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.78rem', color: '#565959' }}>CO2 Saved</span>
              <span style={{ fontSize: '1.1rem', fontWeight: 700, color: '#067D06' }}>31.2 Tons</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.78rem', color: '#565959' }}>Distance Avoided</span>
              <span style={{ fontSize: '1.1rem', fontWeight: 700, color: '#004085' }}>1,09,140 km</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.78rem', color: '#565959' }}>Avg Saved/Package</span>
              <span style={{ fontSize: '1.1rem', fontWeight: 700, color: '#155724' }}>2.4 kg CO2</span>
            </div>
          </div>
        </div>

        {/* Fraud Protection */}
        <div style={{ background: '#FFFFFF', borderRadius: 8, padding: '1.25rem', border: '1px solid #D5D9D9' }}>
          <h3 style={{ fontSize: '0.88rem', fontWeight: 700, color: '#0F1111', margin: '0 0 0.75rem' }}>Fraud Protection</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {[
              { label: 'QR Verification', pass: true },
              { label: 'Serial Number Match', pass: true },
              { label: 'Ownership History Valid', pass: true },
              { label: 'Hub Inspection Passed', pass: true },
            ].map((item, idx) => (
              <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.78rem', color: '#067D06' }}>
                <span>{'\u2713'}</span>
                <span>{item.label}</span>
              </div>
            ))}
            <div style={{ marginTop: '0.5rem', padding: '0.4rem 0.6rem', background: '#E7F9E7', borderRadius: 4, textAlign: 'center' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#155724' }}>Risk Level: LOW</span>
            </div>
          </div>
        </div>

        {/* Climate Pledge */}
        <div style={{ background: '#FFFFFF', borderRadius: 8, padding: '1.25rem', border: '1px solid #D5D9D9' }}>
          <h3 style={{ fontSize: '0.88rem', fontWeight: 700, color: '#0F1111', margin: '0 0 0.75rem' }}>Climate Goals Alignment</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {[
              'Reduced Warehouse Processing',
              'Reduced Transportation Distance',
              'Extended Product Lifecycles',
              'Lower Carbon Emissions',
              'Zero-Waste Packaging Reuse',
            ].map((item, idx) => (
              <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.78rem', color: '#004085' }}>
                <span>{'\u2713'}</span>
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent Routing Cases */}
      <div style={{
        background: '#FFFFFF',
        borderRadius: 8,
        padding: '1.5rem',
        border: '1px solid #D5D9D9',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0F1111', margin: 0 }}>
            Recent Routing Cases ({passports.length})
          </h2>
          <span style={{ fontSize: '0.78rem', color: '#565959' }}>
            {reallocatedCount} successfully routed
          </span>
        </div>

        {loading ? (
          <p style={{ color: '#565959', fontSize: '0.85rem' }}>Loading passports...</p>
        ) : passports.length === 0 ? (
          <p style={{ color: '#565959', fontSize: '0.85rem' }}>
            No passports found. Run POST /api/v1/demo/seed to generate demo data.
          </p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
            {passports.slice(0, 12).map(p => {
              const statusColor = STATUS_COLORS[p.currentStatus] || { bg: '#F0F2F2', text: '#0F1111' };
              return (
                <div
                  key={p.passportId}
                  onClick={() => navigate(`/passport/${p.passportId}`)}
                  style={{
                    padding: '1rem',
                    border: '1px solid #D5D9D9',
                    borderRadius: 6,
                    cursor: 'pointer',
                    transition: 'box-shadow 0.15s',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)')}
                  onMouseLeave={(e) => (e.currentTarget.style.boxShadow = 'none')}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.85rem', color: '#0F1111' }}>{p.productName}</div>
                      <div style={{ fontSize: '0.72rem', color: '#565959' }}>{p.passportId}</div>
                    </div>
                    <span style={{
                      padding: '0.15rem 0.5rem',
                      borderRadius: 10,
                      fontSize: '0.65rem',
                      fontWeight: 600,
                      background: statusColor.bg,
                      color: statusColor.text,
                      whiteSpace: 'nowrap',
                    }}>
                      {p.currentStatus.replace(/_/g, ' ').toUpperCase()}
                    </span>
                  </div>

                  <div style={{ fontSize: '0.75rem', color: '#565959', marginBottom: '0.4rem' }}>
                    {p.currentLocation.city} | Score: {p.eligibilityScore}/100
                  </div>

                  {p.reservedBuyer && (
                    <div style={{ fontSize: '0.72rem', color: '#004085', background: '#F0F7FF', padding: '0.3rem 0.5rem', borderRadius: 4 }}>
                      Buyer: {p.reservedBuyer.name} ({p.reservedBuyer.distance})
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
