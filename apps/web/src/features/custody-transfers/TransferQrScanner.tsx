import {
  Camera,
  CheckCircle2,
  FileImage,
  Keyboard,
  LoaderCircle,
  RotateCcw,
  ScanLine,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  getCustodyTransfer,
  prepareReceiptConfirmation,
  prepareTransferRejection,
  resolveTransferQr,
  transferResolutionMessage,
} from './custody-transfer.api';
import type {
  PreparedReceiptAction,
  PreparedReceiptConfirmation,
  ResolvedCustodyTransfer,
} from './custody-transfer.types';
import { cameraErrorMessage, type TransferQrReader, ZxingTransferQrReader } from './qr-reader';
import { receiptConfirmationMessage, submitReceiptConfirmation } from './receipt-confirmation';
import { normalizeManualTransferQrPayload } from './transfer-qr';
import {
  ReceiptReconciliationForm,
  type ReceiptReconciliationInput,
} from './ReceiptReconciliationForm';
import { ResolvedTransferCard } from './ResolvedTransferCard';
import './custody-transfer.css';

type ScanMethod = 'camera' | 'upload' | 'manual';

interface TransferQrScannerProps {
  initialPayload?: string;
  onClose?: () => void;
  onResolved?: (transfer: ResolvedCustodyTransfer) => void;
  prepareConfirmation?: (input: ReceiptReconciliationInput) => Promise<PreparedReceiptAction>;
  prepareRejection?: typeof prepareTransferRejection;
  reader?: TransferQrReader;
  refreshTransfer?: (transferId: string) => Promise<ResolvedCustodyTransfer>;
  resolvePayload?: (payload: string) => Promise<ResolvedCustodyTransfer>;
  submitConfirmation?: (
    transaction: PreparedReceiptConfirmation,
    transfer: ResolvedCustodyTransfer,
  ) => Promise<void>;
}

