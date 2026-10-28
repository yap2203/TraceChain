import { Camera, ScanLine, CheckCircle2, Upload, Mail } from 'lucide-react';
import { T, UI, MONO, Btn, Card, Alert, StepProgress } from '../../shared/ui';
import { RECEIPT_STEPS, QR_ERROR_MESSAGES } from '../fixtures';
import { useMandatoryQRGate } from './useMandatoryQRGate';
import { VerifiedQRPanel } from './VerifiedQRPanel';
import { CameraScanPanel } from './CameraScanPanel';
import { UploadEvidencePanel } from './UploadEvidencePanel';
export function MandatoryQRGate({
  expectedTransferId,
  role,
  onVerified,
  onBack,
}: {
  expectedTransferId?: string;
  role: 'distributor' | 'retailer';
  onVerified: (transferId: string, method: 'camera' | 'upload') => void;
  onBack: () => void;
}) {
  const model = useMandatoryQRGate({ expectedTransferId, role, onVerified, onBack });
  const { tab, setTab, error, setError, requestSent, setRequestSent, verified, validate } = model;
  // ── Verified panel ──────────────────────────────────────────────────────────
  if (verified) return <VerifiedQRPanel model={model} />;
  // ── Main gate screen ────────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 780, margin: '0 auto' }}>
      <StepProgress steps={RECEIPT_STEPS} current={0} />

      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 6 }}>
          <Btn onClick={onBack} variant="ghost" size="sm">
            Back
          </Btn>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: T.navy, margin: 0 }}>
            Identify Shipment
          </h2>
        </div>
        <p style={{ fontSize: 13, color: T.text2, margin: '0 0 0 64px' }}>
          Scan the shipment's Receipt Confirmation QR or upload an image of it before confirming
          receipt.
        </p>
      </div>

      {/* Tab selector */}
      <div
        style={{
          display: 'flex',
          gap: 0,
          marginBottom: 20,
          background: T.surface2,
          borderRadius: 10,
          padding: 4,
          border: `1px solid ${T.border}`,
        }}
      >
        {(['camera', 'upload'] as const).map((t) => (
          <button
            key={t}
            onClick={() => {
              setTab(t);
              setError(null);
            }}
            style={{
              flex: 1,
              padding: '10px 16px',
              borderRadius: 7,
              border: 'none',
              cursor: 'pointer',
              background: tab === t ? T.surface : 'transparent',
              color: tab === t ? T.navy : T.text2,
              fontFamily: UI,
              fontSize: 13,
              fontWeight: tab === t ? 600 : 400,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              boxShadow: tab === t ? '0 1px 4px rgba(0,0,0,0.2)' : 'none',
              transition: 'all 0.15s',
            }}
          >
            {t === 'camera' ? <Camera size={15} /> : <Upload size={15} />}
            {t === 'camera' ? 'Scan with Camera' : 'Upload Evidence Image'}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 20 }}>
        <Card>
          {/* ── Camera tab ── */}
          {tab === 'camera' && <CameraScanPanel model={model} />}

          {/* ── Upload tab ── */}
          {tab === 'upload' && <UploadEvidencePanel model={model} />}

          {/* Error */}
          {error && (
            <div style={{ marginTop: 14 }}>
              <Alert type="error" message={QR_ERROR_MESSAGES[error]} />
              {error === 'product_qr' && (
                <div style={{ marginTop: 8 }}>
                  <Btn size="sm" variant="outline">
                    View Product Traceability
                  </Btn>
                </div>
              )}
            </div>
          )}
        </Card>

        {/* Right panel */}
        <div style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
          {/* What to scan */}
          <Card>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: T.text2,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                marginBottom: 12,
              }}
            >
              Accepted evidence
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              {[
                {
                  label: 'Receipt Confirmation QR',
                  desc: "Scan or upload a photo of the sender's QR code.",
                },
                {
                  label: 'Delivery Note / DO',
                  desc: 'Scanned delivery order showing the transfer reference.',
                },
                { label: 'Photo of Goods', desc: 'Photo of the received products and packaging.' },
                {
                  label: 'Signed Receipt Document',
                  desc: 'Any signed paper receipt from the sender.',
                },
              ].map((item) => (
                <div
                  key={item.label}
                  style={{
                    display: 'flex',
                    gap: 10,
                    padding: '9px 12px',
                    background: T.greenBg,
                    borderRadius: 8,
                    border: `1px solid color-mix(in srgb, ${T.green} 13%, transparent)`,
                  }}
                >
                  <CheckCircle2 size={13} color={T.green} style={{ flexShrink: 0, marginTop: 2 }} />
                  <div style={{ fontSize: 11.5, color: T.text, lineHeight: 1.5 }}>
                    <div style={{ fontWeight: 600, color: T.green, marginBottom: 1 }}>
                      {item.label}
                    </div>
                    {item.desc}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Demo quick-load */}
          {expectedTransferId && (
            <div
              style={{
                padding: '12px 14px',
                background: T.surface2,
                borderRadius: 10,
                border: `1px solid ${T.border}`,
              }}
            >
              <div style={{ fontSize: 11, color: T.text3, marginBottom: 8 }}>Expected shipment</div>
              <div
                style={{
                  fontFamily: MONO,
                  fontSize: 11.5,
                  color: T.teal,
                  fontWeight: 600,
                  marginBottom: 8,
                }}
              >
                {expectedTransferId}
              </div>
              <Btn
                size="sm"
                variant="secondary"
                full
                onClick={() => validate(expectedTransferId, 'camera')}
              >
                <ScanLine size={12} style={{ marginRight: 4 }} />
                Demo: Simulate Valid Scan
              </Btn>
            </div>
          )}

          {/* Request QR from sender */}
          <div
            style={{
              padding: '12px 14px',
              background: T.surface2,
              borderRadius: 10,
              border: `1px solid ${T.border}`,
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 600, color: T.text2, marginBottom: 6 }}>
              Can't find the QR?
            </div>
            <div style={{ fontSize: 12, color: T.text3, marginBottom: 10, lineHeight: 1.5 }}>
              Ask the sender to resend or reprint the shipment's Receipt Confirmation QR. The sender
              can retrieve it from Transfer Details.
            </div>
            {requestSent ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 12,
                  color: T.green,
                }}
              >
                <CheckCircle2 size={13} />
                Request sent
              </div>
            ) : (
              <Btn size="sm" variant="outline" full onClick={() => setRequestSent(true)}>
                <Mail size={12} style={{ marginRight: 4 }} />
                Request QR from Sender
              </Btn>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
