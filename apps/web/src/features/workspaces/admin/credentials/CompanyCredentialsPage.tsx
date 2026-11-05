import { BadgeCheck } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { getCompanyCredentials, type ChainCredential } from '../../../blockchain/blockchain.api';
import { Badge, Btn, Card, EmptyState, SectionTitle, StatCard, T, Table, TD, TR } from '../../shared/ui';
import { CredDetail } from './CredentialDetail';

export function CompanyCredentials() {
  const [credentials, setCredentials] = useState<ChainCredential[]>([]);
  const [selected, setSelected] = useState<ChainCredential | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setCredentials((await getCompanyCredentials()).credentials); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Credential registry read failed.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (selected) return <CredDetail cred={selected} onBack={() => setSelected(null)} onChanged={async () => { await load(); setSelected(null); }} />;
  const count = (status: ChainCredential['status']) => credentials.filter((item) => item.status === status).length;
  return <div>
    <SectionTitle title="Company Credentials" sub={loading ? 'Reading CredentialRegistry...' : `${credentials.length} issued Company Role Credentials`} action={<div style={{ display: 'flex', gap: 8 }}><StatCard label="Active" value={String(count('active'))} color={T.green} /><StatCard label="Suspended" value={String(count('suspended'))} color={T.amber} /><StatCard label="Revoked" value={String(count('revoked'))} color={T.red} /></div>} />
    {error && <div style={{ color: T.red, marginBottom: 12, fontSize: 12 }}>{error} <Btn size="xs" variant="outline" onClick={() => void load()}>Retry</Btn></div>}
    <Card padding="0">{!loading && credentials.length === 0 ? <EmptyState icon={<BadgeCheck size={44} />} title="No issued credentials" sub="Approve a company application and register its credential first." /> : <Table headers={['Company', 'Registration', 'Role', 'Credential ID', 'Issued', 'Expiry', 'Status', '']}>
      {credentials.map((credential) => <TR key={credential.credentialId} onClick={() => setSelected(credential)}><TD bold>{credential.companyName}</TD><TD mono muted>{credential.companyRegistrationNumber}</TD><TD>{displayRole(credential.role)}</TD><TD mono muted>{short(credential.credentialId)}</TD><TD muted>{date(credential.issuedAt)}</TD><TD muted>{date(credential.expiresAt)}</TD><TD><Badge label={credential.status} variant={badge(credential.status)} /></TD><TD><Btn size="xs" variant="outline">Manage</Btn></TD></TR>)}
    </Table>}</Card>
  </div>;
}

function date(timestamp: number) { return new Date(timestamp * 1_000).toLocaleDateString(); }
function short(value: string) { return `${value.slice(0, 10)}...${value.slice(-6)}`; }
function displayRole(role: string) { return role.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function badge(status: ChainCredential['status']) { return status === 'active' ? 'active' : status === 'suspended' ? 'suspended' : 'rejected'; }
