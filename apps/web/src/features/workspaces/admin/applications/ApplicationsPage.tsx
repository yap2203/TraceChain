import { LoadingIndicator } from '../../../../components/ui/LoadingIndicator';
import { ClipboardList } from 'lucide-react';
import { useState } from 'react';
import { Alert, Badge, Btn, Card, EmptyState, SectionTitle, Table, TD, TR } from '../../shared/ui';
import { AppDetail } from './ApplicationDetail';
import type { ApplicationStatus, ChainApplication } from './types';
import { useChainApplications } from './useChainApplications';
import { CompanyAvatar } from '../../../orders/CatalogueMedia';

export function Applications() {
  const { applications, error, loading, reload } = useChainApplications();
  const [selected, setSelected] = useState<ChainApplication | null>(null);
  const [filter, setFilter] = useState<'all' | ApplicationStatus>('all');
  if (selected)
    return (
      <AppDetail
        app={selected}
        onBack={() => setSelected(null)}
        onChanged={async () => {
          await reload();
          setSelected(null);
        }}
      />
    );
  const filtered =
    filter === 'all'
      ? applications
      : applications.filter((application) => application.status === filter);
  const filters = [
    'all',
    'pending',
    'additional evidence required',
    'approved',
    'rejected',
    'withdrawn',
  ] as const;
  return (
    <div className="grid min-w-0 gap-[16px]">
      <SectionTitle
        title="Company applications"
        sub="Review company details and record an approval or rejection."
        action={
          <Btn variant="outline" disabled={loading} onClick={() => void reload()}>
            Refresh applications
          </Btn>
        }
      />
      <nav className="workspace-secondary-tabs" aria-label="Application status">
        {filters.map((value) => (
          <Btn
            key={value}
            size="sm"
            aria-pressed={filter === value}
            variant={filter === value ? 'primary' : 'outline'}
            onClick={() => setFilter(value)}
          >
            {value === 'all'
              ? 'All'
              : value === 'additional evidence required'
                ? 'Needs evidence'
                : value.charAt(0).toUpperCase() + value.slice(1)}{' '}
            (
            {value === 'all'
              ? applications.length
              : applications.filter((application) => application.status === value).length}
            )
          </Btn>
        ))}
      </nav>
      {error && <Alert type="error" message={`Applications unavailable: ${error}`} />}
      {loading ? (
        <LoadingIndicator page label="Loading applications…" />
      ) : (
        <Card padding="0">
          {filtered.length === 0 ? (
            <EmptyState
              icon={<ClipboardList size={44} />}
              title="No applications found"
              sub={
                filter === 'all'
                  ? 'New company registrations will appear here.'
                  : 'Choose another status to see other applications.'
              }
            />
          ) : (
            <Table
              headers={[
                'Company',
                'Applicant wallet',
                'Requested role',
                'Submitted',
                'Status',
                'Action',
              ]}
            >
              {filtered.map((application) => (
                <TR key={application.id} onClick={() => setSelected(application)}>
                  <TD bold>
                    <span className="workspace-company-cell">
                      <CompanyAvatar
                        name={application.companyName || 'Company'}
                        logoPath={application.pendingLogoPath}
                        size="sm"
                      />
                      {application.companyName || 'Company name unavailable'}
                    </span>
                  </TD>
                  <TD mono>{short(application.applicant)}</TD>
                  <TD>{application.requestedRole}</TD>
                  <TD muted>{new Date(application.submittedAt * 1000).toLocaleString()}</TD>
                  <TD>
                    <Badge
                      label={application.status}
                      variant={
                        application.status === 'approved'
                          ? 'verified'
                          : application.status === 'rejected'
                            ? 'rejected'
                            : 'pending'
                      }
                    />
                  </TD>
                  <TD>
                    <Btn variant="outline" size="sm" onClick={() => setSelected(application)}>
                      Review application
                    </Btn>
                  </TD>
                </TR>
              ))}
            </Table>
          )}
        </Card>
      )}
    </div>
  );
}
function short(value: string) {
  return `${value.slice(0, 10)}…${value.slice(-6)}`;
}
