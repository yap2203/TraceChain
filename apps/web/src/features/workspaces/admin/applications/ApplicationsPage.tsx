import { useState } from 'react';
import { ClipboardList } from 'lucide-react';
import { T, UI, Btn, Card, Badge, Table, TR, TD, SectionTitle, EmptyState } from '../../shared/ui';
import { APPS } from './fixtures';
import { AppDetail } from './ApplicationDetail';

export function Applications() {
  const [selected, setSelected] = useState<(typeof APPS)[0] | null>(null);
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');

  if (selected) return <AppDetail app={selected} onBack={() => setSelected(null)} />;

  const filtered = filter === 'all' ? APPS : APPS.filter((a) => a.status === filter);

  return (
    <div>
      <SectionTitle
        title="Company Applications"
        sub={`${APPS.length} total applications`}
        action={
          <div
            style={{
              display: 'flex',
              background: T.surface,
              border: `1px solid ${T.border}`,
              borderRadius: 8,
              overflow: 'hidden',
            }}
          >
            {(['all', 'pending', 'approved', 'rejected'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{
                  padding: '7px 14px',
                  fontSize: 11,
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: UI,
                  textTransform: 'capitalize',
                  background: filter === f ? T.teal : 'transparent',
                  color: filter === f ? T.navyDark : T.text2,
                  fontWeight: filter === f ? 600 : 400,
                }}
              >
                {f} ({f === 'all' ? APPS.length : APPS.filter((a) => a.status === f).length})
              </button>
            ))}
          </div>
        }
      />
      <Card padding="0">
        {filtered.length === 0 ? (
          <EmptyState
            icon={<ClipboardList size={44} />}
            title="No applications"
            sub="No applications match the current filter."
          />
        ) : (
          <Table
            headers={[
              'Application ID',
              'Company',
              'Reg. Number',
              'Role',
              'Submitted',
              'Documents',
              'Status',
              '',
            ]}
          >
            {filtered.map((app) => (
              <TR key={app.id} onClick={() => setSelected(app)}>
                <TD mono muted>
                  {app.id}
                </TD>
                <TD bold>{app.company}</TD>
                <TD mono muted>
                  {app.reg}
                </TD>
                <TD>{app.role}</TD>
                <TD muted>{app.submitted}</TD>
                <TD>
                  {app.docs} file{app.docs > 1 ? 's' : ''}
                </TD>
                <TD>
                  <Badge
                    label={app.status}
                    variant={
                      app.status === 'approved'
                        ? 'verified'
                        : app.status === 'rejected'
                          ? 'rejected'
                          : 'pending'
                    }
                  />
                </TD>
                <TD>
                  <Btn variant="outline" size="xs">
                    Review →
                  </Btn>
                </TD>
              </TR>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
