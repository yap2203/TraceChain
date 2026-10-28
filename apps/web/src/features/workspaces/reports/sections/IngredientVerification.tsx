import { T, Card, Badge, Table, TR, TD } from '../../shared/ui';

export function IngredientVerification() {
  return (
    <>
      {/* 3 & 4. Ingredient Batches & Credential Verification */}
      <Card>
        <div style={{ fontWeight: 700, fontSize: 15, color: T.navy, marginBottom: 14 }}>
          3–4. Ingredient Batches & Credential Verification
        </div>
        <Table
          headers={[
            'Ingredient',
            'Batch ID',
            'Supplier',
            'Credential ID',
            'Status',
            'Hash Match',
            'Digital Signature',
          ]}
        >
          {[
            {
              name: 'Cocoa Powder',
              batch: 'COCOA-2026-001',
              supplier: 'ABC Ingredients',
              cred: 'IC-COCOA-2026-001',
            },
            {
              name: 'Milk Powder',
              batch: 'MILK-2026-010',
              supplier: 'ABC Ingredients',
              cred: 'IC-MILK-2026-010',
            },
            {
              name: 'Cane Sugar',
              batch: 'SUGAR-2026-090',
              supplier: 'ABC Ingredients',
              cred: 'IC-SUGAR-2026-090',
            },
          ].map((i) => (
            <TR key={i.batch}>
              <TD bold>{i.name}</TD>
              <TD mono muted>
                {i.batch}
              </TD>
              <TD muted>{i.supplier}</TD>
              <TD mono muted>
                {i.cred}
              </TD>
              <TD>
                <Badge label="active" variant="active" />
              </TD>
              <TD>
                <Badge label="matched" variant="matched" />
              </TD>
              <TD>
                <Badge label="valid" variant="valid" />
              </TD>
            </TR>
          ))}
        </Table>
      </Card>
    </>
  );
}
