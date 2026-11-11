import { LoaderCircle, PackageCheck } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { ReceiptEvidenceUpload, ResolvedCustodyTransfer } from './custody-transfer.types';

export interface ReceiptReconciliationInput {
  actualArrivalAt?: string;
  actualQuantity: string;
  damagedQuantity: string;
  evidence: ReceiptEvidenceUpload[];
  notes: string;
  rejectedQuantity: string;
  transferId: string;
}

export function ReceiptReconciliationForm({
  busy,
  onReject,
  onSubmit,
  transfer,
}: {
  busy: boolean;
  onReject: (input: {
    evidence: ReceiptEvidenceUpload[];
    reason: string;
    reasonType: 'COMPLETE_REJECTION' | 'SHIPMENT_REFUSED' | 'WRONG_PRODUCT';
    transferId: string;
  }) => Promise<void>;
  onSubmit: (input: ReceiptReconciliationInput) => Promise<void>;
  transfer: ResolvedCustodyTransfer;
}) {
  const [actual, setActual] = useState(transfer.quantity);
  const [damaged, setDamaged] = useState('0');
  const [rejected, setRejected] = useState('0');
  const [notes, setNotes] = useState('');
  const [arrival, setArrival] = useState('');
  const [evidence, setEvidence] = useState<ReceiptEvidenceUpload[]>([]);
  const [fileError, setFileError] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectType, setRejectType] = useState<
    'COMPLETE_REJECTION' | 'SHIPMENT_REFUSED' | 'WRONG_PRODUCT'
  >('COMPLETE_REJECTION');
  const values = useMemo(() => {
    const valid = [actual, damaged, rejected].every((value) => /^(0|[1-9]\d*)$/.test(value));
    if (!valid) return { error: 'Quantities must be non-negative whole numbers.', usable: 0n };
    const actualValue = BigInt(actual);
    const damagedValue = BigInt(damaged);
    const rejectedValue = BigInt(rejected);
    if ([actualValue, damagedValue, rejectedValue].some((value) => value > MAX_SAFE_QUANTITY))
      return { error: 'Quantities must be safe whole numbers.', usable: 0n };
    if (damagedValue + rejectedValue > actualValue)
      return { error: 'Damaged plus rejected cannot exceed actual received.', usable: 0n };
    return { error: '', usable: actualValue - damagedValue - rejectedValue };
  }, [actual, damaged, rejected]);
  const mismatch = /^(0|[1-9]\d*)$/.test(actual) && BigInt(actual) !== BigInt(transfer.quantity);
  const arrivalError =
    arrival && (!Number.isFinite(Date.parse(arrival)) || Date.parse(arrival) > Date.now() + 60_000)
      ? 'Actual arrival must be a valid time that is not in the future.'
      : '';

  const readFiles = async (files: FileList | null) => {
    setFileError('');
    if (!files) return;
    const selected = [...files];
    if (selected.length > 3) {
      setFileError('Attach no more than three evidence files.');
      return;
    }
    const allowed = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];
    if (
      selected.some(
        (file) => !allowed.includes(file.type) || !file.size || file.size > 5 * 1024 * 1024,
      )
    ) {
      setFileError('Evidence must be PNG, JPG, WebP, or PDF and no larger than 5 MB each.');
      return;
    }
    setEvidence(
      await Promise.all(
        selected.map(async (file) => ({
          dataBase64: await fileBase64(file),
          mediaType: file.type as ReceiptEvidenceUpload['mediaType'],
        })),
      ),
    );
  };

  return (
    <section className="receipt-reconciliation" aria-labelledby="receipt-reconciliation-title">
      <div>
        <span>Recipient reconciliation</span>
        <h3 id="receipt-reconciliation-title">Record received quantities</h3>
        <p>
          Usable quantity is calculated automatically. MetaMask signs the final blockchain write.
        </p>
      </div>
      <div className="receipt-quantity-grid">
        <label>
          Expected quantity
          <input readOnly value={transfer.quantity} />
        </label>
        <label>
          Actual quantity received
          <input
            inputMode="numeric"
            maxLength={16}
            value={actual}
            onChange={(event) => setActual(event.target.value)}
          />
        </label>
        <label>
          Damaged quantity
          <input
            inputMode="numeric"
            maxLength={16}
            value={damaged}
            onChange={(event) => setDamaged(event.target.value)}
          />
        </label>
        <label>
          Rejected quantity
          <input
            inputMode="numeric"
            maxLength={16}
            value={rejected}
            onChange={(event) => setRejected(event.target.value)}
          />
        </label>
      </div>
      <div className="receipt-usable">
        <PackageCheck size={17} /> Usable quantity: <strong>{values.usable.toString()}</strong>
      </div>
      {mismatch && (
        <div className="transfer-scanner-warning">
          {BigInt(actual) < BigInt(transfer.quantity) ? 'Shortage' : 'Excess'} detected. Submitting
          will report a discrepancy for administrator review.
        </div>
      )}
      {values.error && (
        <div className="transfer-scanner-error" role="alert">
          {values.error}
        </div>
      )}
      <label>
        Actual arrival time
        <input
          type="datetime-local"
          value={arrival}
          onChange={(event) => setArrival(event.target.value)}
        />
      </label>
      <label>
        Receipt notes {mismatch && '(required)'}
        <textarea
          rows={3}
          maxLength={4000}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </label>
      <label>
        Supporting evidence (optional)
        <input
          accept="image/png,image/jpeg,image/webp,application/pdf"
          multiple
          type="file"
          onChange={(event) => void readFiles(event.target.files)}
        />
      </label>
      {evidence.length > 0 && <small>{evidence.length} encrypted evidence file(s) ready.</small>}
      {fileError && (
        <div className="transfer-scanner-error" role="alert">
          {fileError}
        </div>
      )}
      {arrivalError && (
        <div role="alert" className="transfer-scanner-error">
          {arrivalError}
        </div>
      )}
      <button
        className="transfer-qr-button"
        disabled={
          busy ||
          !!values.error ||
          !!fileError ||
          !!arrivalError ||
          notes.length > 4000 ||
          (mismatch && !notes.trim())
        }
        onClick={() =>
          void onSubmit({
            actualArrivalAt: arrival ? new Date(arrival).toISOString() : undefined,
            actualQuantity: actual,
            damagedQuantity: damaged,
            evidence,
            notes,
            rejectedQuantity: rejected,
            transferId: transfer.transferId,
          })
        }
        type="button"
      >
        {busy ? (
          <LoaderCircle className="transfer-confirmation-spinner" size={16} />
        ) : (
          <PackageCheck size={16} />
        )}
        {busy
          ? 'MetaMask confirmation required…'
          : mismatch
            ? 'Report quantity discrepancy'
            : 'Confirm reconciled receipt'}
      </button>
      <button
        className="transfer-qr-secondary"
        disabled={busy}
        onClick={() => setRejecting((value) => !value)}
        type="button"
      >
        Reject or wrong product
      </button>
      {rejecting && (
        <div className="receipt-rejection-panel">
          <label>
            Rejection type
            <select
              value={rejectType}
              onChange={(event) => setRejectType(event.target.value as typeof rejectType)}
            >
              <option value="COMPLETE_REJECTION">Complete rejection</option>
              <option value="WRONG_PRODUCT">Wrong product</option>
              <option value="SHIPMENT_REFUSED">Shipment refused</option>
            </select>
          </label>
          <label>
            Reason
            <textarea
              rows={3}
              value={rejectReason}
              maxLength={4000}
              onChange={(event) => setRejectReason(event.target.value)}
            />
          </label>
          <button
            className="transfer-qr-danger"
            disabled={busy || !rejectReason.trim() || rejectReason.length > 4000 || !!fileError}
            onClick={() =>
              void onReject({
                evidence,
                reason: rejectReason,
                reasonType: rejectType,
                transferId: transfer.transferId,
              })
            }
            type="button"
          >
            Submit rejection through MetaMask
          </button>
        </div>
      )}
    </section>
  );
}

async function fileBase64(file: File) {
  const buffer = await file.arrayBuffer();
  let binary = '';
  new Uint8Array(buffer).forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

const MAX_SAFE_QUANTITY = BigInt(Number.MAX_SAFE_INTEGER);
