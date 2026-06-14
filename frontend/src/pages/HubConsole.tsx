import { useState, useEffect, useRef } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import apiClient from '../api/client';

interface Passport {
  passportId: string;
  qrCodeValue: string;
  productName: string;
  category: string;
  condition: string;
  currentOwner: string;
  currentLocation: { city: string; hub: string };
  currentStatus: string;
  eligibilityScore: number;
  reservedBuyer: { name: string; city: string; distance: string; score: number } | null;
}

type FlowStep = 'idle' | 'scanning' | 'scanned' | 'verified' | 'labeled' | 'invoiced' | 'dispatched';

export default function HubConsole() {
  const [flowStep, setFlowStep] = useState<FlowStep>('idle');
  const [passport, setPassport] = useState<Passport | null>(null);
  const [showScanner, setShowScanner] = useState(false);
  const [error, setError] = useState('');
  const [labelData, setLabelData] = useState<{ awb: string; barcode: string; from: string; to: string; toCity: string; date: string } | null>(null);
  const [invoiceData, setInvoiceData] = useState<{ invoiceNo: string; date: string; product: string; amount: string; gst: string; total: string; buyerName: string; hsn: string } | null>(null);
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);

  useEffect(() => {
    if (!showScanner) return;

    const scanner = new Html5QrcodeScanner('hub-qr-reader', {
      fps: 10,
      qrbox: { width: 250, height: 250 },
    }, false);

    scanner.render(
      async (decodedText) => {
        scanner.clear().catch(() => {});
        setShowScanner(false);
        const passportId = decodedText.replace('CIRCULAR-', '');
        await handleScan(passportId);
      },
      () => {}
    );

    scannerRef.current = scanner;

    return () => {
      scanner.clear().catch(() => {});
    };
  }, [showScanner]);

  const handleScan = async (passportId: string) => {
    try {
      setError('');
      const res = await apiClient.post(`/passports/${passportId}/scan`);
      setPassport(res.data.passport);
      setFlowStep('scanned');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Scan failed');
    }
  };

  const handleVerify = () => {
    setFlowStep('verified');
  };

  const handleGenerateLabel = () => {
    if (!passport) return;
    const awb = `AWB-${passport.passportId.replace('PP-', '')}-CR-${Date.now().toString(36).toUpperCase().slice(-4)}`;
    setLabelData({
      awb,
      barcode: `||||| ${awb} |||||`,
      from: `${passport.currentLocation.hub}, ${passport.currentLocation.city}`,
      to: passport.reservedBuyer?.name || 'Buyer',
      toCity: passport.reservedBuyer?.city || 'Destination City',
      date: new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
    });
    setFlowStep('labeled');
  };

  const handleGenerateInvoice = () => {
    if (!passport) return;
    const price = Math.round(5000 + Math.random() * 70000);
    const gst = Math.round(price * 0.18);
    setInvoiceData({
      invoiceNo: `INV-CR-${passport.passportId.replace('PP-', '')}-${Date.now().toString(36).slice(-4).toUpperCase()}`,
      date: new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
      product: passport.productName,
      amount: price.toLocaleString('en-IN'),
      gst: gst.toLocaleString('en-IN'),
      total: (price + gst).toLocaleString('en-IN'),
      buyerName: passport.reservedBuyer?.name || 'Buyer',
      hsn: passport.category === 'Electronics' ? '8471' : passport.category === 'Audio' ? '8518' : '8543',
    });
    setFlowStep('invoiced');
  };

  const handleDispatch = async () => {
    if (!passport) return;
    try {
      await apiClient.post(`/passports/${passport.passportId}/dispatch`);
      setFlowStep('dispatched');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Dispatch failed');
    }
  };

  const handleReset = () => {
    setFlowStep('idle');
    setPassport(null);
    setError('');
    setLabelData(null);
    setInvoiceData(null);
  };

  const stepOrder: FlowStep[] = ['scanned', 'verified', 'labeled', 'invoiced', 'dispatched'];
  const stepLabels: Record<string, string> = {
    scanned: 'Scanned',
    verified: 'Verified',
    labeled: 'Labeled',
    invoiced: 'Invoiced',
    dispatched: 'Dispatched',
  };

  const currentStepIdx = stepOrder.indexOf(flowStep);

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.6rem', fontWeight: 700, color: '#0F1111', marginBottom: '0.5rem' }}>
        Hub Operations Console
      </h1>
      <p style={{ color: '#565959', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
        Scan packages, verify condition, generate labels, and dispatch to circular route buyers
      </p>

      {/* Status Flow */}
      {flowStep !== 'idle' && (
        <div style={{
          background: '#FFFFFF',
          borderRadius: 8,
          padding: '1rem 1.5rem',
          border: '1px solid #D5D9D9',
          marginBottom: '1.5rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          {stepOrder.map((step, idx) => (
            <div key={step} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <div style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.72rem',
                fontWeight: 600,
                background: idx <= currentStepIdx ? '#067D06' : '#F0F2F2',
                color: idx <= currentStepIdx ? '#FFFFFF' : '#565959',
              }}>
                {idx <= currentStepIdx ? '\u2713' : idx + 1}
              </div>
              <span style={{
                fontSize: '0.78rem',
                fontWeight: idx <= currentStepIdx ? 600 : 400,
                color: idx <= currentStepIdx ? '#067D06' : '#565959',
              }}>
                {stepLabels[step]}
              </span>
              {idx < stepOrder.length - 1 && (
                <div style={{
                  width: 40,
                  height: 2,
                  background: idx < currentStepIdx ? '#067D06' : '#D5D9D9',
                  marginLeft: '0.5rem',
                }} />
              )}
            </div>
          ))}
        </div>
      )}

      {error && (
        <div style={{
          padding: '0.6rem 1rem',
          background: '#F8D7DA',
          border: '1px solid #F5C6CB',
          borderRadius: 6,
          marginBottom: '1rem',
          fontSize: '0.85rem',
          color: '#721C24',
        }}>
          {error}
        </div>
      )}

      {/* Idle State - Scan Button */}
      {flowStep === 'idle' && !showScanner && (
        <div style={{
          background: '#FFFFFF',
          borderRadius: 8,
          padding: '3rem',
          border: '1px solid #D5D9D9',
          textAlign: 'center',
        }}>
          <button
            onClick={() => setShowScanner(true)}
            style={{
              padding: '1rem 2.5rem',
              background: '#FF9900',
              border: 'none',
              borderRadius: 8,
              fontSize: '1.1rem',
              fontWeight: 700,
              color: '#0F1111',
              cursor: 'pointer',
              fontFamily: 'Arial, sans-serif',
              marginBottom: '1rem',
            }}
          >
            Scan Package
          </button>
          <p style={{ fontSize: '0.85rem', color: '#565959', margin: 0 }}>
            Scan a product QR code to begin hub processing
          </p>

          {/* Quick scan for demo */}
          <div style={{ marginTop: '1.5rem', borderTop: '1px solid #F0F2F2', paddingTop: '1rem' }}>
            <p style={{ fontSize: '0.78rem', color: '#888', marginBottom: '0.5rem' }}>Demo Quick Scan:</p>
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
              {['PP-1013', 'PP-1014', 'PP-1015'].map(id => (
                <button
                  key={id}
                  onClick={() => handleScan(id)}
                  style={{
                    padding: '0.4rem 0.8rem',
                    background: '#F0F2F2',
                    border: '1px solid #D5D9D9',
                    borderRadius: 4,
                    fontSize: '0.78rem',
                    cursor: 'pointer',
                    fontFamily: 'Arial, sans-serif',
                    color: '#0F1111',
                  }}
                >
                  {id}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Scanner View */}
      {showScanner && (
        <div style={{
          background: '#FFFFFF',
          borderRadius: 8,
          padding: '1.5rem',
          border: '1px solid #D5D9D9',
          textAlign: 'center',
        }}>
          <div id="hub-qr-reader" style={{ width: '100%', maxWidth: 400, margin: '0 auto' }} />
          <button
            onClick={() => setShowScanner(false)}
            style={{ marginTop: '1rem', padding: '0.4rem 1rem', background: '#F0F2F2', border: '1px solid #D5D9D9', borderRadius: 4, cursor: 'pointer', fontSize: '0.82rem', fontFamily: 'Arial, sans-serif' }}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Package Details */}
      {passport && flowStep !== 'idle' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
          {/* Product Details Card */}
          <div style={{
            background: '#FFFFFF',
            borderRadius: 8,
            padding: '1.5rem',
            border: '1px solid #D5D9D9',
          }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, marginTop: 0, marginBottom: '1rem', color: '#0F1111' }}>
              Package Details
            </h3>
            <div style={{ fontSize: '0.85rem', lineHeight: 2 }}>
              <div><span style={{ color: '#565959' }}>Product:</span> <strong>{passport.productName}</strong></div>
              <div><span style={{ color: '#565959' }}>Passport:</span> {passport.passportId}</div>
              <div><span style={{ color: '#565959' }}>Condition:</span> <span style={{
                padding: '0.1rem 0.4rem',
                borderRadius: 8,
                fontSize: '0.72rem',
                background: passport.condition === 'like_new' ? '#CCE5FF' : passport.condition === 'good' ? '#FFF3CD' : '#F8D7DA',
                color: passport.condition === 'like_new' ? '#004085' : passport.condition === 'good' ? '#856404' : '#721C24',
                fontWeight: 600,
              }}>{passport.condition.replace(/_/g, ' ')}</span></div>
              <div><span style={{ color: '#565959' }}>Eligibility:</span> <strong style={{ color: passport.eligibilityScore >= 75 ? '#067D06' : '#B12704' }}>{passport.eligibilityScore}/100</strong></div>
              <div><span style={{ color: '#565959' }}>Hub:</span> {passport.currentLocation.hub}</div>
            </div>
          </div>

          {/* Destination / Buyer */}
          <div style={{
            background: '#FFFFFF',
            borderRadius: 8,
            padding: '1.5rem',
            border: '1px solid #D5D9D9',
          }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, marginTop: 0, marginBottom: '1rem', color: '#0F1111' }}>
              Reserved Buyer Destination
            </h3>
            {passport.reservedBuyer ? (
              <div style={{ fontSize: '0.85rem', lineHeight: 2 }}>
                <div><span style={{ color: '#565959' }}>Name:</span> <strong>{passport.reservedBuyer.name}</strong></div>
                <div><span style={{ color: '#565959' }}>City:</span> {passport.reservedBuyer.city}</div>
                <div><span style={{ color: '#565959' }}>Distance:</span> {passport.reservedBuyer.distance}</div>
                <div><span style={{ color: '#565959' }}>Match Score:</span> <strong style={{ color: '#FF9900' }}>{passport.reservedBuyer.score}%</strong></div>
              </div>
            ) : (
              <p style={{ fontSize: '0.85rem', color: '#565959' }}>No buyer reserved yet. Run AI analysis first.</p>
            )}
          </div>

          {/* Condition Verification */}
          <div style={{
            background: '#FFFFFF',
            borderRadius: 8,
            padding: '1.5rem',
            border: '1px solid #D5D9D9',
            gridColumn: '1 / -1',
          }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, marginTop: 0, marginBottom: '1rem', color: '#0F1111' }}>
              Condition Verification
            </h3>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
              {[
                { label: 'Package Sealed', check: true },
                { label: 'No Visible Damage', check: true },
                { label: 'Original Packaging', check: passport.condition !== 'fair' },
                { label: 'Accessories Present', check: passport.condition === 'like_new' || passport.condition === 'new' },
              ].map((item, idx) => (
                <div key={idx} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  padding: '0.4rem 0.8rem',
                  background: item.check ? '#E7F9E7' : '#FFF8E7',
                  borderRadius: 4,
                  fontSize: '0.78rem',
                  color: item.check ? '#067D06' : '#6B4F00',
                }}>
                  <span>{item.check ? '\u2713' : '\u26A0'}</span>
                  {item.label}
                </div>
              ))}
            </div>

            {/* Action Buttons */}
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              {flowStep === 'scanned' && (
                <button onClick={handleVerify} style={actionBtnStyle('#FF9900')}>
                  Verify Condition
                </button>
              )}
              {flowStep === 'verified' && (
                <button onClick={handleGenerateLabel} style={actionBtnStyle('#FF9900')}>
                  Generate Label
                </button>
              )}
              {flowStep === 'labeled' && (
                <button onClick={handleGenerateInvoice} style={actionBtnStyle('#FF9900')}>
                  Generate Invoice
                </button>
              )}
              {flowStep === 'invoiced' && (
                <button onClick={handleDispatch} style={actionBtnStyle('#067D06')}>
                  Dispatch Package
                </button>
              )}
              {flowStep === 'dispatched' && (
                <div style={{
                  padding: '0.75rem 1.5rem',
                  background: '#E7F9E7',
                  borderRadius: 6,
                  fontSize: '0.9rem',
                  fontWeight: 600,
                  color: '#067D06',
                }}>
                  Package dispatched successfully to {passport.reservedBuyer?.name || 'buyer'}
                </div>
              )}
            </div>

            {/* Completed Steps Summary */}
            {currentStepIdx >= 1 && (
              <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid #F0F2F2' }}>
                <div style={{ fontSize: '0.78rem', color: '#565959' }}>
                  {currentStepIdx >= 1 && <div style={{ color: '#067D06' }}>{'\u2713'} Condition verified - {passport.condition.replace(/_/g, ' ')}</div>}
                  {currentStepIdx >= 2 && <div style={{ color: '#067D06' }}>{'\u2713'} Shipping label generated - {labelData?.awb || `AWB-${passport.passportId.replace('PP-', '')}-CR`}</div>}
                  {currentStepIdx >= 3 && <div style={{ color: '#067D06' }}>{'\u2713'} Invoice generated - {invoiceData?.invoiceNo || `INV-CR-${passport.passportId.replace('PP-', '')}`}</div>}
                  {currentStepIdx >= 4 && <div style={{ color: '#067D06' }}>{'\u2713'} Dispatched to {passport.reservedBuyer?.name || 'buyer'}</div>}
                </div>
              </div>
            )}
          </div>

          {/* Generated Shipping Label */}
          {labelData && (
            <div style={{ gridColumn: '1 / -1', background: '#FFFFFF', borderRadius: 8, border: '2px dashed #FF9900', padding: '1.5rem' }}>
              <h3 style={{ fontSize: '0.85rem', fontWeight: 700, color: '#565959', marginTop: 0, marginBottom: '1rem', textTransform: 'uppercase', letterSpacing: '1px' }}>
                Shipping Label Generated
              </h3>
              <div style={{ border: '2px solid #0F1111', borderRadius: 4, padding: '1.25rem', background: '#FFFFFF', maxWidth: 500 }}>
                {/* Label Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '2px solid #0F1111', paddingBottom: '0.75rem', marginBottom: '0.75rem' }}>
                  <div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0F1111' }}>CIRCULAR ROUTING</div>
                    <div style={{ fontSize: '0.7rem', color: '#565959' }}>Express Reallocation</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '0.7rem', color: '#565959' }}>Date</div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>{labelData.date}</div>
                  </div>
                </div>

                {/* AWB Barcode */}
                <div style={{ textAlign: 'center', padding: '0.75rem 0', borderBottom: '1px solid #D5D9D9', marginBottom: '0.75rem' }}>
                  <div style={{ fontFamily: 'monospace', fontSize: '1.5rem', letterSpacing: '3px', color: '#0F1111' }}>
                    {labelData.barcode}
                  </div>
                  <div style={{ fontSize: '0.82rem', fontWeight: 700, marginTop: '0.25rem', color: '#0F1111' }}>
                    {labelData.awb}
                  </div>
                </div>

                {/* From / To */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div>
                    <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#565959', textTransform: 'uppercase', marginBottom: '0.25rem' }}>From (Hub)</div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#0F1111' }}>{labelData.from}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#565959', textTransform: 'uppercase', marginBottom: '0.25rem' }}>To (Buyer)</div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#0F1111' }}>{labelData.to}</div>
                    <div style={{ fontSize: '0.78rem', color: '#565959' }}>{labelData.toCity}</div>
                  </div>
                </div>

                {/* Footer */}
                <div style={{ marginTop: '0.75rem', paddingTop: '0.5rem', borderTop: '1px solid #D5D9D9', display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#565959' }}>
                  <span>Passport: {passport.passportId}</span>
                  <span>Mode: Direct Hub-to-Buyer</span>
                  <span>Priority: HIGH</span>
                </div>
              </div>
            </div>
          )}

          {/* Generated Invoice */}
          {invoiceData && (
            <div style={{ gridColumn: '1 / -1', background: '#FFFFFF', borderRadius: 8, border: '2px dashed #067D06', padding: '1.5rem' }}>
              <h3 style={{ fontSize: '0.85rem', fontWeight: 700, color: '#565959', marginTop: 0, marginBottom: '1rem', textTransform: 'uppercase', letterSpacing: '1px' }}>
                GST Tax Invoice Generated
              </h3>
              <div style={{ border: '1px solid #D5D9D9', borderRadius: 4, padding: '1.25rem', background: '#FFFFFF', maxWidth: 500 }}>
                {/* Invoice Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #D5D9D9', paddingBottom: '0.75rem', marginBottom: '0.75rem' }}>
                  <div>
                    <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0F1111' }}>TAX INVOICE</div>
                    <div style={{ fontSize: '0.72rem', color: '#565959' }}>Circular Routing Reallocation</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '0.72rem', color: '#565959' }}>Invoice No.</div>
                    <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#0F1111' }}>{invoiceData.invoiceNo}</div>
                    <div style={{ fontSize: '0.72rem', color: '#565959', marginTop: '0.25rem' }}>{invoiceData.date}</div>
                  </div>
                </div>

                {/* Buyer */}
                <div style={{ marginBottom: '0.75rem', paddingBottom: '0.5rem', borderBottom: '1px solid #F0F2F2' }}>
                  <div style={{ fontSize: '0.68rem', fontWeight: 600, color: '#565959', textTransform: 'uppercase' }}>Bill To</div>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#0F1111' }}>{invoiceData.buyerName}</div>
                </div>

                {/* Line Items */}
                <table style={{ width: '100%', fontSize: '0.78rem', borderCollapse: 'collapse', marginBottom: '0.75rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #D5D9D9' }}>
                      <th style={{ textAlign: 'left', padding: '0.4rem 0', color: '#565959', fontWeight: 600 }}>Item</th>
                      <th style={{ textAlign: 'left', padding: '0.4rem 0', color: '#565959', fontWeight: 600 }}>HSN</th>
                      <th style={{ textAlign: 'right', padding: '0.4rem 0', color: '#565959', fontWeight: 600 }}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style={{ padding: '0.4rem 0', color: '#0F1111' }}>{invoiceData.product}</td>
                      <td style={{ padding: '0.4rem 0', color: '#565959' }}>{invoiceData.hsn}</td>
                      <td style={{ padding: '0.4rem 0', textAlign: 'right', color: '#0F1111' }}>Rs {invoiceData.amount}</td>
                    </tr>
                  </tbody>
                </table>

                {/* Totals */}
                <div style={{ borderTop: '1px solid #D5D9D9', paddingTop: '0.5rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: '#565959', marginBottom: '0.25rem' }}>
                    <span>Subtotal</span><span>Rs {invoiceData.amount}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: '#565959', marginBottom: '0.25rem' }}>
                    <span>GST (18%)</span><span>Rs {invoiceData.gst}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', fontWeight: 700, color: '#0F1111', marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '2px solid #0F1111' }}>
                    <span>Total</span><span>Rs {invoiceData.total}</span>
                  </div>
                </div>

                {/* Footer */}
                <div style={{ marginTop: '0.75rem', fontSize: '0.65rem', color: '#767676', textAlign: 'center' }}>
                  GSTIN: 23AABCU9603R1ZM | Circular Routing Engine | Auto-generated document
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Reset button */}
      {flowStep !== 'idle' && (
        <div style={{ textAlign: 'center', marginTop: '1.5rem' }}>
          <button onClick={handleReset} style={{
            padding: '0.5rem 1.2rem',
            background: '#F0F2F2',
            border: '1px solid #D5D9D9',
            borderRadius: 4,
            fontSize: '0.82rem',
            cursor: 'pointer',
            fontFamily: 'Arial, sans-serif',
            color: '#0F1111',
          }}>
            Scan Another Package
          </button>
        </div>
      )}
    </div>
  );
}

function actionBtnStyle(bg: string): React.CSSProperties {
  return {
    padding: '0.6rem 1.5rem',
    background: bg,
    border: 'none',
    borderRadius: 4,
    fontWeight: 600,
    fontSize: '0.85rem',
    color: bg === '#067D06' ? '#FFFFFF' : '#0F1111',
    cursor: 'pointer',
    fontFamily: 'Arial, sans-serif',
  };
}
