import { T, Card, Badge, Table, TR, TD } from '../../shared/ui';

export function CredentialStatusHistory() {
  return (
    <>
      {/* 7. Credential Status History */}
      <Card>
        <div style={{ fontWeight: 700, fontSize: 15, color: T.navy, marginBottom: 14 }}>
          7. Credential Status History
        </div>
        <Table
          headers={[
            'Credential ID',
            'Company',
            'Role',
            'Issued',
            'Status at Transfer',
            'Current Status',
          ]}
        >
          {[
            {
              id: 'CRED-SUP-2026-001',
              co: 'ABC Ingredients',
              role: 'Supplier',
              issued: '2026-05-01',
              atTx: 'Active',
              now: 'active',
            },
            {
              id: 'CRED-MAN-2026-001',
              co: 'CocoaCraft Mfg.',
              role: 'Manufacturer',
              issued: '2026-05-15',
              atTx: 'Active',
              now: 'active',
            },
            {
              id: 'CRED-DIS-2026-001',
              co: 'Swift Dist.',
              role: 'Distributor',
              issued: '2026-06-01',
              atTx: 'Active',
              now: 'active',
            },
            {
              id: 'CRED-RET-2026-001',
              co: 'FreshMart Retail',
              role: 'Retailer',
              issued: '2026-06-15',
              atTx: 'Active',
              now: 'active',
            },
          ].map((row) => (
            <TR key={row.id}>
              <TD mono muted>
                {row.id}
              </TD>
              <TD bold>{row.co}</TD>
              <TD muted>{row.role}</TD>
              <TD muted>{row.issued}</TD>
              <TD>
                <Badge label={row.atTx.toLowerCase() as any} variant="active" />
              </TD>
              <TD>
                <Badge label={row.now} variant={row.now as any} />
              </TD>
            </TR>
          ))}
        </Table>
      </Card>
    </>
  );
}
