import { Clock3, PackageCheck, Route, WalletCards } from 'lucide-react';

import { TechnicalDetails } from '../workspaces/shared/ui';
import type { ResolvedCustodyTransfer } from './custody-transfer.types';
import './custody-transfer.css';

function formatTimestamp(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp * 1_000));
}

export function ResolvedTransferCard({ transfer }: { transfer: ResolvedCustodyTransfer }) {
  const received = transfer.status === 2;
  const fields = [
    { icon: PackageCheck, label: 'Product', value: transfer.productName },
    { icon: PackageCheck, label: 'Batch reference', value: transfer.productReference },
    { icon: WalletCards, label: 'Sender', value: transfer.senderName ?? 'Verified sender' },
    {
      icon: WalletCards,
      label: 'Recipient',
      value: transfer.recipientName ?? 'Verified recipient',
    },
    { icon: Route, label: 'Expected quantity', value: transfer.quantity },
    { icon: Clock3, label: 'Dispatch time', value: formatTimestamp(transfer.dispatchedAt) },
    { icon: Clock3, label: 'Expected arrival', value: formatTimestamp(transfer.expectedAt) },
  ];

  return (
    <section className="resolved-transfer-card" aria-labelledby="resolved-transfer-title">
      <div className="resolved-transfer-heading">
        <div>
          <span>API verified</span>
          <h3 id="resolved-transfer-title">{heading(transfer.status)}</h3>
        </div>
        <strong className={received ? 'resolved-transfer-status-received' : undefined}>
          {statusLabel(transfer.status)}
        </strong>
      </div>
      {received && (
        <div className="resolved-transfer-totals">
          <span>Usable: {transfer.usable}</span>
          <span>Damaged: {transfer.damaged}</span>
          <span>Rejected: {transfer.rejected}</span>
        </div>
      )}
      <div className="resolved-transfer-grid">
        {fields.map(({ icon: Icon, label, value }) => (
          <div key={label} className="resolved-transfer-field">
            <Icon aria-hidden="true" size={17} />
            <div>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          </div>
        ))}
      </div>
      <TechnicalDetails
        fields={[
          { label: 'Transfer ID', value: transfer.transferId },
          { label: 'Product batch ID', value: transfer.productBatchId },
          { label: 'Sender wallet', value: transfer.sender },
          { label: 'Recipient wallet', value: transfer.recipient },
        ]}
      />
      <p className="resolved-transfer-readonly">{statusDescription(transfer.status)}</p>
    </section>
  );
}

function statusLabel(status: number) {
  return (
    ['Unknown', 'Awaiting Receipt', 'Received', 'Rejected', 'Cancelled', 'Discrepancy Reported'][
      status
    ] ?? 'Unknown'
  );
}

function heading(status: number) {
  if (status === 2) return 'Custody transfer received';
  if (status === 3) return 'Custody transfer rejected';
  if (status === 4) return 'Custody transfer cancelled';
  if (status === 5) return 'Receipt discrepancy reported';
  return 'Custody transfer found';
}

function statusDescription(status: number) {
  if (status === 2) return 'The recipient confirmed this custody transfer on-chain.';
  if (status === 3) return 'The intended recipient rejected this shipment on-chain.';
  if (status === 4) return 'This transfer was cancelled and is no longer open for receipt.';
  if (status === 5)
    return 'Administrator review is required before the recipient can complete confirmation.';
  return 'QR verification was read-only. Confirmation requires a separate MetaMask transaction.';
}
