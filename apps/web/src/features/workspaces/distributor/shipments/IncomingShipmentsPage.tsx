import { PackageCheck, QrCode } from 'lucide-react';
import { useOperationalData } from '../../../blockchain/useOperationalData';
import { Alert, Badge, Btn, Card, EmptyState, SectionTitle, Table, TD, TR } from '../../shared/ui';
import { chainDate, shortChainId, transferStatuses } from '../../shared/operational-format';
export function IncomingShipmentsList({
  onSelect,
  onAccept,
  onScanReceipt,
}: {
  onSelect: (id: string) => void;
  onAccept: (id: string, ref: string) => void;
  onScanReceipt?: () => void;
}) {
  const { data, error, loading } = useOperationalData();
  const rows = data.transfers.filter((t) => t.direction === 'incoming' && t.status === 1);
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <SectionTitle
          title="Incoming Shipments"
          sub="Awaiting-receipt transfers addressed to this wallet"
        />
        <Btn onClick={onScanReceipt} variant="secondary">
          <QrCode size={14} /> Scan Receipt QR
        </Btn>
      </div>
      {error && <Alert type="error" message={error} />}{' '}
      {!loading && rows.length === 0 ? (
        <EmptyState
          icon={<PackageCheck size={44} />}
          title="No incoming shipments"
          sub="Transfers from manufacturers will appear here."
        />
      ) : (
        <Card padding="0">
          <Table
            headers={[
              'Transfer',
              'Product Batch',
              'Sender',
              'Quantity',
              'Dispatched',
              'Status',
              '',
            ]}
          >
            {rows.map((t) => (
              <TR key={t.transferId}>
                <TD mono muted>
                  {shortChainId(t.transferId)}
                </TD>
                <TD mono>{shortChainId(t.productBatchId)}</TD>
                <TD mono muted>
                  {shortChainId(t.sender)}
                </TD>
                <TD>{t.quantity}</TD>
                <TD muted>{chainDate(t.dispatchedAt)}</TD>
                <TD>
                  <Badge label={transferStatuses[t.status]} variant="transfer-pending" />
                </TD>
                <TD>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Btn size="xs" variant="outline" onClick={() => onSelect(t.transferId)}>
                      View
                    </Btn>
                    <Btn size="xs" onClick={() => onAccept(t.transferId, t.transferId)}>
                      Receive
                    </Btn>
                  </div>
                </TD>
              </TR>
            ))}
          </Table>
        </Card>
      )}
    </div>
  );
}
