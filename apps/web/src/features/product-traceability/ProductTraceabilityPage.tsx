import { Camera, FileImage, RotateCcw, Search, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  ZxingTransferQrReader,
  cameraErrorMessage,
  type TransferQrReader,
} from '../custody-transfers/qr-reader';
import {
  ProductTraceabilityApiError,
  resolveProductTraceability,
} from './product-traceability.api';
import { createProductQrPayload } from './product-qr';
import type { ProductTraceabilityResponse } from './product-traceability.types';
import './product-traceability.css';

export function ProductTraceabilityPage({
  initialBatchId,
  onBack,
  reader,
}: {
  initialBatchId?: string;
  onBack?: () => void;
  reader?: TransferQrReader;
}) {
  const readerRef = useRef(reader ?? new ZxingTransferQrReader());
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const stopCameraRef = useRef<(() => void) | undefined>(undefined);
  const activeRequest = useRef(false);
  const [payload, setPayload] = useState('');
  const [result, setResult] = useState<ProductTraceabilityResponse>();
  const [state, setState] = useState<'idle' | 'loading' | 'verified' | 'error'>('idle');
  const [error, setError] = useState('');
  const [cameraActive, setCameraActive] = useState(false);

  const stopCamera = useCallback(() => {
    stopCameraRef.current?.();
    stopCameraRef.current = undefined;
    setCameraActive(false);
  }, []);

  const resolve = useCallback(
    async (value: string) => {
      if (!value.trim() || activeRequest.current) return;
      activeRequest.current = true;
      stopCamera();
      setState('loading');
      setError('');
      try {
        const resolved = await resolveProductTraceability(value.trim());
        setResult(resolved);
        setState('verified');
      } catch (cause) {
        setResult(undefined);
        setError(traceabilityError(cause));
        setState('error');
      } finally {
        activeRequest.current = false;
      }
    },
    [stopCamera],
  );

  useEffect(() => {
    let initial: string | undefined;
    try {
      if (initialBatchId) initial = createProductQrPayload(initialBatchId);
      else if (window.location.pathname === '/trace/product' && window.location.search)
        initial = window.location.href;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The product reference is invalid.');
      setState('error');
    }
    if (initial) {
      setPayload(initial);
      void resolve(initial);
    }
    return stopCamera;
  }, [initialBatchId, resolve, stopCamera]);

  const startCamera = async () => {
    stopCamera();
    setError('');
    try {
      setCameraActive(true);
      stopCameraRef.current = await readerRef.current.startCamera(
        videoRef.current!,
        (value) => {
          setPayload(value);
          void resolve(value);
        },
        (cause) => {
          setError(cameraErrorMessage(cause));
          setState('error');
          stopCamera();
        },
      );
    } catch (cause) {
      setError(cameraErrorMessage(cause));
      setState('error');
      stopCamera();
    }
  };

  return (
    <main className="product-trace-page">
      <div className="product-trace-shell">
        <header className="product-trace-header">
          <div className="product-trace-brand">
            <img alt="" src="/tracechain-mark.svg" />
            <div>
              <strong>TraceChain</strong>
              <div className="product-trace-muted">Product traceability</div>
            </div>
          </div>
          {onBack && <button onClick={onBack}>Back to workspace</button>}
        </header>

        {state === 'loading' && (
          <section className="product-trace-card" aria-live="polite">
            <h2>Verifying blockchain traceability record…</h2>
            <p className="product-trace-muted">Reading the configured TraceChain contracts.</p>
          </section>
        )}

        {state === 'verified' && result && <TraceabilityRecord result={result} />}

        {(state === 'idle' || state === 'error') && (
          <section className="product-trace-card product-trace-controls">
            <div>
              <span className="product-trace-eyebrow">Read-only verification</span>
              <h1>Verify a product record</h1>
              <p className="product-trace-muted">
                Paste a TraceChain product link, upload its QR image, or use this device’s camera.
              </p>
            </div>
            {error && (
              <div className="product-trace-error" role="alert">
                {error}
              </div>
            )}
            <textarea
              aria-label="Product traceability link"
              onChange={(event) => setPayload(event.target.value)}
              placeholder="https://tracechain.example/trace/product?v=1&chainId=…"
              value={payload}
            />
            <div className="product-trace-buttons">
              <button
                className="primary"
                disabled={!payload.trim()}
                onClick={() => void resolve(payload)}
              >
                <Search size={16} /> Verify product
              </button>
              <input
                ref={fileInputRef}
                aria-label="Upload product QR image"
                accept="image/*"
                hidden
                type="file"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  void readerRef.current
                    .decodeImage(file)
                    .then((value) => {
                      setPayload(value);
                      return resolve(value);
                    })
                    .catch(() => {
                      setError('No valid product QR was found in that image.');
                      setState('error');
                    });
                }}
              />
              <button type="button" onClick={() => fileInputRef.current?.click()}>
                <FileImage size={16} /> Upload QR image
              </button>
              <button type="button" onClick={() => void startCamera()}>
                <Camera size={16} /> Use camera
              </button>
            </div>
            <div className="product-trace-camera" hidden={!cameraActive}>
              <video ref={videoRef} muted playsInline />
              <button type="button" onClick={stopCamera}>
                Stop camera
              </button>
            </div>
            <small className="product-trace-muted">
              Scanning is read-only. It cannot confirm receipt or change custody.
            </small>
          </section>
        )}

        {state === 'verified' && (
          <div style={{ marginTop: 16 }}>
            <button
              onClick={() => {
                setResult(undefined);
                setPayload('');
                setState('idle');
              }}
            >
              <RotateCcw size={15} /> Verify another product
            </button>
          </div>
        )}
      </div>
    </main>
  );
}

