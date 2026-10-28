import { useState } from 'react';
import { Camera, Search, QrCode } from 'lucide-react';
import { T, MONO, Btn, Card, Alert } from '../shared/ui';
import { TRANSFERS } from './fixtures';
import { type ScanState } from './types';

export function ScanReceiptEntry({
  role,
  onFound,
}: {
  role: 'distributor' | 'retailer';
  onFound: (transferId: string) => void;
}) {
  const [scanState, setScanState] = useState<ScanState>('idle');
  const [manualRef, setManualRef] = useState('');
  const [cameraMode, setCameraMode] = useState(false);

  const expectedRecipient =
    role === 'distributor' ? 'Swift Distribution Sdn. Bhd.' : 'FreshMart Retail Sdn. Bhd.';

  const search = (ref: string) => {
    const id = ref.trim().toUpperCase();
    setScanState('searching');
    setTimeout(() => {
      const transfer = TRANSFERS[id];
      if (!transfer) {
        setScanState('unknown');
        return;
      }
      if (transfer.status === 'received') {
        setScanState('already_received');
        return;
      }
      if (transfer.status === 'cancelled' || transfer.status === 'rejected') {
        setScanState('cancelled');
        return;
      }
      if (transfer.recipient !== expectedRecipient) {
        setScanState('wrong_recipient');
        return;
      }
      setScanState('found');
      onFound(id);
    }, 1200);
  };

  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      <Card>
        <div style={{ fontWeight: 700, fontSize: 15, color: T.navy, marginBottom: 20 }}>
          Scan to Confirm Receipt
        </div>

        {/* Camera area */}
        <div
          onClick={() => setCameraMode(true)}
          style={{
            border: `2px dashed ${cameraMode ? T.teal : T.border2}`,
            borderRadius: 12,
            padding: '28px 20px',
            textAlign: 'center',
            marginBottom: 20,
            cursor: 'pointer',
            transition: 'border-color 0.15s',
            background: cameraMode ? T.tealLight : 'transparent',
          }}
        >
          {!cameraMode ? (
            <>
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 12,
                  background: T.tealLight,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 12px',
                }}
              >
                <Camera size={24} color={T.teal} />
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: T.navy, marginBottom: 4 }}>
                Scan Receipt QR Code
              </div>
              <div style={{ fontSize: 12, color: T.text2, marginBottom: 14 }}>
                Tap to activate camera
              </div>
              <div onClick={(e) => e.stopPropagation()}>
                <Btn size="sm" variant="secondary" onClick={() => setCameraMode(true)}>
                  Enable Camera
                </Btn>
              </div>
            </>
          ) : (
            <>
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 12,
                  background: T.greenBg,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 12px',
                }}
              >
                <QrCode size={24} color={T.green} />
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: T.navy, marginBottom: 4 }}>
                Camera Active
              </div>
              <div style={{ fontSize: 12, color: T.text2, marginBottom: 14 }}>
                Point at the Receipt Confirmation QR code
              </div>
              <div
                style={{ display: 'flex', gap: 8, justifyContent: 'center' }}
                onClick={(e) => e.stopPropagation()}
              >
                <Btn size="sm" variant="outline" onClick={() => setCameraMode(false)}>
                  Cancel
                </Btn>
                <Btn
                  size="sm"
                  onClick={() =>
                    search(role === 'distributor' ? 'TRANSFER-2026-001' : 'TRANSFER-2026-002')
                  }
                >
                  Simulate Scan
                </Btn>
              </div>
            </>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div style={{ flex: 1, height: 1, background: T.border }} />
          <span style={{ fontSize: 12, color: T.text3 }}>or enter reference manually</span>
          <div style={{ flex: 1, height: 1, background: T.border }} />
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 12px',
              background: T.surface2,
              border: `1px solid ${T.border}`,
              borderRadius: 8,
            }}
          >
            <Search size={14} color={T.text3} />
            <input
              value={manualRef}
              onChange={(e) => setManualRef(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && search(manualRef)}
              placeholder="e.g. TRANSFER-2026-001"
              style={{
                border: 'none',
                background: 'none',
                color: T.text,
                fontSize: 13,
                outline: 'none',
                flex: 1,
                fontFamily: MONO,
              }}
            />
          </div>
          <Btn onClick={() => search(manualRef)} disabled={!manualRef.trim()}>
            Search
          </Btn>
        </div>

        {scanState === 'searching' && (
          <div style={{ textAlign: 'center', padding: '12px 0', fontSize: 13, color: T.text2 }}>
            Retrieving transfer details…
          </div>
        )}
        {scanState === 'unknown' && (
          <Alert
            type="error"
            message={`No transfer found for "${manualRef}". Check the reference and try again.`}
          />
        )}
        {scanState === 'wrong_recipient' && (
          <Alert
            type="error"
            message={`This shipment is not assigned to ${expectedRecipient}. Sign in with an authorised wallet for the intended recipient.`}
          />
        )}
        {scanState === 'already_received' && (
          <Alert
            type="warning"
            message="This shipment has already been received. No further action required."
          />
        )}
        {scanState === 'cancelled' && (
          <Alert
            type="error"
            message="This transfer is no longer available for receipt confirmation."
          />
        )}
        {scanState === 'product_qr' && (
          <>
            <Alert
              type="warning"
              message="This is a product information QR. Use the shipment's Receipt Confirmation QR to confirm receipt."
            />
            <div style={{ marginTop: 8 }}>
              <Btn variant="outline" size="sm">
                View Product Traceability
              </Btn>
            </div>
          </>
        )}

        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 11, color: T.text3, marginBottom: 6 }}>Demo — quick load:</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {Object.keys(TRANSFERS)
              .filter((k) => {
                const t = TRANSFERS[k];
                return role === 'distributor'
                  ? t.recipient.includes('Swift')
                  : t.recipient.includes('FreshMart');
              })
              .map((k) => (
                <button
                  key={k}
                  onClick={() => search(k)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 6,
                    border: `1px solid ${T.border}`,
                    background: T.surface2,
                    cursor: 'pointer',
                    fontFamily: MONO,
                    fontSize: 10,
                    color: T.teal,
                  }}
                >
                  {k}
                </button>
              ))}
          </div>
        </div>
      </Card>
    </div>
  );
}
