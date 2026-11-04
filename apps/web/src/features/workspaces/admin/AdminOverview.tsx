import { ClipboardList, Database, Network, ShieldCheck } from 'lucide-react';

import { chainConfig } from '../../../config/chain';
import { Btn, Card, EmptyState, StatCard, T } from '../shared/ui';
import { useChainApplications } from './applications/useChainApplications';

export function AdminOverview({ onNav }: { onNav: (tab: string) => void }) {
  const { applications, error, loading, reload } = useChainApplications();
  const pending = applications.filter((application) => application.status === 'pending');
  const approved = applications.filter((application) => application.status === 'approved');
  const rejected = applications.filter((application) => application.status === 'rejected');

  return <div style={{ display: 'grid', gap: 20 }}>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16 }}>
      <StatCard label="On-chain applications" value={loading ? '…' : String(applications.length)} color={T.teal} icon={<Database size={22} />} delta={`Chain ${chainConfig.chainId}`} />
      <StatCard label="Pending review" value={loading ? '…' : String(pending.length)} color={T.amber} icon={<ClipboardList size={22} />} delta="From StakeholderRegistry" />
      <StatCard label="Approved" value={loading ? '…' : String(approved.length)} color={T.green} icon={<ShieldCheck size={22} />} delta="On-chain state" />
      <StatCard label="Rejected" value={loading ? '…' : String(rejected.length)} color={T.red} icon={<Network size={22} />} delta={chainConfig.name} />
    </div>
    {error && <Card><div style={{ color: T.red, fontSize: 12 }}>Could not read the local registry: {error}</div><Btn onClick={() => void reload()} size="sm" variant="outline">Retry</Btn></Card>}
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}><div style={{ fontWeight: 700, fontSize: 15, color: T.navy }}>Pending applications</div><Btn onClick={() => onNav('applications')} variant="outline" size="sm">View all</Btn></div>
      {!loading && pending.length === 0 ? <EmptyState icon={<ClipboardList size={40} />} title="No pending applications" sub="The local StakeholderRegistry currently has no pending records." /> : pending.slice(0, 5).map((application) => <div key={application.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: `1px solid ${T.border}` }}><div><div style={{ fontFamily: 'monospace', fontSize: 12, color: T.navy }}>{short(application.applicant)}</div><div style={{ fontSize: 11, color: T.text2, marginTop: 2 }}>{short(application.id)} · {application.requestedRole} · {new Date(application.submittedAt * 1000).toLocaleString()}</div></div><Btn onClick={() => onNav('applications')} variant="outline" size="xs">Review</Btn></div>)}
    </Card>
  </div>;
}

function short(value: string) { return `${value.slice(0, 10)}…${value.slice(-6)}`; }
