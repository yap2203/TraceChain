import { FileSearch } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { getApplications, getCompanyCredentials, type ChainCredential } from '../../../blockchain/blockchain.api';
import type { ChainApplication } from '../applications/types';
import { Badge, Btn, Card, EmptyState, SectionTitle, T, Table, TD, TR } from '../../shared/ui';

interface AuditRow { category: string; id: string; subject: string; status: string; timestamp: number; reference: string }

export default function AdminAuditReport() {
  const [applications, setApplications] = useState<ChainApplication[]>([]);
  const [credentials, setCredentials] = useState<ChainCredential[]>([]);
  const [error, setError] = useState(''); const [loading, setLoading] = useState(true);
  const load = useCallback(async () => { setLoading(true); setError(''); try { const [applicationResult, credentialResult] = await Promise.all([getApplications<ChainApplication>(), getCompanyCredentials()]); setApplications(applicationResult.applications); setCredentials(credentialResult.credentials); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Audit snapshot could not be generated.'); } finally { setLoading(false); } }, []);
  useEffect(() => { void load(); }, [load]);
  const rows = useMemo<AuditRow[]>(() => [
    ...applications.map((item) => ({ category: 'Application', id: item.id, subject: item.applicant, status: item.status, timestamp: item.updatedAt, reference: item.profileHash })),
    ...credentials.map((item) => ({ category: 'Credential', id: item.credentialId, subject: item.subject, status: item.status, timestamp: item.updatedAt, reference: item.credentialHash })),
    ...credentials.map((item) => ({ category: 'Stakeholder access', id: item.applicationId, subject: item.subject, status: item.stakeholderStatus, timestamp: item.stakeholderUpdatedAt, reference: item.credentialId })),
  ].sort((a, b) => b.timestamp - a.timestamp), [applications, credentials]);
  const snapshot = { chainScope: 'Configured TraceChain network', generatedAt: new Date().toISOString(), applications, credentials };
  return <div>
    <SectionTitle title="Registry Audit Report" sub={loading ? 'Reading authoritative registries...' : `Snapshot generated ${new Date().toLocaleString()}`} action={<div style={{ display: 'flex', gap: 8 }}><Btn size="sm" variant="outline" onClick={() => download('tracechain-audit.json', JSON.stringify(snapshot, null, 2), 'application/json')}>Export JSON</Btn><Btn size="sm" variant="outline" onClick={() => download('tracechain-audit.csv', csv(rows), 'text/csv')}>Export CSV</Btn><Btn size="sm" variant="outline" onClick={() => window.print()}>Print</Btn></div>} />
    <div style={{ background: T.tealLight, border: `1px solid ${T.border}`, padding: 14, borderRadius: 10, marginBottom: 14, fontSize: 12, color: T.text2 }}>This report is a current registry snapshot, not a claim that every historical event was indexed. IDs, hashes, wallet subjects, lifecycle states, and timestamps come from the configured contracts; company labels come from persisted issuance metadata.</div>
    {error && <div style={{ color: T.red, marginBottom: 12 }}>{error} <Btn size="xs" variant="outline" onClick={() => void load()}>Retry</Btn></div>}
    <Card padding="0">{!loading && rows.length === 0 ? <EmptyState icon={<FileSearch size={44} />} title="No auditable registry records" sub="Applications and issued credentials will appear here." /> : <Table headers={['Category', 'Record ID', 'Wallet / subject', 'Status', 'Last update', 'Integrity reference']}>
      {rows.map((row, index) => <TR key={`${row.category}-${row.id}-${index}`}><TD bold>{row.category}</TD><TD mono muted>{short(row.id)}</TD><TD mono>{short(row.subject)}</TD><TD><Badge label={row.status} variant={row.status === 'active' || row.status === 'approved' ? 'verified' : row.status === 'suspended' || row.status === 'pending' ? 'pending' : 'rejected'} /></TD><TD muted>{new Date(row.timestamp * 1_000).toLocaleString()}</TD><TD mono muted>{short(row.reference)}</TD></TR>)}
    </Table>}</Card>
  </div>;
}

function short(value: string) { return value.length > 22 ? `${value.slice(0, 10)}...${value.slice(-7)}` : value; }
function csv(rows: AuditRow[]) { const quote = (value: unknown) => `"${String(value).replaceAll('"', '""')}"`; return [['Category', 'Record ID', 'Subject', 'Status', 'Timestamp', 'Reference'], ...rows.map((row) => [row.category, row.id, row.subject, row.status, new Date(row.timestamp * 1_000).toISOString(), row.reference])].map((row) => row.map(quote).join(',')).join('\n'); }
function download(name: string, content: string, type: string) { const url = URL.createObjectURL(new Blob([content], { type })); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url); }
