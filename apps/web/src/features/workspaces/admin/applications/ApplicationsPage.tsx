import { ClipboardList } from 'lucide-react';
import { useState } from 'react';

import { Badge, Btn, Card, EmptyState, SectionTitle, T, Table, TD, TR, UI } from '../../shared/ui';
import { AppDetail } from './ApplicationDetail';
import type { ChainApplication } from './types';
import { useChainApplications } from './useChainApplications';

export function Applications() {
  const { applications, error, loading, reload } = useChainApplications();
  const [selected, setSelected] = useState<ChainApplication | null>(null);
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  if (selected) return <AppDetail app={selected} onBack={() => setSelected(null)} onChanged={async () => { await reload(); setSelected(null); }} />;
  const filtered = filter === 'all' ? applications : applications.filter((application) => application.status === filter);

  return <div>
    <SectionTitle title="Company Applications" sub={loading ? 'Reading local blockchain…' : `${applications.length} on-chain applications`} action={<div style={{ display: 'flex', background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, overflow: 'hidden' }}>{(['all', 'pending', 'approved', 'rejected'] as const).map((value) => <button key={value} onClick={() => setFilter(value)} style={{ padding: '7px 14px', fontSize: 11, border: 'none', cursor: 'pointer', fontFamily: UI, textTransform: 'capitalize', background: filter === value ? T.teal : 'transparent', color: filter === value ? T.navyDark : T.text2 }}>{value} ({value === 'all' ? applications.length : applications.filter((application) => application.status === value).length})</button>)}</div>} />
    {error && <div style={{ marginBottom: 12, color: T.red, fontSize: 12 }}>Local chain read failed: {error} <Btn onClick={() => void reload()} size="xs" variant="outline">Retry</Btn></div>}
    <Card padding="0">{!loading && filtered.length === 0 ? <EmptyState icon={<ClipboardList size={44} />} title="No on-chain applications" sub="Submit an application from a non-admin wallet on the local network." /> : <Table headers={['Application ID', 'Applicant wallet', 'Role', 'Submitted', 'Profile hash', 'Status', '']}>
      {filtered.map((application) => <TR key={application.id} onClick={() => setSelected(application)}><TD mono muted>{short(application.id)}</TD><TD mono>{short(application.applicant)}</TD><TD>{application.requestedRole}</TD><TD muted>{new Date(application.submittedAt * 1000).toLocaleString()}</TD><TD mono muted>{short(application.profileHash)}</TD><TD><Badge label={application.status} variant={application.status === 'approved' ? 'verified' : application.status === 'rejected' ? 'rejected' : 'pending'} /></TD><TD><Btn variant="outline" size="xs">Review →</Btn></TD></TR>)}
    </Table>}</Card>
  </div>;
}

function short(value: string) { return `${value.slice(0, 10)}…${value.slice(-6)}`; }
