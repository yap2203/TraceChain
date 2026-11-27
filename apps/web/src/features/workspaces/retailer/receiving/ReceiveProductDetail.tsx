import { shipmentStatusVariant } from '../../shared/shipment-status';
import { BackNavigation } from '../../../../components/ui/BackNavigation';
import { Box, MapPin, PackageCheck, Truck, Warehouse } from 'lucide-react';
import { LoadingIndicator } from '../../../../components/ui/LoadingIndicator';
import { useOperationalData } from '../../../blockchain/useOperationalData';
import {
  Alert,
  Badge,
  Btn,
  Card,
  EmptyState,
  StatusTimeline,
  TechnicalDetails,
} from '../../shared/ui';
import { chainDate, shortChainId, transferStatuses } from '../../shared/operational-format';

export function ReceiveProduct({
  shipmentId,
  onBack,
  onViewHistory,
}: {
  shipmentId?: string;
  onBack: () => void;
  onViewHistory: (batch: string) => void;
}) {
  const { data, error, loading } = useOperationalData();
  const transfer = data.transfers.find((entry) => entry.transferId === shipmentId);
  if (error) return <Alert type="error" message={error} />;
  if (loading) return <LoadingIndicator page label="Reading CustodyTransfer…" />;
  if (!transfer)
    return (
      <EmptyState
        icon={<span />}
        title="Transfer not found on chain"
        sub="This transfer is not addressed to the authenticated wallet."
      />
    );

  const received = transfer.status === 2;
  return (
    <section className="workspace-arrival-detail" aria-label="Retailer product receipt detail">
      <BackNavigation onClick={onBack}>Back to receipts</BackNavigation>
      <header className="workspace-arrival-detail__header">
        <span className="workspace-arrival-detail__header-icon" aria-hidden="true">
          <Box size={31} />
        </span>
        <div>
          <h2>Product Receipt</h2>
          <p>Review the transfer and continue to verified receipt confirmation.</p>
        </div>
        <Btn variant="outline" onClick={() => onViewHistory(transfer.productBatchId)}>
          Product history
        </Btn>
      </header>

      <StatusTimeline
        label="Retailer receipt progress"
        variant="arrival"
        steps={[
          {
            actor: chainDate(transfer.dispatchedAt),
            icon: <PackageCheck size={24} />,
            label: 'Dispatched',
            state: 'complete',
          },
          {
            actor: received ? 'Transit completed' : 'Shipment is on the way',
            icon: <Truck size={24} />,
            label: 'In Transit',
            state: received ? 'complete' : 'current',
          },
          {
            actor: received ? 'Receipt recorded' : 'Awaiting arrival verification',
            icon: <MapPin size={24} />,
            label: 'Arrived',
            state: received ? 'complete' : 'pending',
          },
          {
            actor: received ? 'Confirmed on chain' : 'Pending confirmation',
            icon: <Warehouse size={24} />,
            label: 'Received',
            state: received ? 'complete' : 'pending',
          },
        ]}
      />

      <Card>
        <div className="workspace-arrival-summary__heading">
          <h3>Transfer Summary</h3>
          <Badge
            label={transferStatuses[transfer.status] ?? 'Unknown'}
            variant={shipmentStatusVariant(transferStatuses[transfer.status] ?? 'Unknown')}
          />
        </div>
        <dl className="workspace-arrival-summary__facts workspace-process-summary-facts">
          {[
            ['Transfer reference', shortChainId(transfer.transferId)],
            ['Quantity', transfer.quantity],
            ['Dispatched', chainDate(transfer.dispatchedAt)],
            ['Expected arrival', chainDate(transfer.expectedAt)],
          ].map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <div className="workspace-arrival-detail__columns">
        <section className="workspace-arrival-panel">
          <h3>Delivery Information</h3>
          <dl className="workspace-arrival-delivery-list">
            {[
              ['Sender', transfer.senderName ?? 'Verified Distributor'],
              ['Recipient', transfer.recipientName ?? 'Receiving company'],
              ['Usable received', transfer.usable],
              ['Damaged', transfer.damaged],
              ['Rejected', transfer.rejected],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section className="workspace-arrival-panel">
          <h3>Next Action</h3>
          <Alert
            type="info"
            message="Use the receipt QR flow to prepare and sign custody confirmation. This screen does not simulate a blockchain write."
          />
        </section>
      </div>

      <div className="workspace-arrival-detail__technical">
        <TechnicalDetails
          fields={[
            { label: 'Transfer ID', value: transfer.transferId },
            { label: 'Product batch ID', value: transfer.productBatchId },
            { label: 'Sender wallet', value: transfer.sender },
            { label: 'Recipient wallet', value: transfer.recipient },
          ]}
        />
      </div>
    </section>
  );
}
