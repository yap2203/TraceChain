import { T, Card, Table, TR, TD } from '../../shared/ui';

export function QuantityReconciliation() {
  return (
    <>
      {/* 6. Quantity Reconciliation */}
      <Card>
        <div style={{ fontWeight: 700, fontSize: 15, color: T.navy, marginBottom: 14 }}>
          6. Quantity Reconciliation
        </div>
        <Table
          headers={['Stage', 'Organisation', 'Received', 'Damaged', 'Transferred', 'Available']}
        >
          {[
            {
              stage: 'Manufacturer',
              org: 'CocoaCraft Mfg.',
              recv: '—',
              dmg: '—',
              trans: '500',
              avail: '0',
            },
            {
              stage: 'Distributor',
              org: 'Swift Distribution',
              recv: '500',
              dmg: '10',
              trans: '490',
              avail: '0',
            },
            {
              stage: 'Retailer',
              org: 'FreshMart Retail',
              recv: '490',
              dmg: '0',
              trans: '—',
              avail: '490',
            },
          ].map((row) => (
            <TR key={row.stage}>
              <TD bold>{row.stage}</TD>
              <TD muted>{row.org}</TD>
              <TD>{row.recv}</TD>
              <TD>
                {row.dmg !== '0' && row.dmg !== '—' ? (
                  <span style={{ color: T.amber, fontWeight: 600 }}>{row.dmg}</span>
                ) : (
                  row.dmg
                )}
              </TD>
              <TD>{row.trans}</TD>
              <TD bold>{row.avail}</TD>
            </TR>
          ))}
        </Table>
      </Card>
    </>
  );
}
