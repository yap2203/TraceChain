import { LoadingIndicator } from '../../../../components/ui/LoadingIndicator';
import { ClipboardList } from 'lucide-react';
import { useState } from 'react';
import {
  Alert,
  Badge,
  Btn,
  Card,
  EmptyState,
  SectionTitle,
  StatusTabs,
  Table,
  TD,
  TR,
} from '../../shared/ui';
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
            {loading && applications.length
              ? 'Refreshing…'
              : error
                ? 'Retry'
                : 'Refresh applications'}
          </Btn>
        }
      />
      <StatusTabs
        label="Application status"
        value={filter}
        onChange={setFilter}
        tabs={filters.map((value) => ({
          value,
          label:
            value === 'all'
              ? 'All'
              : value === 'additional evidence required'
                ? 'Needs evidence'
                : value.charAt(0).toUpperCase() + value.slice(1),
          count:
            loading || error
              ? undefined
              : value === 'all'
                ? applications.length
                : applications.filter((application) => application.status === value).length,
        }))}
      />
      {error && (
        <Alert type="error" announce={false} message={`Applications unavailable: ${error}`} />
      )}
      {loading && !applications.length ? (
        <LoadingIndicator page layout="table" label="Loading applications…" />
      ) : error ? null : (
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
