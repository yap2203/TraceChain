import { T, Btn, Card, Badge, Table, TR, TD, SectionTitle } from '../shared/ui';
import { DIST_INVENTORY } from '../shared/custody-fixtures';

export function CustodyInventory({ onTransfer }: { onTransfer: () => void }) {
  return (
    <div>
      <SectionTitle
        title="Custody Inventory"
        sub="Products in your possession"
        action={<Btn onClick={onTransfer}>Transfer to Retailer</Btn>}
      />
      <Card padding="0">
        <Table
          headers={[
            'Batch ID',
            'Product',
            'Manufacturer',
            'Received',
            'Available',
            'Reserved',
            'Damaged',
            'Date',
            'Status',
            '',
          ]}
        >
          {DIST_INVENTORY.map((item) => (
            <TR key={item.batch}>
              <TD mono muted>
                {item.batch}
              </TD>
              <TD bold>{item.name}</TD>
              <TD muted>{item.manufacturer}</TD>
              <TD>{item.received}</TD>
              <TD bold>{item.available}</TD>
              <TD>
                {item.reserved > 0 ? (
                  <span style={{ color: T.amber, fontWeight: 600 }}>{item.reserved}</span>
                ) : (
                  '0'
                )}
              </TD>
              <TD>
                {item.damaged > 0 ? (
                  <span style={{ color: T.red, fontWeight: 600 }}>{item.damaged}</span>
                ) : (
                  '0'
                )}
              </TD>
              <TD muted>{item.date}</TD>
              <TD>
                <Badge label={item.status} variant={item.status} />
              </TD>
              <TD>
                <Btn onClick={onTransfer} variant="outline" size="xs">
                  Transfer
                </Btn>
              </TD>
            </TR>
          ))}
        </Table>
      </Card>
    </div>
  );
}
