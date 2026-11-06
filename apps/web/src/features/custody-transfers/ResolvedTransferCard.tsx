import { Clock3, PackageCheck, Route, WalletCards } from 'lucide-react';

import type { ResolvedCustodyTransfer } from './custody-transfer.types';
import './custody-transfer.css';

function formatTimestamp(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp * 1_000));
}

export function ResolvedTransferCard({ transfer }: { transfer: ResolvedCustodyTransfer }) {
  const fields = [
    { icon: PackageCheck, label: 'Product batch ID', value: transfer.productBatchId },
    { icon: WalletCards, label: 'Sender', value: transfer.sender },
    { icon: WalletCards, label: 'Recipient', value: transfer.recipient },
    { icon: Route, label: 'Quantity', value: transfer.quantity },
    { icon: Clock3, label: 'Dispatch time', value: formatTimestamp(transfer.dispatchedAt) },
    { icon: Clock3, label: 'Expected arrival', value: formatTimestamp(transfer.expectedAt) },
  ];

  return (
    <section className="resolved-transfer-card" aria-labelledby="resolved-transfer-title">
      <div className="resolved-transfer-heading">
        <div>
          <span>API verified</span>
          <h3 id="resolved-transfer-title">Custody transfer found</h3>
        </div>
        <strong>Awaiting Receipt</strong>
      </div>
      <div className="resolved-transfer-grid">
        {fields.map(({ icon: Icon, label, value }) => (
          <div key={label} className="resolved-transfer-field">
            <Icon aria-hidden="true" size={17} />
            <div>
              <span>{label}</span>
              <code>{value}</code>
            </div>
          </div>
        ))}
      </div>
      <p className="resolved-transfer-reference">Transfer ID: {transfer.transferId}</p>
      <p className="resolved-transfer-readonly">
        This verification is read-only. No receipt transaction has been prepared or sent.
      </p>
    </section>
  );
}
