import { Layers } from 'lucide-react';
import { useOperationalData } from '../../blockchain/useOperationalData';
import { Alert, Btn, Card, EmptyState, SectionTitle, Table, TD, TR } from '../shared/ui';
import { shortChainId } from '../shared/operational-format';
export function CustodyInventory({ onTransfer }: { onTransfer: () => void }) {
  const { data, error, loading } = useOperationalData();
  const rows = data.transfers.filter(
    (transfer, index, all) =>
      all.findIndex((candidate) => candidate.productBatchId === transfer.productBatchId) === index &&
      (BigInt(transfer.inventory.available) > 0n ||
        BigInt(transfer.inventory.reserved) > 0n ||
        BigInt(transfer.inventory.damaged) > 0n),
  );
  return (
    <div>
      <SectionTitle
        title="Custody Inventory"
        sub="Current inventory read from CustodyTransfer"
        action={<Btn onClick={onTransfer}>Transfer to Retailer</Btn>}
      />
      {error && <Alert type="error" message={error} />}{' '}
      {!loading && rows.length === 0 ? (
        <EmptyState
          icon={<Layers size={44} />}
          title="No on-chain custody inventory"
          sub="Confirmed receipts will appear here."
        />
      ) : (
        <Card padding="0">
          <Table headers={['Product Batch', 'Available', 'Reserved', 'Damaged', 'Rejected', '']}>
            {rows.map((t) => (
              <TR key={t.productBatchId}>
                <TD mono muted>
                  {shortChainId(t.productBatchId)}
                </TD>
                <TD bold>{t.inventory.available}</TD>
                <TD>{t.inventory.reserved}</TD>
                <TD>{t.inventory.damaged}</TD>
                <TD>{t.inventory.rejected}</TD>
                <TD>
                  <Btn size="xs" variant="outline" onClick={onTransfer}>
                    Transfer
                  </Btn>
                </TD>
              </TR>
            ))}
          </Table>
        </Card>
      )}
    </div>
  );
}
