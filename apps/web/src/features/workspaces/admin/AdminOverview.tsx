import { LoadingIndicator } from '../../../components/ui/LoadingIndicator';
import { ClipboardList, Database, Network, ShieldCheck } from 'lucide-react';
import { chainConfig } from '../../../config/chain';
import { Alert, Btn, Card, EmptyState, SectionTitle, StatCard, T } from '../shared/ui';
import { useChainApplications } from './applications/useChainApplications';
import { WorkspaceGuide } from '../WorkspaceGuide';

export function AdminOverview({ onNav }: { onNav: (tab: string) => void }) {
  const { applications, error, loading, reload } = useChainApplications();
  const pending = applications.filter((application) => application.status === 'pending');
  const approved = applications.filter((application) => application.status === 'approved');
  const rejected = applications.filter((application) => application.status === 'rejected');
  if (loading) return <LoadingIndicator page label="Loading records…" />;
  return (
    <div className="grid min-w-0 gap-[20px]">
      <SectionTitle
        title="Company approvals"
        sub="Monitor registrations and open the applications that need your review."
      />
      <WorkspaceGuide />
      <div className="workspace-metrics">
        <StatCard
          label="Applications"
          value={loading ? '…' : String(applications.length)}
          color={T.teal}
          icon={<Database size={22} />}
          delta={chainConfig.name}
        />
        <StatCard
          label="Pending review"
          value={loading ? '…' : String(pending.length)}
          color={T.amber}
          icon={<ClipboardList size={22} />}
          delta="Awaiting a decision"
        />
        <StatCard
          label="Approved"
          value={loading ? '…' : String(approved.length)}
          color={T.green}
          icon={<ShieldCheck size={22} />}
          delta="Approved applications"
        />
        <StatCard
          label="Rejected"
          value={loading ? '…' : String(rejected.length)}
          color={T.red}
          icon={<Network size={22} />}
          delta="Rejected applications"
        />
      </div>
      {error && (
        <Card>
          <Alert type="error" message={`Applications unavailable: ${error}`} />
          <Btn onClick={() => void reload()} size="sm" variant="outline">
            Retry
          </Btn>
        </Card>
      )}
      <Card>
        <SectionTitle
          title="Pending applications"
          action={
            <Btn onClick={() => onNav('applications')} variant="outline" size="sm">
              View all
            </Btn>
          }
        />
        {!loading && pending.length === 0 ? (
          <EmptyState
            icon={<ClipboardList size={40} />}
            title="No pending applications"
            sub="New registrations awaiting review will appear here."
          />
        ) : (
          pending.slice(0, 5).map((application) => (
            <div key={application.id} className="workspace-application-row">
              <div>
                <strong>{application.companyName || short(application.applicant)}</strong>
                <p>
                  {application.requestedRole} ·{' '}
                  {new Date(application.submittedAt * 1000).toLocaleString()}
                </p>
              </div>
              <Btn onClick={() => onNav('applications')} variant="outline" size="sm">
                Review
              </Btn>
            </div>
          ))
        )}
      </Card>
    </div>
  );
}
function short(value: string) {
  return `${value.slice(0, 10)}…${value.slice(-6)}`;
}
