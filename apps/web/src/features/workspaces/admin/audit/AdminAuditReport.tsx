import { reportError } from '../../../../components/ui/feedback';
import { LoadingIndicator } from '../../../../components/ui/LoadingIndicator';
import { FileCheck2, FileClock, FileSearch, Search, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  getApplications,
  getCompanyCredentials,
  type ChainCredential,
} from '../../../blockchain/blockchain.api';
import type { ChainApplication } from '../applications/types';
import {
  Badge,
  Btn,
  EmptyState,
  Input,
  InventorySummaryCard,
  SectionTitle,
  StatusTabs,
  T,
  TechnicalDetails,
} from '../../shared/ui';

interface AuditRow {
  category: string;
  id: string;
  name: string;
  subject: string;
  status: string;
  timestamp: number;
  reference: string;
}

export default function AdminAuditReport() {
  const [applications, setApplications] = useState<ChainApplication[]>([]);
  const [credentials, setCredentials] = useState<ChainCredential[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [applicationResult, credentialResult] = await Promise.all([
        getApplications<ChainApplication>(),
        getCompanyCredentials(),
      ]);
      setApplications(applicationResult.applications);
      setCredentials(credentialResult.credentials);
    } catch (cause) {
      setError(reportError(cause, 'Audit snapshot could not be generated.'));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const rows = useMemo<AuditRow[]>(
    () =>
      [
        ...applications.map((item) => ({
          category: 'Application',
          id: item.id,
          name: item.companyName ?? 'Company application',
          subject: item.applicant,
          status: item.status,
          timestamp: item.updatedAt,
          reference: item.profileHash,
        })),
        ...credentials.map((item) => ({
          category: 'Credential',
          id: item.credentialId,
          name: item.companyName,
          subject: item.subject,
          status: item.status,
          timestamp: item.updatedAt,
          reference: item.credentialHash,
        })),
        ...credentials.map((item) => ({
          category: 'Stakeholder access',
          id: item.applicationId,
          name: item.companyName,
          subject: item.subject,
          status: item.stakeholderStatus,
          timestamp: item.stakeholderUpdatedAt,
          reference: item.credentialId,
        })),
      ].sort((a, b) => b.timestamp - a.timestamp),
    [applications, credentials],
  );
  const visibleRows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return rows.filter(
      (row) =>
        (category === 'all' || row.category === category) &&
        (!query ||
          [row.name, row.category, row.status].join(' ').toLocaleLowerCase().includes(query)),
    );
  }, [category, rows, search]);
  const snapshot = {
    chainScope: 'Configured TraceChain network',
    generatedAt: new Date().toISOString(),
    applications,
    credentials,
  };
  if (loading) return <LoadingIndicator page label="Loading registry audit…" />;
  return (
    <div>
      <SectionTitle
        title="Registry audit report"
        sub={
          loading
            ? 'Reading authoritative registries...'
            : `Snapshot generated ${new Date().toLocaleString()}`
        }
        action={
          <div className="action-row">
            <Btn
              size="sm"
              variant="outline"
              onClick={() =>
                download(
                  'tracechain-audit.json',
                  JSON.stringify(snapshot, null, 2),
                  'application/json',
                )
              }
            >
              Export JSON
            </Btn>
            <Btn
              size="sm"
              variant="outline"
              onClick={() => download('tracechain-audit.csv', csv(rows), 'text/csv')}
            >
              Export CSV
            </Btn>
            <Btn size="sm" variant="outline" onClick={() => window.print()}>
              Print
            </Btn>
          </div>
        }
      />
      <div
        style={{
          background: T.tealLight,
          border: `1px solid ${T.border}`,
          padding: 14,
          borderRadius: 10,
          marginBottom: 14,
          fontSize: 12,
          color: T.text2,
        }}
      >
        This report is a current registry snapshot, not a claim that every historical event was
        indexed. IDs, hashes, wallet subjects, lifecycle states, and timestamps come from the
        configured contracts; company labels come from persisted issuance metadata.
      </div>
      {error && (
        <div style={{ color: T.red, marginBottom: 12 }}>
          {error}{' '}
          <Btn size="xs" variant="outline" onClick={() => void load()}>
            Retry
          </Btn>
        </div>
      )}
      <div className="admin-audit-summary" aria-label="Registry audit summary">
        <InventorySummaryCard
          icon={<FileClock size={20} />}
          label="Applications"
          value={applications.length}
        />
        <InventorySummaryCard
          icon={<FileCheck2 size={20} />}
          label="Credentials"
          value={credentials.length}
        />
        <InventorySummaryCard
          icon={<ShieldCheck size={20} />}
          label="Active stakeholders"
          value={credentials.filter((item) => item.stakeholderStatus === 'active').length}
        />
      </div>
      <StatusTabs
        label="Filter registry audit records by type"
        value={category}
        onChange={setCategory}
        variant="connected"
        tabs={[
          { value: 'all', label: 'All records', count: rows.length },
          {
            value: 'Application',
            label: 'Applications',
            count: rows.filter((row) => row.category === 'Application').length,
          },
          {
            value: 'Credential',
            label: 'Credentials',
            count: rows.filter((row) => row.category === 'Credential').length,
          },
          {
            value: 'Stakeholder access',
            label: 'Stakeholder access',
            count: rows.filter((row) => row.category === 'Stakeholder access').length,
          },
        ]}
      />
      <div className="admin-audit-toolbar">
        <Input
          label="Search registry records"
          type="search"
          icon={<Search size={16} />}
          value={search}
          onChange={setSearch}
          placeholder="Company, record type or status"
        />
      </div>
      <div className="admin-audit-records">
        {!loading && rows.length === 0 ? (
          <EmptyState
            icon={<FileSearch size={44} />}
            title="No auditable registry records"
            sub="Applications and issued credentials will appear here."
          />
        ) : !visibleRows.length ? (
          <EmptyState
            icon={<Search size={40} />}
            title="No registry records match these filters"
            sub="Change the record type or search text."
            action={
              <Btn
                onClick={() => {
                  setCategory('all');
                  setSearch('');
                }}
              >
                Clear filters
              </Btn>
            }
          />
        ) : (
          visibleRows.map((row, index) => (
            <article className="admin-audit-record" key={`${row.category}-${row.id}-${index}`}>
              <div className="admin-audit-record__heading">
                <div>
                  <span>{row.category}</span>
                  <h3>{row.name}</h3>
                </div>
                <Badge
                  label={row.status}
                  variant={
                    row.status === 'active' || row.status === 'approved'
                      ? 'verified'
                      : row.status === 'suspended' || row.status === 'pending'
                        ? 'pending'
                        : 'rejected'
                  }
                />
              </div>
              <p>Last updated {new Date(row.timestamp * 1_000).toLocaleString()}</p>
              <TechnicalDetails
                fields={[
                  { label: 'Record ID', value: row.id },
                  { label: 'Wallet / subject', value: row.subject },
                  { label: 'Integrity reference', value: row.reference },
                ]}
              />
            </article>
          ))
        )}
      </div>
    </div>
  );
}

function csv(rows: AuditRow[]) {
  const quote = (value: unknown) => `"${String(value).replaceAll('"', '""')}"`;
  return [
    ['Category', 'Record ID', 'Subject', 'Status', 'Timestamp', 'Reference'],
    ...rows.map((row) => [
      row.category,
      row.id,
      row.subject,
      row.status,
      new Date(row.timestamp * 1_000).toISOString(),
      row.reference,
    ]),
  ]
    .map((row) => row.map(quote).join(','))
    .join('\n');
}
function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
