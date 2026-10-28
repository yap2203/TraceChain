import { PackageCheck, QrCode } from 'lucide-react';
import { T, Btn, Card, Badge, Table, TR, TD, SectionTitle, EmptyState } from '../../shared/ui';
import { RETAIL_SHIPMENTS } from '../../shared/custody-fixtures';

export function ReceiveProductList({
  onSelect,
  onAccept,
  onScanReceipt,
}: {
  onSelect: (id: string) => void;
  onAccept: (shipmentId: string, transferRef: string) => void;
  onScanReceipt?: () => void;
}) {
  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 20,
        }}
      >
        <SectionTitle title="Receive Products" sub="Incoming shipments awaiting receipt" />
        <Btn onClick={onScanReceipt} variant="secondary">
          <QrCode size={14} style={{ marginRight: 6 }} />
          Scan Receipt QR
        </Btn>
      </div>
      <div
        style={{
          padding: '10px 14px',
          background: T.tealLight,
          border: `1px solid color-mix(in srgb, ${T.teal} 19%, transparent)`,
          borderRadius: 8,
          fontSize: 12,
          color: T.text2,
          marginBottom: 16,
          lineHeight: 1.6,
        }}
      >
        Scan the sender's Receipt Confirmation QR before confirming receipt. You may view shipment
        details without scanning.
      </div>
      {RETAIL_SHIPMENTS.length === 0 ? (
        <EmptyState
          icon={<PackageCheck size={44} />}
          title="No incoming shipments"
          sub="Transfers from distributors will appear here."
        />
      ) : (
        <Card padding="0">
          <Table
            headers={[
              'Shipment Ref',
              'Product',
              'Batch',
              'Sender',
              'Qty',
              'Dispatch',
              'Status',
              '',
            ]}
          >
            {RETAIL_SHIPMENTS.map((s) => (
              <TR key={s.id}>
                <TD mono muted>
                  {s.id}
                </TD>
                <TD bold>{s.product}</TD>
                <TD mono muted>
                  {s.batch}
                </TD>
                <TD muted>{s.sender.split(' Sdn')[0]}</TD>
                <TD>{s.qty} units</TD>
                <TD muted>{s.dispatch}</TD>
                <TD>
                  <Badge label="Awaiting Acceptance" variant="transfer-pending" />
                </TD>
                <TD>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Btn onClick={() => onSelect(s.id)} size="xs" variant="outline">
                      View
                    </Btn>
                    <Btn onClick={() => onAccept(s.id, s.transferRef)} size="xs">
                      <QrCode size={11} style={{ marginRight: 4 }} />
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
