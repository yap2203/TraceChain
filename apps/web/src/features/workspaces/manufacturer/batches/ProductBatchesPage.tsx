import { Btn, Card, Badge, Table, TR, TD, SectionTitle } from '../../shared/ui';
import { PRODUCT_BATCHES } from '../fixtures';

export function ProductBatches({
  onNew,
  onTransfer,
  onDetail,
}: {
  onNew: () => void;
  onTransfer: () => void;
  onDetail: (id: string) => void;
}) {
  return (
    <div>
      <SectionTitle
        title="Product Batches"
        action={<Btn onClick={onNew}>+ Create Product Batch</Btn>}
      />
      <Card padding="0">
        <Table
          headers={[
            'Batch ID',
            'Product',
            'Produced',
            'Qty',
            'Ingredients',
            'Custodian',
            'Status',
            'QR',
            '',
          ]}
        >
          {PRODUCT_BATCHES.map((p) => (
            <TR key={p.id} onClick={() => onDetail(p.id)}>
              <TD mono muted>
                {p.id}
              </TD>
              <TD bold>{p.name}</TD>
              <TD muted>{p.produced}</TD>
              <TD>{p.qty} units</TD>
              <TD>{p.ingredients} linked</TD>
              <TD muted>{p.custodian}</TD>
              <TD>
                <Badge label={p.status} variant={p.status} />
              </TD>
              <TD>
                <Btn
                  onClick={(e) => {
                    e.stopPropagation();
                    onDetail(p.id);
                  }}
                  variant="outline"
                  size="xs"
                >
                  QR
                </Btn>
              </TD>
              <TD>
                <Btn
                  onClick={(e) => {
                    e.stopPropagation();
                    onTransfer();
                  }}
                  variant="outline"
                  size="xs"
                >
                  Transfer →
                </Btn>
              </TD>
            </TR>
          ))}
        </Table>
      </Card>
    </div>
  );
}
