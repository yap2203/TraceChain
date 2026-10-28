import { Camera, ScanLine, XCircle, Upload, RefreshCw } from 'lucide-react';
import { T, Btn } from '../../shared/ui';
import type { QrGateModel } from './useMandatoryQRGate';
export function CameraScanPanel({ model }: { model: QrGateModel }) {
  const { setTab, cameraPhase, setError, startCamera, simulateCameraScan } = model;
  return (
    <div>
      <div style={{ fontWeight: 700, fontSize: 14, color: T.navy, marginBottom: 14 }}>
        Camera Scan
      </div>

      {/* Camera preview area */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: '4/3',
          background: T.navyDark,
          borderRadius: 12,
          overflow: 'hidden',
          marginBottom: 16,
          border: `1px solid ${cameraPhase === 'active' || cameraPhase === 'scanning' ? T.teal : T.border}`,
          transition: 'border-color 0.2s',
        }}
      >
        {/* Corner guides */}
        {(cameraPhase === 'active' || cameraPhase === 'scanning') && (
          <>
            {[
              { top: 12, left: 12 },
              { top: 12, right: 12 },
              { bottom: 12, left: 12 },
              { bottom: 12, right: 12 },
            ].map((pos, i) => (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  ...(pos as any),
                  width: 28,
                  height: 28,
                  borderColor: T.teal,
                  borderStyle: 'solid',
                  borderWidth: '0',
                  ...(i === 0
                    ? { borderTopWidth: 2, borderLeftWidth: 2 }
                    : i === 1
                      ? { borderTopWidth: 2, borderRightWidth: 2 }
                      : i === 2
                        ? { borderBottomWidth: 2, borderLeftWidth: 2 }
                        : { borderBottomWidth: 2, borderRightWidth: 2 }),
                  borderRadius: 3,
                }}
              />
            ))}
            {/* Scan line */}
            <div
              style={{
                position: 'absolute',
                left: 12,
                right: 12,
                height: 2,
                background: `linear-gradient(90deg, transparent, ${T.teal}, transparent)`,
                animation: 'scanline 2s ease-in-out infinite',
                boxShadow: `0 0 8px ${T.teal}`,
              }}
            />
            {/* Center QR outline */}
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <div
                style={{
                  width: 160,
                  height: 160,
                  border: `1px dashed ${T.border2}`,
                  borderRadius: 8,
                  opacity: 0.5,
                }}
              />
            </div>
          </>
        )}

        {cameraPhase === 'idle' && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
            }}
          >
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 14,
                background: T.tealLight,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Camera size={26} color={T.teal} />
            </div>
            <div
              style={{
                fontSize: 13,
                color: T.text2,
                textAlign: 'center',
                lineHeight: 1.6,
                maxWidth: 220,
              }}
            >
              Allow camera access to scan the Receipt Confirmation QR code.
            </div>
            <Btn onClick={startCamera} size="sm">
              Enable Camera
            </Btn>
          </div>
        )}

        {cameraPhase === 'requesting' && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                border: `3px solid ${T.teal}`,
                borderTopColor: 'transparent',
                borderRadius: '50%',
                animation: 'workspace-spin 0.8s linear infinite',
              }}
            />
            <div style={{ fontSize: 13, color: T.text2 }}>Requesting camera permission…</div>
          </div>
        )}

        {(cameraPhase === 'active' || cameraPhase === 'scanning') && (
          <div
            style={{
              position: 'absolute',
              bottom: 12,
              left: 0,
              right: 0,
              display: 'flex',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            <div
              style={{
                padding: '5px 12px',
                background: 'rgba(0,0,0,0.7)',
                borderRadius: 20,
                fontSize: 12,
                color: T.text2,
              }}
            >
              {cameraPhase === 'scanning' ? 'Reading QR code…' : 'Point at the receipt QR code'}
            </div>
          </div>
        )}

        {cameraPhase === 'denied' && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
            }}
          >
            <XCircle size={32} color={T.red} />
            <div
              style={{
                fontSize: 13,
                color: T.text2,
                textAlign: 'center',
                maxWidth: 240,
                lineHeight: 1.6,
              }}
            >
              Camera unavailable. Upload a product evidence image to continue.
            </div>
          </div>
        )}
      </div>

      {/* Camera controls */}
      {cameraPhase === 'idle' && null}
      {(cameraPhase === 'active' || cameraPhase === 'scanning') && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <Btn size="sm" variant="secondary" onClick={() => {}}>
            <RefreshCw size={13} style={{ marginRight: 4 }} />
            Switch Camera
          </Btn>
          <Btn size="sm" onClick={simulateCameraScan} disabled={cameraPhase === 'scanning'} full>
            {cameraPhase === 'scanning' ? (
              <>
                <div
                  style={{
                    width: 14,
                    height: 14,
                    border: `2px solid rgba(255,255,255,0.5)`,
                    borderTopColor: '#fff',
                    borderRadius: '50%',
                    animation: 'workspace-spin 0.8s linear infinite',
                    marginRight: 6,
                  }}
                />
                Reading…
              </>
            ) : (
              <>
                <ScanLine size={13} style={{ marginRight: 4 }} />
                Simulate Scan
              </>
            )}
          </Btn>
        </div>
      )}
      {cameraPhase === 'denied' && (
        <Btn
          size="sm"
          variant="secondary"
          onClick={() => {
            setTab('upload');
            setError(null);
          }}
          full
          style={{ marginBottom: 12 }}
        >
          <Upload size={13} style={{ marginRight: 6 }} />
          Upload Evidence Image Instead
        </Btn>
      )}

      {/* Instructions */}
      <div
        style={{
          fontSize: 12,
          color: T.text3,
          lineHeight: 1.6,
          padding: '10px 12px',
          background: T.surface2,
          borderRadius: 8,
        }}
      >
        <div style={{ fontWeight: 600, color: T.text2, marginBottom: 4 }}>How to scan</div>
        Hold the shipment QR code steady within the frame. The scan stops automatically when a valid
        code is detected.
      </div>
    </div>
  );
}