export function TransferQrScanner({
  initialPayload,
  onClose,
  onResolved,
  prepareConfirmation = prepareReceiptConfirmation,
  prepareRejection = prepareTransferRejection,
  reader,
  refreshTransfer = getCustodyTransfer,
  resolvePayload = resolveTransferQr,
  submitConfirmation = submitReceiptConfirmation,
}: TransferQrScannerProps) {
  const [method, setMethod] = useState<ScanMethod>('camera');
  const [cameraState, setCameraState] = useState<'idle' | 'starting' | 'active'>('idle');
  const [manualPayload, setManualPayload] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolved, setResolved] = useState<ResolvedCustodyTransfer | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [receiptMined, setReceiptMined] = useState(false);
  const [confirmationError, setConfirmationError] = useState<string | null>(null);
  const [expectedStatus, setExpectedStatus] = useState(2);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const stopCameraRef = useRef<(() => void) | null>(null);
  const requestActiveRef = useRef(false);
  const resolvedRef = useRef(false);
  const confirmationActiveRef = useRef(false);
  const receiptMinedRef = useRef(false);
  const readerRef = useRef(reader ?? new ZxingTransferQrReader());
  const mountedRef = useRef(true);
  const initialPayloadSubmittedRef = useRef(false);

  const stopCamera = useCallback(() => {
    stopCameraRef.current?.();
    stopCameraRef.current = null;
    const stream = videoRef.current?.srcObject;
    if (typeof MediaStream !== 'undefined' && stream instanceof MediaStream) {
      stream.getTracks().forEach((track) => track.stop());
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    if (mountedRef.current) setCameraState('idle');
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      stopCameraRef.current?.();
      const stream = videoRef.current?.srcObject;
      if (typeof MediaStream !== 'undefined' && stream instanceof MediaStream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  const submitPayload = useCallback(
    async (payload: string) => {
      const normalized = payload.trim();
      if (!normalized) {
        setError('Paste the complete TraceChain QR payload before continuing.');
        return;
      }
      if (requestActiveRef.current || resolvedRef.current) return;

      requestActiveRef.current = true;
      setResolving(true);
      setError(null);
      stopCamera();
      try {
        const transfer = await resolvePayload(normalized);
        if (!mountedRef.current) return;
        resolvedRef.current = true;
        setResolved(transfer);
        onResolved?.(transfer);
      } catch (requestError) {
        if (mountedRef.current) setError(transferResolutionMessage(requestError));
      } finally {
        requestActiveRef.current = false;
        if (mountedRef.current) setResolving(false);
      }
    },
    [onResolved, resolvePayload, stopCamera],
  );

  useEffect(() => {
    if (!initialPayload || initialPayloadSubmittedRef.current) return;
    initialPayloadSubmittedRef.current = true;
    void submitPayload(initialPayload);
  }, [initialPayload, submitPayload]);

  const startCamera = async () => {
    if (cameraState !== 'idle' || requestActiveRef.current || !videoRef.current) return;
    setCameraState('starting');
    setError(null);
    try {
      const cleanup = await readerRef.current.startCamera(
        videoRef.current,
        (payload) => void submitPayload(payload),
        (cameraError) => {
          stopCamera();
          if (mountedRef.current) setError(cameraErrorMessage(cameraError));
        },
      );
      if (!mountedRef.current) {
        cleanup();
        return;
      }
      stopCameraRef.current = cleanup;
      setCameraState('active');
    } catch (cameraError) {
      stopCamera();
      if (mountedRef.current) setError(cameraErrorMessage(cameraError));
    }
  };

  const selectMethod = (nextMethod: ScanMethod) => {
    stopCamera();
    setMethod(nextMethod);
    setError(null);
  };

  const readImage = async (file: File) => {
    if (requestActiveRef.current || resolving) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setError('Choose a PNG, JPG, or WebP image containing the QR code.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('The QR image must be 10 MB or smaller.');
      return;
    }
    setError(null);
    setResolving(true);
    try {
      const payload = await readerRef.current.decodeImage(file);
      setResolving(false);
      await submitPayload(payload);
    } catch {
      setError('No readable QR code was found in that image. Try a clearer PNG or JPG.');
      setResolving(false);
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const close = () => {
    stopCamera();
    onClose?.();
  };

  const submitReceiptAction = async (prepare: () => Promise<PreparedReceiptAction>) => {
    if (
      !resolved ||
      resolved.status !== 1 ||
      confirmationActiveRef.current ||
      receiptMinedRef.current
    )
      return;
    confirmationActiveRef.current = true;
    setConfirming(true);
    setConfirmationError(null);
    try {
      const prepared = await prepare();
      const nextStatus =
        prepared.action === 'CONFIRM_RECEIPT' ? 2 : prepared.action === 'REJECT_TRANSFER' ? 3 : 5;
      setExpectedStatus(nextStatus);
      await submitConfirmation(prepared.transaction, resolved);
      receiptMinedRef.current = true;
      if (mountedRef.current) setReceiptMined(true);
      const refreshed = await refreshTransfer(resolved.transferId);
      if (refreshed.status !== nextStatus) {
        throw new Error(
          'The transaction was mined, but the transfer status could not be confirmed.',
        );
      }
      if (mountedRef.current) {
        setResolved(refreshed);
        onResolved?.(refreshed);
      }
    } catch (confirmationFailure) {
      if (mountedRef.current) {
        setConfirmationError(receiptConfirmationMessage(confirmationFailure));
      }
    } finally {
      confirmationActiveRef.current = false;
      if (mountedRef.current) setConfirming(false);
    }
  };

  const refreshReceiptStatus = async () => {
    if (!resolved || resolved.status !== 1 || confirmationActiveRef.current) return;
    confirmationActiveRef.current = true;
    setConfirming(true);
    setConfirmationError(null);
    try {
      const refreshed = await refreshTransfer(resolved.transferId);
      if (refreshed.status !== expectedStatus) {
        throw new Error('The receipt transaction is mined, but confirmation is not visible yet.');
      }
      if (mountedRef.current) {
        setResolved(refreshed);
        onResolved?.(refreshed);
      }
    } catch (refreshError) {
      if (mountedRef.current) setConfirmationError(receiptConfirmationMessage(refreshError));
    } finally {
      confirmationActiveRef.current = false;
      if (mountedRef.current) setConfirming(false);
    }
  };

  const reset = () => {
    resolvedRef.current = false;
    setResolved(null);
    setManualPayload('');
    setError(null);
    setConfirmationError(null);
    setConfirming(false);
    receiptMinedRef.current = false;
    setReceiptMined(false);
    setExpectedStatus(2);
    setMethod('camera');
  };

  return (
    <section className="transfer-scanner" aria-labelledby="transfer-scanner-title">
      <header className="transfer-scanner-header">
        <div>
          <span>Read-only verification</span>
          <h2 id="transfer-scanner-title">Scan custody-transfer QR</h2>
          <p>The QR is sent to TraceChain before any shipment details are shown.</p>
        </div>
        {onClose && (
          <button
            aria-label="Close scanner"
            className="transfer-scanner-close"
            onClick={close}
            type="button"
          >
            <X aria-hidden="true" size={19} />
          </button>
        )}
      </header>

      {!resolved ? (
        <>
          {!initialPayload && (
            <>
              <div className="transfer-scanner-tabs" role="tablist" aria-label="QR input method">
                {(
                  [
                    ['camera', Camera, 'Camera'],
                    ['upload', FileImage, 'Image upload'],
                    ['manual', Keyboard, 'Manual paste'],
                  ] as const
                ).map(([value, Icon, label]) => (
                  <button
                    aria-selected={method === value}
                    key={value}
                    onClick={() => selectMethod(value)}
                    role="tab"
                    type="button"
                  >
                    <Icon aria-hidden="true" size={16} />
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}

          <div className="transfer-scanner-panel">
            {initialPayload && !error && (
              <div className="transfer-direct-resolution-copy">
                <strong>Checking this shipment</strong>
                <p>TraceChain is validating the link and your recipient access.</p>
              </div>
            )}
            {!initialPayload && (
              <>
                {method === 'camera' && (
                  <div className="transfer-camera-panel" role="tabpanel">
                    <div className="transfer-camera-preview">
                      <video aria-label="Camera preview" muted playsInline ref={videoRef} />
                      {cameraState !== 'active' && (
                        <div className="transfer-camera-placeholder">
                          <ScanLine aria-hidden="true" size={36} />
                          <strong>
                            {cameraState === 'starting' ? 'Starting camera…' : 'Camera is off'}
                          </strong>
                          <span>Permission is requested only after you select Start camera.</span>
                        </div>
                      )}
                    </div>
                    <div className="transfer-scanner-actions">
                      {cameraState === 'active' ? (
                        <button
                          className="transfer-qr-secondary"
                          onClick={stopCamera}
                          type="button"
                        >
                          Stop camera
                        </button>
                      ) : (
                        <button
                          className="transfer-qr-button"
                          disabled={cameraState === 'starting' || resolving}
                          onClick={() => void startCamera()}
                          type="button"
                        >
                          <Camera aria-hidden="true" size={16} />
                          Start camera
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {method === 'upload' && (
                  <div className="transfer-upload-panel" role="tabpanel">
                    <FileImage aria-hidden="true" size={34} />
                    <strong>Choose a QR image</strong>
                    <p>Use a clear PNG, JPG, or WebP image containing one QR code.</p>
                    <button
                      className="transfer-qr-button"
                      disabled={resolving}
                      onClick={() => fileRef.current?.click()}
                      type="button"
                    >
                      Browse image
                    </button>
                    <input
                      accept="image/png,image/jpeg,image/webp"
                      aria-label="Choose QR image"
                      className="transfer-file-input"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void readImage(file);
                      }}
                      ref={fileRef}
                      type="file"
                    />
                  </div>
                )}

                {method === 'manual' && (
                  <div className="transfer-manual-panel" role="tabpanel">
                    <label htmlFor="transfer-qr-payload">Complete TraceChain QR payload</label>
                    <textarea
                      id="transfer-qr-payload"
                      onChange={(event) => setManualPayload(event.target.value)}
                      placeholder="https://tracechain.example/receive/transfer?v=1&chainId=…"
                      rows={5}
                      value={manualPayload}
                    />
                    <button
                      className="transfer-qr-button"
                      disabled={resolving || !manualPayload.trim()}
                      onClick={() => {
                        try {
                          void submitPayload(normalizeManualTransferQrPayload(manualPayload));
                        } catch {
                          setError('This is not a valid TraceChain custody-transfer QR code.');
                        }
                      }}
                      type="button"
                    >
                      Verify transfer
                    </button>
                  </div>
                )}
              </>
            )}

            {resolving && (
              <div aria-live="polite" className="transfer-scanner-progress">
                <LoaderCircle aria-hidden="true" size={18} />
                Verifying with TraceChain…
              </div>
            )}
            {error && (
              <div className="transfer-scanner-error" role="alert">
                {error}
              </div>
            )}
            {initialPayload && error && (
              <button
                className="transfer-qr-secondary"
                onClick={() => {
                  initialPayloadSubmittedRef.current = true;
                  setError(null);
                  void submitPayload(initialPayload);
                }}
                type="button"
              >
                Try again
              </button>
            )}
          </div>
        </>
      ) : (
        <div className="transfer-scanner-result">
          <ResolvedTransferCard transfer={resolved} />
          {resolved.status === 1 ? (
            receiptMined ? (
              <div className="transfer-confirmation-panel">
                <div>
                  <strong>Transaction mined</strong>
                  <p>Refresh the verified contract status to finish this receipt.</p>
                </div>
                <button
                  className="transfer-qr-button"
                  disabled={confirming}
                  onClick={() => void refreshReceiptStatus()}
                  type="button"
                >
                  {confirming ? (
                    <LoaderCircle
                      aria-hidden="true"
                      className="transfer-confirmation-spinner"
                      size={16}
                    />
                  ) : (
                    <RotateCcw aria-hidden="true" size={16} />
                  )}
                  {confirming ? 'Refreshing status…' : 'Refresh status'}
                </button>
              </div>
            ) : (
              <ReceiptReconciliationForm
                busy={confirming}
                onReject={(input) => submitReceiptAction(() => prepareRejection(input))}
                onSubmit={(input) => submitReceiptAction(() => prepareConfirmation(input))}
                transfer={resolved}
              />
            )
          ) : (
            <div className="transfer-confirmation-success" role="status">
              <CheckCircle2 aria-hidden="true" size={18} />
              {resolved.status === 2
                ? 'Receipt confirmed on-chain'
                : resolved.status === 3
                  ? 'Transfer rejected on-chain'
                  : resolved.status === 5
                    ? 'Discrepancy recorded for administrator review'
                    : 'Transfer is no longer awaiting receipt'}
            </div>
          )}
          {confirmationError && (
            <div className="transfer-scanner-error" role="alert">
              {confirmationError}
            </div>
          )}
          <div className="transfer-scanner-actions">
            <button className="transfer-qr-secondary" onClick={reset} type="button">
              <RotateCcw aria-hidden="true" size={15} />
              Scan another
            </button>
            {onClose && (
              <button className="transfer-qr-button" onClick={close} type="button">
                Done
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