function TraceabilityRecord({ result }: { result: ProductTraceabilityResponse }) {
  const attention = result.product.status !== 'ACTIVE';
  return (
    <div className="product-trace-summary">
      <section className="product-trace-card">
        <span className="product-trace-eyebrow">{result.verificationMessage}</span>
        <h1>{result.product.name}</h1>
        <p className="product-trace-muted">{result.product.reference}</p>
        <span className={`product-trace-status ${attention ? 'attention' : ''}`}>
          {result.product.status}
        </span>
        {attention && (
          <div className="product-trace-warning" style={{ marginTop: 14 }}>
            This product record requires attention: {result.product.status.toLowerCase()}.
          </div>
        )}
        <dl className="product-trace-fields">
          <div>
            <dt>Manufacturer</dt>
            <dd>{result.product.manufacturerName}</dd>
          </div>
          <div>
            <dt>Current custody organisation</dt>
            <dd>{result.currentCustodianName}</dd>
          </div>
          <div>
            <dt>Produced</dt>
            <dd>{formatDate(result.product.producedAt)}</dd>
          </div>
          <div>
            <dt>Expires</dt>
            <dd>{formatDate(result.product.expiresAt)}</dd>
          </div>
        </dl>
        <div className="product-trace-warning">{result.disclaimer}</div>
      </section>

      <div className="product-trace-grid">
        <section className="product-trace-card">
          <h2>Custody history</h2>
          <div className="product-trace-timeline">
            {result.timeline.map((event, index) => (
              <div
                className="product-trace-event"
                key={`${event.type}-${event.timestamp}-${index}`}
              >
                <div className="product-trace-event-marker" />
                <div>
                  <strong>{event.organizationName}</strong>
                  <div className="product-trace-muted">{event.action}</div>
                  <small className="product-trace-muted">
                    {formatDateTime(event.timestamp)} · {event.status}
                  </small>
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="product-trace-card">
          <h2>Ingredient verification</h2>
          <p className="product-trace-muted">
            {result.credentialSummary.active} of {result.credentialSummary.total} linked credentials
            are active.
          </p>
          <div className="product-trace-ingredients">
            {result.ingredients.map((ingredient) => (
              <div className="product-trace-ingredient" key={ingredient.reference}>
                <div>
                  <strong>{ingredient.reference}</strong>
                  <div className="product-trace-muted">{ingredient.supplierName}</div>
                </div>
                <span className={`product-trace-status ${ingredient.verified ? '' : 'attention'}`}>
                  {ingredient.verified ? 'Verified' : ingredient.credentialStatus}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>

      {result.technical && (
        <details className="product-trace-card product-trace-technical">
          <summary>Technical details</summary>
          <dl className="product-trace-fields">
            <Tech label="Product batch ID" value={result.technical.batchId} />
            <Tech label="ProductRegistry" value={result.technical.productRegistryAddress} />
            <Tech label="Manufacturer wallet" value={result.technical.manufacturerWallet} />
            <Tech
              label="Current custodian wallet"
              value={result.technical.currentCustodianWallet}
            />
            {result.technical.transfers.flatMap((transfer, index) => [
              <Tech
                key={`transfer-${index}`}
                label={`Transfer ${index + 1} ID`}
                value={transfer.transferId}
              />,
              <Tech
                key={`dispatch-${index}`}
                label={`Dispatch ${index + 1} transaction`}
                value={transfer.dispatchTransactionHash}
              />,
              <Tech
                key={`receipt-${index}`}
                label={`Receipt ${index + 1} transaction`}
                value={transfer.receiptTransactionHash}
              />,
            ])}
          </dl>
        </details>
      )}
      <div
        className="product-trace-card"
        style={{ display: 'flex', gap: 10, alignItems: 'center' }}
      >
        <ShieldCheck color="#52edbd" />
        <span>Data was resolved read-only from the configured TraceChain contracts.</span>
      </div>
    </div>
  );
}

function Tech({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        <code>{value}</code>
      </dd>
    </div>
  );
}

function traceabilityError(error: unknown) {
  if (!(error instanceof ProductTraceabilityApiError))
    return 'TraceChain could not reach the configured blockchain service. Try again.';
  return (
    {
      INVALID_PRODUCT_QR: 'This is not a valid TraceChain product QR link.',
      PRODUCT_NOT_FOUND: 'No product record was found for this batch.',
      QR_APP_MISMATCH: 'This QR belongs to a different TraceChain application.',
      QR_CHAIN_MISMATCH: 'This QR is for a different blockchain network.',
      QR_REGISTRY_MISMATCH: 'This QR references a different ProductRegistry deployment.',
      TRACEABILITY_UNAVAILABLE: 'The blockchain traceability service is temporarily unavailable.',
    }[error.code] ?? error.message
  );
}

function formatDate(timestamp: number) {
  return new Date(timestamp * 1_000).toLocaleDateString();
}
function formatDateTime(timestamp: number) {
  return new Date(timestamp * 1_000).toLocaleString();
}
