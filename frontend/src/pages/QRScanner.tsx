import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Html5QrcodeScanner } from 'html5-qrcode';

export default function QRScanner() {
  const navigate = useNavigate();
  const [manualId, setManualId] = useState('');
  const [scanStatus, setScanStatus] = useState<'scanning' | 'success' | 'error'>('scanning');
  const [scannedValue, setScannedValue] = useState('');
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);

  useEffect(() => {
    const scanner = new Html5QrcodeScanner('qr-reader', {
      fps: 10,
      qrbox: { width: 250, height: 250 },
    }, false);

    scanner.render(
      (decodedText) => {
        setScanStatus('success');
        setScannedValue(decodedText);
        scanner.clear().catch(() => {});
        // Extract passport ID: CIRCULAR-PP-1001 -> PP-1001
        const passportId = decodedText.replace('CIRCULAR-', '');
        setTimeout(() => {
          navigate(`/passport/${passportId}`);
        }, 800);
      },
      () => { /* ignore scan errors */ }
    );

    scannerRef.current = scanner;

    return () => {
      scanner.clear().catch(() => {});
    };
  }, [navigate]);

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const id = manualId.trim().toUpperCase();
    if (id) {
      const passportId = id.startsWith('PP-') ? id : `PP-${id}`;
      navigate(`/passport/${passportId}`);
    }
  };

  return (
    <div style={{ maxWidth: 600, margin: '0 auto', textAlign: 'center' }}>
      <h1 style={{ fontSize: '1.6rem', fontWeight: 700, color: '#0F1111', marginBottom: '0.5rem' }}>
        Scan Product QR Code
      </h1>
      <p style={{ color: '#565959', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
        Point your camera at the product passport QR code to view its circular routing journey
      </p>

      {/* Scanner Status */}
      {scanStatus === 'scanning' && (
        <div style={{
          padding: '0.6rem 1rem',
          background: '#FFF8E7',
          border: '1px solid #FF9900',
          borderRadius: 6,
          marginBottom: '1rem',
          fontSize: '0.85rem',
          color: '#6B4F00',
        }}>
          Point camera at QR code...
        </div>
      )}

      {scanStatus === 'success' && (
        <div style={{
          padding: '0.6rem 1rem',
          background: '#E7F9E7',
          border: '1px solid #067D06',
          borderRadius: 6,
          marginBottom: '1rem',
          fontSize: '0.85rem',
          color: '#067D06',
          fontWeight: 600,
        }}>
          Scanned: {scannedValue} - Redirecting...
        </div>
      )}

      {/* QR Scanner Area */}
      <div style={{
        background: '#FFFFFF',
        borderRadius: 8,
        padding: '1.5rem',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        border: '1px solid #D5D9D9',
        marginBottom: '2rem',
      }}>
        <div id="qr-reader" style={{ width: '100%' }} />
      </div>

      {/* Manual Entry */}
      <div style={{
        background: '#FFFFFF',
        borderRadius: 8,
        padding: '1.5rem',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        border: '1px solid #D5D9D9',
      }}>
        <p style={{ fontSize: '0.9rem', color: '#565959', marginBottom: '1rem' }}>
          Or enter passport ID manually
        </p>
        <form onSubmit={handleManualSubmit} style={{ display: 'flex', gap: '0.5rem' }}>
          <input
            type="text"
            value={manualId}
            onChange={(e) => setManualId(e.target.value)}
            placeholder="e.g. PP-1001"
            style={{
              flex: 1,
              padding: '0.6rem 0.75rem',
              border: '1px solid #D5D9D9',
              borderRadius: 4,
              fontSize: '0.9rem',
              outline: 'none',
              fontFamily: 'Arial, sans-serif',
            }}
            aria-label="Passport ID"
          />
          <button
            type="submit"
            style={{
              padding: '0.6rem 1.2rem',
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
            Look Up
          </button>
        </form>
      </div>

      {/* Quick Access */}
      <div style={{ marginTop: '2rem' }}>
        <p style={{ fontSize: '0.85rem', color: '#565959', marginBottom: '0.75rem' }}>Quick Demo Access:</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', justifyContent: 'center' }}>
          {['PP-1001', 'PP-1002', 'PP-1005', 'PP-1013', 'PP-1018'].map(id => (
            <button
              key={id}
              onClick={() => navigate(`/passport/${id}`)}
              style={{
                padding: '0.4rem 0.8rem',
                background: '#F0F2F2',
                border: '1px solid #D5D9D9',
                borderRadius: 4,
                fontSize: '0.8rem',
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
  );
}
