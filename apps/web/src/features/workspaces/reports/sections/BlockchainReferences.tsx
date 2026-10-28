import { T, Card, Badge, Table, TR, TD, HashChip } from '../../shared/ui';

export function BlockchainReferences() {
  return (
    <>
      {/* 8. Blockchain Transaction References */}
      <Card>
        <div style={{ fontWeight: 700, fontSize: 15, color: T.navy, marginBottom: 14 }}>
          8. Blockchain Transaction References
        </div>
        <Table headers={['Event', 'Transaction Hash', 'Block', 'Timestamp', 'Status']}>
          {[
            {
              event: 'Product Batch Registered',
              hash: '0x8f3a2b41c7e9d05f',
              block: '7,482,901',
              time: '2026-08-01 09:14 UTC',
            },
            {
              event: 'Transfer to Distributor',
              hash: '0x1d9c4e87b2f06a1d',
              block: '7,482,887',
              time: '2026-08-05 14:22 UTC',
            },
            {
              event: 'Distributor Accepted Custody',
              hash: '0x4c7d1e2f9a3b0c4c',
              block: '7,482,203',
              time: '2026-08-09 11:30 UTC',
            },
            {
              event: 'Transfer to Retailer',
              hash: '0x2a5f8c31b6e04a2a',
              block: '7,483,110',
              time: '2026-08-09 14:15 UTC',
            },
            {
              event: 'Retailer Accepted Custody',
              hash: '0x9e3b7c14d2a08f9e',
              block: '7,483,291',
              time: '2026-08-09 16:00 UTC',
            },
          ].map((row) => (
            <TR key={row.hash}>
              <TD>{row.event}</TD>
              <TD>
                <HashChip value={row.hash} />
              </TD>
              <TD mono muted>
                {row.block}
              </TD>
              <TD muted>{row.time}</TD>
              <TD>
                <Badge label="confirmed" variant="accepted" />
              </TD>
            </TR>
          ))}
        </Table>
      </Card>
    </>
  );
}
