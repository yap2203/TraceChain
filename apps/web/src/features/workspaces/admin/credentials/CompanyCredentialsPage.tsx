import { reportError } from '../../../../components/ui/feedback';
import { LoadingIndicator } from '../../../../components/ui/LoadingIndicator';
import { BadgeCheck, RefreshCw, Search } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BrowserProvider } from 'ethers';

import { getCompanyCredentials, type ChainCredential } from '../../../blockchain/blockchain.api';
import { sendPreparedTransaction } from '../../../blockchain/blockchain.api';
import { prepareAdministratorCredentialOnChain } from '../../../auth/auth.api';
import { Badge, Btn, Card, EmptyState, SectionTitle, T, Table, TD, TR } from '../../shared/ui';
import { CredDetail } from './CredentialDetail';
import { BackNavigation } from '../../../../components/ui/BackNavigation';
import { Alert } from '../../shared/ui';

export function CompanyCredentials() {
  const [credentials, setCredentials] = useState<ChainCredential[]>([]);
  const [roleFilter, setRoleFilter] = useState('all');
  const [accessFilter, setAccessFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('credentialId');
  const selected = selectedId
    ? credentials.find((record) => record.credentialId.toLowerCase() === selectedId.toLowerCase())
    : undefined;
  const selectCredential = (credentialId?: string) => {
    const next = new URLSearchParams(params);
    if (credentialId) next.set('credentialId', credentialId);
    else next.delete('credentialId');
    setParams(next);
  };
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [connectingAdmin, setConnectingAdmin] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const records = (await getCompanyCredentials()).credentials;
      setCredentials(records);
      return records;
    } catch (cause) {
      setError(reportError(cause, 'Credential registry read failed.'));
      return null;
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const connectAdministratorCredential = async () => {
    if (!window.ethereum) {
      setError('MetaMask is required.');
      return;
    }
    setConnectingAdmin(true);
    setError('');
    try {
      let prepared = await prepareAdministratorCredentialOnChain();
      const signer = await new BrowserProvider(window.ethereum).getSigner();
      if (prepared.credentialRegistrationTransaction) {
        const transaction = await sendPreparedTransaction(
          signer,
          prepared.credentialRegistrationTransaction,
        );
        await transaction.wait();
        prepared = await prepareAdministratorCredentialOnChain();
      }
      if (prepared.credentialReferenceTransaction) {
        const transaction = await sendPreparedTransaction(
          signer,
          prepared.credentialReferenceTransaction,
        );
        await transaction.wait();
      }
      await load();
    } catch (cause) {
      setError(reportError(cause, 'Admin credential connection failed.'));
    } finally {
      setConnectingAdmin(false);
    }
  };
  if (loading && credentials.length === 0)
    return <LoadingIndicator page label="Loading records…" />;
  if (selected)
    return (
      <CredDetail
        key={selected.credentialId}
        cred={selected}
        onBack={() => selectCredential()}
        refreshing={loading}
        refreshError={error}
        onChanged={async () => {
          const records = await load();
          const record = records?.find((item) => item.credentialId === selected.credentialId);
          if (!record) throw new Error('The company record could not be refreshed.');
          return record;
        }}
      />
    );
  if (selectedId)
    return (
      <div className="admin-company-detail">
        <BackNavigation onClick={() => selectCredential()}>Back to Manage companies</BackNavigation>
        {error ? (
          <Alert type="error" message={error} />
        ) : (
          <EmptyState
            icon={<BadgeCheck size={40} />}
            title="Company record unavailable"
            sub="No accessible company credential matches this link. Return to Manage companies or refresh the records."
          />
        )}
        <div className="action-row">
          <Btn variant="outline" onClick={() => void load()}>
            Refresh records
          </Btn>
        </div>
      </div>
    );
  const roles = ['Supplier', 'Manufacturer', 'Distributor', 'Retailer'];
  const filtered = credentials.filter(
    (record) =>
      (roleFilter === 'all' || displayRole(record.role) === roleFilter) &&
      (accessFilter === 'all' || record.stakeholderStatus === accessFilter) &&
      [record.companyName, record.companyRegistrationNumber, record.subject].some((value) =>
        value?.toLowerCase().includes(search.trim().toLowerCase()),
      ),
  );
  const administratorConnected = credentials.some((item) => item.role === 'SYSTEM_ADMIN');
  return (
    <div className="admin-company-list">
      <SectionTitle
        title="Manage companies"
        sub={
          loading
            ? 'Reading CredentialRegistry...'
            : `${credentials.length} company records. Manage access, credentials and individual permissions.`
        }
        action={
          <div className="action-row">
            {!administratorConnected && (
              <Btn
                size="xs"
                variant="outline"
                disabled={connectingAdmin}
                onClick={() => void connectAdministratorCredential()}
              >
                {connectingAdmin ? 'Connecting Admin credential...' : 'Connect Admin credential'}
              </Btn>
            )}
            <Btn
              size="sm"
              variant="outline"
              icon={<RefreshCw size={15} />}
              disabled={loading || connectingAdmin}
              onClick={() => void load()}
            >
              {loading ? 'Refreshing...' : 'Refresh companies'}
            </Btn>
          </div>
        }
      />
      <div className="admin-company-role-stats" aria-label="Company statistics by role">
        {roles.map((name) => (
          <button
            key={name}
            type="button"
            aria-pressed={roleFilter === name}
            onClick={() => setRoleFilter(roleFilter === name ? 'all' : name)}
          >
            <span>{name}s</span>{' '}
            <strong>
              {credentials.filter((record) => displayRole(record.role) === name).length}
            </strong>
          </button>
        ))}
      </div>
      <div className="admin-company-filters">
        <p className="admin-company-note">
          Credential records:{' '}
          {['active', 'suspended', 'revoked', 'expired']
            .map(
              (status) =>
                `${credentials.filter((record) => record.status === status).length} ${status}`,
            )
            .join(' · ')}
        </p>
        <nav className="workspace-choice-tabs" aria-label="Filter companies by role">
          {['all', ...roles].map((name) => (
            <button
              key={name}
              type="button"
              aria-pressed={roleFilter === name}
              onClick={() => setRoleFilter(name)}
            >
              {name === 'all' ? 'All companies' : name}
            </button>
          ))}
        </nav>
        <div className="admin-company-search-row">
          <label className="admin-company-search">
            <Search size={17} aria-hidden="true" />
            <span className="sr-only">Search companies</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search company, registration or wallet"
            />
          </label>
          <label className="admin-company-access-filter">
            Company access
            <select value={accessFilter} onChange={(event) => setAccessFilter(event.target.value)}>
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
              <option value="revoked">Revoked</option>
              <option value="unknown">Unknown</option>
            </select>
          </label>
        </div>
        <p className="admin-company-note" role="status">
          Showing {filtered.length} of {credentials.length} company records · Credential status and
          company access are recorded separately.
        </p>
      </div>
      {error && (
        <div style={{ color: T.red, marginBottom: 12, fontSize: 12 }}>
          {error}{' '}
          <Btn size="xs" variant="outline" onClick={() => void load()}>
            Retry
          </Btn>
        </div>
      )}
      <Card padding="0">
        {!loading && filtered.length === 0 ? (
          <EmptyState
            icon={<BadgeCheck size={44} />}
            title={credentials.length ? 'No matching companies' : 'No issued credentials'}
            sub={
              credentials.length
                ? 'Change the role, access status or search to find a company.'
                : 'Approve a company application and register its credential first.'
            }
          />
        ) : (
          <Table
            headers={[
              'Company',
              'Registration',
              'Role',
              'Credential ID',
              'Issued',
              'Expiry',
              'Credential status',
              'Company access',
              '',
            ]}
          >
            {filtered.map((credential) => (
              <TR
                key={credential.credentialId}
                onClick={() => selectCredential(credential.credentialId)}
              >
                <TD bold>{credential.companyName || 'Company name unavailable'}</TD>
                <TD mono muted>
                  {credential.companyRegistrationNumber}
                </TD>
                <TD>{displayRole(credential.role)}</TD>
                <TD mono muted>
                  {short(credential.credentialId)}
                </TD>
                <TD muted>{date(credential.issuedAt)}</TD>
                <TD muted>{date(credential.expiresAt)}</TD>
                <TD>
                  <Badge label={credential.status} variant={badge(credential.status)} />
                </TD>
                <TD>
                  <Badge
                    label={credential.stakeholderStatus}
                    variant={badge(credential.stakeholderStatus)}
                  />
                </TD>
                <TD>
                  <Btn
                    size="xs"
                    variant="outline"
                    onClick={(event) => {
                      event.stopPropagation();
                      selectCredential(credential.credentialId);
                    }}
                  >
                    Manage
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

function date(timestamp: number) {
  return new Date(timestamp * 1_000).toLocaleDateString();
}
function short(value: string) {
  return `${value.slice(0, 10)}...${value.slice(-6)}`;
}
function displayRole(role: string) {
  return role
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function badge(status: ChainCredential['status']) {
  return status === 'active' ? 'active' : status === 'suspended' ? 'suspended' : 'rejected';
}
