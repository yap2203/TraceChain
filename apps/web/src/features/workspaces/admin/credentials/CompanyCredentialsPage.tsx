import { useState } from 'react';
import {
  T,
  Btn,
  Card,
  StatCard,
  Badge,
  Table,
  TR,
  TD,
  HashChip,
  SectionTitle,
} from '../../shared/ui';
import { CREDS } from './fixtures';
import { CredDetail } from './CredentialDetail';

export function CompanyCredentials() {
  const [selected, setSelected] = useState<(typeof CREDS)[0] | null>(null);
  if (selected) return <CredDetail cred={selected} onBack={() => setSelected(null)} />;

  return (
    <div>
      <SectionTitle
        title="Company Credentials"
        sub="Issued Company Role Credentials"
        action={
          <div style={{ display: 'flex', gap: 10 }}>
            <StatCard label="Active" value="4" color={T.green} />
            <StatCard label="Suspended" value="1" color={T.amber} />
          </div>
        }
      />
      <Card padding="0">
        <Table
          headers={['Company', 'Role', 'Credential ID', 'DID', 'Issued', 'Expiry', 'Status', '']}
        >
          {CREDS.map((c) => (
            <TR key={c.id} onClick={() => setSelected(c)}>
              <TD bold>{c.company}</TD>
              <TD>{c.role}</TD>
              <TD mono muted>
                {c.id}
              </TD>
              <TD>
                <HashChip value={c.did} />
              </TD>
              <TD muted>{c.issued}</TD>
              <TD muted>{c.expiry}</TD>
              <TD>
                <Badge label={c.status} variant={c.status as any} />
              </TD>
              <TD>
                <Btn variant="outline" size="xs">
                  View →
                </Btn>
              </TD>
            </TR>
          ))}
        </Table>
      </Card>
    </div>
  );
}
