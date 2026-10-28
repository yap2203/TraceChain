import { CheckCircle2, Upload, RotateCcw } from 'lucide-react';
import { T, Btn } from '../../shared/ui';
import type { QrGateModel } from './useMandatoryQRGate';
export function UploadEvidencePanel({ model }: { model: QrGateModel }) {
  const {
    uploadFile,
    setUploadFile,
    uploadPreview,
    setPreview,
    readingQR,
    setError,
    fileRef,
    dropRef,
    handleFileSelect,
    readUploadedQR,
    handleDrop,
  } = model;
  return (
    <div>
      <div style={{ fontWeight: 700, fontSize: 14, color: T.navy, marginBottom: 14 }}>
        Upload Product Evidence Image
      </div>
      <div style={{ fontSize: 12, color: T.text2, marginBottom: 14 }}>
        Upload a photo, delivery note, or receipt documenting the product evidence for this
        shipment.
      </div>

      {!uploadPreview ? (
        <div
          ref={dropRef}
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          onClick={() => fileRef.current?.click()}
          style={{
            border: `2px dashed ${T.border2}`,
            borderRadius: 12,
            padding: '36px 24px',
            textAlign: 'center',
            cursor: 'pointer',
            marginBottom: 14,
            transition: 'border-color 0.15s',
            background: T.surface2,
          }}
        >
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
            <Upload size={24} color={T.teal} />
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: T.navy, marginBottom: 6 }}>
            Drop evidence image here
          </div>
          <div style={{ fontSize: 12, color: T.text2, marginBottom: 14 }}>
            PNG or JPG, max 10 MB
          </div>
          <div onClick={(e) => e.stopPropagation()}>
            <Btn size="sm" variant="secondary" onClick={() => fileRef.current?.click()}>
              Browse Files
            </Btn>
          </div>
        </div>
      ) : (
        <div style={{ marginBottom: 14 }}>
          <div
            style={{
              position: 'relative',
              width: '100%',
              aspectRatio: '4/3',
              background: T.navyDark,
              borderRadius: 12,
              overflow: 'hidden',
              marginBottom: 10,
              border: `1px solid ${T.border}`,
            }}
          >
            <img
              src={uploadPreview}
              alt="QR preview"
              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            />
          </div>
          <div style={{ fontSize: 11.5, color: T.text2, marginBottom: 10 }}>{uploadFile?.name}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn
              size="sm"
              variant="secondary"
              onClick={() => {
                setUploadFile(null);
                setPreview(null);
                setError(null);
              }}
            >
              <RotateCcw size={12} style={{ marginRight: 4 }} />
              Replace Image
            </Btn>
            <Btn size="sm" onClick={readUploadedQR} disabled={readingQR} full>
              {readingQR ? (
                <>
                  <div
                    style={{
                      width: 13,
                      height: 13,
                      border: `2px solid rgba(255,255,255,0.4)`,
                      borderTopColor: '#fff',
                      borderRadius: '50%',
                      animation: 'workspace-spin 0.8s linear infinite',
                      marginRight: 6,
                    }}
                  />
                  Processing…
                </>
              ) : (
                <>
                  <CheckCircle2 size={13} style={{ marginRight: 4 }} />
                  Submit Evidence
                </>
              )}
            </Btn>
          </div>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFileSelect(f);
        }}
      />

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
        Upload a clear photo or scanned document. Click <strong>Submit Evidence</strong> to validate
        and attach it to this shipment.
      </div>
    </div>
  );
}
