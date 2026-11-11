import { BrowserProvider, id } from 'ethers';
import { ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { targetChainId } from '../../../../config/chain';
import {
  getCompanyCredentials,
  getRolePermissions,
  getPersonalPermissions,
  preparePersonalPermission,
  prepareRolePermission,
  prepareStakeholderLifecycle,
  sendPreparedTransaction,
  type ChainCredential,
  type RolePermissionRecord,
  type PersonalPermissionRecord,
} from '../../../blockchain/blockchain.api';
import {
  Alert,
  Badge,
  Btn,
  Card,
  EmptyState,
  Modal,
  T,
  Table,
  TD,
  Textarea,
  TR,
  UI,
} from '../../shared/ui';

type Tab = 'stakeholders' | 'roles' | 'matrix' | 'personal';
const roles = ['System Admin', 'Supplier', 'Manufacturer', 'Distributor', 'Retailer'] as const;
const operationalRoles = ['Supplier', 'Manufacturer', 'Distributor', 'Retailer'] as const;
const permissionLabels: Record<string, string> = {
  REGISTER_INGREDIENT: 'Register ingredient batches',
  ISSUE_INGREDIENT_CREDENTIAL: 'Issue ingredient/evidence credentials',
  REQUEST_EVIDENCE: 'Request supplier evidence',
  REGISTER_PRODUCT: 'Register product batches',
  INITIATE_TRANSFER: 'Initiate permitted custody transfers',
  RECEIVE_TRANSFER: 'Receive intended custody transfers',
};
const roleColors: Record<string, string> = {
  Supplier: T.teal,
  Manufacturer: T.navy,
  Distributor: '#0369A1',
  Retailer: '#7C3AED',
};

export default function AccessControl() {
  const [tab, setTab] = useState<Tab>('stakeholders');
  const [records, setRecords] = useState<ChainCredential[]>([]);
  const [permissions, setPermissions] = useState<RolePermissionRecord[]>([]);
  const [selected, setSelected] = useState<ChainCredential | null>(null);
  const [action, setAction] = useState<'reactivate' | 'revoke' | 'suspend' | null>(null);
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const stakeholders = await getCompanyCredentials();
      setRecords(stakeholders.credentials);
      try {
        setPermissions((await getRolePermissions()).permissions);
      } catch {
        setPermissions([]);
        setError(
          'The deployed StakeholderRegistry does not expose configurable permissions yet. Redeploy the updated contracts.',
        );
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Access-control registry read failed.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const execute = async () => {
    if (reason.length > 4000) {
      setError('Reason must be 4000 characters or fewer.');
      return;
    }
    if (action === 'revoke' && !confirm) {
      setError('Confirm that revocation is permanent.');
      return;
    }
    if (!selected || !action || !window.ethereum || (action !== 'reactivate' && !reason.trim()))
      return;
    setBusy(true);
    setError('');
    try {
      const prepared = await prepareStakeholderLifecycle({
        account: selected.subject,
        action,
        reasonHash: action === 'reactivate' ? undefined : id(reason.trim()),
      });
      if (BigInt(prepared.chainId) !== targetChainId)
        throw new Error('The API transaction targets a different chain.');
      const transaction = await sendPreparedTransaction(
        await new BrowserProvider(window.ethereum).getSigner(),
        prepared,
      );
      if (!(await transaction.wait())) throw new Error('The transaction was not confirmed.');
      setAction(null);
      setSelected(null);
      setReason('');
      setConfirm(false);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Stakeholder action failed.');
    } finally {
      setBusy(false);
    }
  };
  const togglePermission = async (permission: RolePermissionRecord, roleNumber: number) => {
    if (!window.ethereum) return;
    setBusy(true);
    setError('');
    try {
      const prepared = await prepareRolePermission({
        allowed: !permission.roles[String(roleNumber)],
        permission: permission.id,
        role: roleNumber,
      });
      if (BigInt(prepared.chainId) !== targetChainId)
        throw new Error('The API transaction targets a different chain.');
      const transaction = await sendPreparedTransaction(
        await new BrowserProvider(window.ethereum).getSigner(),
        prepared,
      );
      if (!(await transaction.wait()))
        throw new Error('The permission transaction was not confirmed.');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Permission update failed.');
    } finally {
      setBusy(false);
    }
  };
  const tabs = [
    { id: 'stakeholders' as const, label: 'Stakeholders', description: 'Manage members & roles' },
    { id: 'roles' as const, label: 'Role Permissions', description: 'Configure per-role access' },
    { id: 'matrix' as const, label: 'Permission Matrix', description: 'Full access overview' },
    {
      id: 'personal' as const,
      label: 'Individual Permissions',
      description: 'Exceptions for one company wallet',
    },
  ];
  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
        {tabs.map(({ id: value, label, description }) => (
          <button
            key={value}
            onClick={() => setTab(value)}
            style={{
              padding: '12px 20px',
              borderRadius: 8,
              border: `1px solid ${tab === value ? `color-mix(in srgb, ${T.teal} 31%, transparent)` : T.border}`,
              background: tab === value ? T.tealLight : T.surface,
              cursor: 'pointer',
              fontFamily: UI,
              textAlign: 'left',
              transition: 'all 0.15s',
            }}
          >
            <span
              style={{
                display: 'block',
                fontWeight: 600,
                fontSize: 13,
                color: tab === value ? T.teal : T.text,
              }}
            >
              {label}
            </span>
            <span style={{ display: 'block', color: T.text2, fontSize: 11, marginTop: 2 }}>
              {description}
            </span>
          </button>
        ))}
      </div>
      {tab === 'stakeholders' && (
        <StakeholderView
          records={records}
          loading={loading}
          error={error}
          reload={load}
          act={(record, nextAction) => {
            setSelected(record);
            setAction(nextAction);
          }}
        />
      )}
      {tab === 'roles' && (
        <RoleView
          records={records}
          permissions={permissions}
          busy={busy}
          toggle={togglePermission}
        />
      )}
      {tab === 'matrix' && <MatrixView permissions={permissions} />}
      {tab !== 'stakeholders' && error && <Alert type="error" message={error} />}
      {tab === 'personal' && <PersonalPermissions records={records} loadingRecords={loading} />}
      {selected && action && (
        <Modal
          title={`${capitalize(action)} stakeholder access`}
          onClose={() => {
            setSelected(null);
            setAction(null);
          }}
        >
          <div style={{ display: 'grid', gap: 12 }}>
            <Alert
              type={action === 'revoke' ? 'error' : action === 'suspend' ? 'warning' : 'info'}
              message={
                action === 'revoke'
                  ? 'Stakeholder revocation is permanent and removes the assigned role.'
                  : action === 'suspend'
                    ? 'Suspension immediately blocks this wallet from role-authorized operations.'
                    : 'Reactivation succeeds only while the linked credential is unexpired and valid.'
              }
            />
            {action !== 'reactivate' && (
              <Textarea
                label="Reason"
                value={reason}
                onChange={setReason}
                rows={3}
                placeholder="The reason is hashed before it is written on-chain."
              />
            )}
            {action === 'revoke' && (
              <label style={{ fontSize: 12 }}>
                <input
                  type="checkbox"
                  checked={confirm}
                  onChange={(event) => setConfirm(event.target.checked)}
                />{' '}
                I understand that stakeholder revocation is permanent.
              </label>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn
                variant="outline"
                onClick={() => {
                  setSelected(null);
                  setAction(null);
                }}
              >
                Cancel
              </Btn>
              <Btn
                variant={action === 'revoke' ? 'danger' : 'primary'}
                disabled={
                  busy ||
                  (action !== 'reactivate' && !reason.trim()) ||
                  (action === 'revoke' && !confirm)
                }
                onClick={() => void execute()}
              >
                {busy ? 'Waiting for MetaMask...' : `Confirm ${action}`}
              </Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function PersonalPermissions({
  records,
  loadingRecords,
}: {
  records: ChainCredential[];
  loadingRecords: boolean;
}) {
  const [account, setAccount] = useState('');
  const [permissions, setPermissions] = useState<PersonalPermissionRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState<{
    permission: PersonalPermissionRecord;
    setting: number;
  } | null>(null);
  const companies = [
    ...new Map(
      records
        .filter(
          (record) =>
            role(record.role) !== 'System Admin' &&
            ['active', 'suspended'].includes(record.stakeholderStatus),
        )
        .map((record) => [record.subject.toLowerCase(), record]),
    ).values(),
  ];
  useEffect(() => {
    let current = true;
    setPermissions([]);
    setError('');
    setNotice('');
    setPending(null);
    setLoading(Boolean(account));
    if (!account) return;
    getPersonalPermissions(account)
      .then((result) => {
        if (current) setPermissions(result.permissions);
      })
      .catch(() => {
        if (current)
          setError(
            'Individual permissions could not be read. Check the RPC connection and deploy the updated StakeholderRegistry before using this feature.',
          );
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [account]);
  const save = async () => {
    if (!pending || !account) return;
    setBusy(true);
    setError('');
    setNotice('');
    let confirmed = false;
    try {
      if (!window.ethereum) throw new Error('Connect MetaMask to update individual permissions.');
      const prepared = await preparePersonalPermission({
        account,
        permission: pending.permission.id,
        setting: pending.setting,
      });
      if (BigInt(prepared.chainId) !== targetChainId)
        throw new Error('The API transaction targets a different chain.');
      const transaction = await sendPreparedTransaction(
        await new BrowserProvider(window.ethereum).getSigner(),
        prepared,
      );
      const receipt = await transaction.wait();
      if (!receipt || receipt.status !== 1)
        throw new Error('The permission transaction was not confirmed.');
      confirmed = true;
      setPending(null);
      setNotice('Individual permission updated on-chain.');
      setPermissions((await getPersonalPermissions(account)).permissions);
    } catch (cause) {
      setError(
        confirmed
          ? 'The permission transaction is confirmed, but the refreshed state is unavailable. Re-select this company to refresh; do not resend the transaction.'
          : cause instanceof Error
            ? cause.message
            : 'Individual permission update failed.',
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <h3 style={{ color: T.navy }}>Individual company permissions</h3>
      <p style={{ color: T.text2 }}>
        Keep the role defaults and change access for one company wallet. Allow and Deny override the
        role default; Inherit follows future role changes to permissions. These settings cannot
        bypass role requirements, suspension, revocation or credential expiry.
      </p>
      <label htmlFor="personal-permission-company">Company wallet</label>
      <select
        id="personal-permission-company"
        value={account}
        disabled={busy || loadingRecords}
        onChange={(event) => setAccount(event.target.value)}
        style={{ display: 'block', width: '100%', padding: 10, margin: '8px 0 16px' }}
      >
        <option value="">Select a company</option>
        {companies.map((record) => (
          <option key={record.subject} value={record.subject}>
            {record.companyName || 'Company name unavailable'} · {role(record.role)} ·{' '}
            {record.subject}
          </option>
        ))}
      </select>
      {!loadingRecords && companies.length === 0 && (
        <p>No registered company wallets are available.</p>
      )}
      {error && <Alert type="error" message={error} />}
      {notice && <div role="status">{notice}</div>}
      {loading && <p role="status">Reading individual permissions from the blockchain...</p>}
      {!loading && permissions.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr>
                <th>Permission</th>
                <th>Role default</th>
                <th>Individual setting</th>
                <th>Effective access now</th>
              </tr>
            </thead>
            <tbody>
              {permissions.map((permission) => (
                <tr key={permission.id}>
                  <td style={{ padding: '14px 8px' }}>
                    {permissionLabels[permission.name] || permission.name}
                  </td>
                  <td>{permission.roleAllowed ? 'Allow' : 'Deny'}</td>
                  <td>
                    <select
                      aria-label={`Individual setting: ${permissionLabels[permission.name] || permission.name}`}
                      value={permission.setting}
                      disabled={busy}
                      onChange={(event) =>
                        setPending({ permission, setting: Number(event.target.value) })
                      }
                    >
                      <option value={0}>Inherit role</option>
                      <option value={1}>Allow</option>
                      <option value={2}>Deny</option>
                    </select>
                  </td>
                  <td>{permission.effective ? 'Allowed' : 'Denied'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pending && (
        <Modal
          title="Confirm individual permission"
          onClose={() => {
            if (!busy) setPending(null);
          }}
        >
          <p>
            {permissionLabels[pending.permission.name]}:{' '}
            {['Inherit role', 'Allow', 'Deny'][pending.setting]}
          </p>
          <p style={{ overflowWrap: 'anywhere' }}>Company wallet: {account}</p>
          <p>
            This changes only this wallet. MetaMask will ask you to sign an on-chain transaction.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn disabled={busy} onClick={() => setPending(null)}>
              Cancel
            </Btn>
            <Btn disabled={busy} onClick={() => void save()}>
              {busy ? 'Waiting for confirmation...' : 'Confirm permission'}
            </Btn>
          </div>
        </Modal>
      )}
    </Card>
  );
}

function StakeholderView({
  records,
  loading,
  error,
  reload,
  act,
}: {
  records: ChainCredential[];
  loading: boolean;
  error: string;
  reload: () => Promise<void>;
  act: (record: ChainCredential, action: 'reactivate' | 'revoke' | 'suspend') => void;
}) {
  const [filter, setFilter] = useState('all');
  const roleNames = ['Supplier', 'Manufacturer', 'Distributor', 'Retailer'];
  const filtered =
    filter === 'all'
      ? records
      : records.filter((record) => role(record.role).toLowerCase() === filter);
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 12 }}>
        {roleNames.map((name) => {
          const count = records.filter((record) => role(record.role) === name).length;
          const active = filter === name.toLowerCase();
          return (
            <Card
              key={name}
              onClick={() => setFilter(active ? 'all' : name.toLowerCase())}
              style={{
                padding: '16px 20px',
                cursor: 'pointer',
                borderColor: active ? roleColors[name] : T.border,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <div>
                  <div
                    style={{
                      fontSize: 10,
                      color: T.text2,
                      textTransform: 'uppercase',
                      letterSpacing: '0.08em',
                      marginBottom: 8,
                    }}
                  >
                    {name}s
                  </div>
                  <div style={{ fontSize: 28, fontWeight: 700, color: roleColors[name] }}>
                    {count}
                  </div>
                </div>
                <div
                  style={{ width: 8, height: 8, borderRadius: '50%', background: roleColors[name] }}
                />
              </div>
            </Card>
          );
        })}
      </div>
      <Card padding="0">
        <div
          style={{
            padding: '14px 20px',
            borderBottom: `1px solid ${T.border}`,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span style={{ fontWeight: 600, color: T.navy }}>
            Stakeholders{' '}
            <span style={{ color: T.text2, fontWeight: 400 }}>({filtered.length})</span>
          </span>
          <div
            style={{
              display: 'flex',
              background: T.surface2,
              border: `1px solid ${T.border}`,
              borderRadius: 6,
              overflow: 'hidden',
            }}
          >
            {['all', 'supplier', 'manufacturer', 'distributor', 'retailer'].map((value) => (
              <button
                key={value}
                onClick={() => setFilter(value)}
                style={{
                  padding: '6px 12px',
                  border: 0,
                  background: filter === value ? T.border2 : 'transparent',
                  color: filter === value ? T.navy : T.text2,
                  fontFamily: UI,
                  fontSize: 11,
                  textTransform: 'capitalize',
                  cursor: 'pointer',
                }}
              >
                {value}
              </button>
            ))}
          </div>
        </div>
        <div style={{ padding: '10px 20px 0' }}>
          <Alert
            type="warning"
            message="Lifecycle and permission changes are real smart-contract transactions and require System Admin confirmation in MetaMask."
          />
        </div>
        {error && (
          <div style={{ color: T.red, margin: 12, fontSize: 12 }}>
            {error}{' '}
            <Btn size="xs" variant="outline" onClick={() => void reload()}>
              Retry
            </Btn>
          </div>
        )}
        {!loading && filtered.length === 0 ? (
          <EmptyState
            icon={<ShieldCheck size={44} />}
            title="No registered stakeholders"
            sub="Approved companies appear here after credential registration."
          />
        ) : (
          <Table
            headers={['Stakeholder', 'Wallet', 'Role', 'Credential', 'Joined', 'Status', 'Actions']}
          >
            {filtered.map((record) => (
              <TR key={record.subject}>
                <TD bold>{record.companyName}</TD>
                <TD mono muted>
                  {short(record.subject)}
                </TD>
                <TD>
                  <span style={{ color: roleColors[role(record.role)] }}>{role(record.role)}</span>
                </TD>
                <TD mono muted>
                  {short(record.credentialId)}
                </TD>
                <TD muted>{new Date(record.issuedAt * 1_000).toLocaleDateString()}</TD>
                <TD>
                  <Badge
                    label={record.stakeholderStatus}
                    variant={
                      record.stakeholderStatus === 'active'
                        ? 'verified'
                        : record.stakeholderStatus === 'suspended'
                          ? 'pending'
                          : 'rejected'
                    }
                  />
                </TD>
                <TD>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {record.stakeholderStatus === 'active' && (
                      <Btn size="sm" variant="secondary" onClick={() => act(record, 'suspend')}>
                        Manage
                      </Btn>
                    )}
                    {record.stakeholderStatus === 'suspended' && (
                      <Btn size="sm" onClick={() => act(record, 'reactivate')}>
                        Reactivate
                      </Btn>
                    )}
                    {record.stakeholderStatus !== 'revoked' && (
                      <Btn size="sm" variant="danger" onClick={() => act(record, 'revoke')}>
                        Revoke
                      </Btn>
                    )}
                  </div>
                </TD>
              </TR>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

function RoleView({
  records,
  permissions,
  busy,
  toggle,
}: {
  records: ChainCredential[];
  permissions: RolePermissionRecord[];
  busy: boolean;
  toggle: (permission: RolePermissionRecord, role: number) => Promise<void>;
}) {
  const [selected, setSelected] = useState(0);
  const name = operationalRoles[selected];
  const roleNumber = selected + 2;
  const color = roleColors[name];
  const enabled = permissions.filter((permission) => permission.roles[String(roleNumber)]);
  const destinations: Record<string, string> = {
    Supplier: 'Manufacturer',
    Manufacturer: 'Distributor',
    Distributor: 'Retailer',
    Retailer: 'End of chain',
  };
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 20 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {operationalRoles.map((roleName, index) => {
          const count = records.filter(
            (item) => role(item.role) === roleName && item.stakeholderStatus === 'active',
          ).length;
          return (
            <button
              key={roleName}
              onClick={() => setSelected(index)}
              style={{
                padding: '14px 16px',
                borderRadius: 8,
                border: `1px solid ${selected === index ? `${roleColors[roleName]}60` : T.border}`,
                background: selected === index ? `${roleColors[roleName]}10` : T.surface,
                cursor: 'pointer',
                fontFamily: UI,
                textAlign: 'left',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span
                  style={{
                    fontWeight: 600,
                    color: selected === index ? roleColors[roleName] : T.text,
                  }}
                >
                  {roleName}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    color: T.text2,
                    background: T.surface2,
                    borderRadius: 10,
                    padding: '2px 8px',
                  }}
                >
                  {count}
                </span>
              </div>
              <div style={{ fontSize: 11, color: T.text2, marginTop: 4 }}>
                {permissions.filter((permission) => permission.roles[String(index + 2)]).length}{' '}
                permissions
              </div>
              <div style={{ fontSize: 10, color: roleColors[roleName], marginTop: 6 }}>
                {destinations[roleName] === 'End of chain'
                  ? 'End of chain'
                  : `→ ${destinations[roleName]}`}
              </div>
            </button>
          );
        })}
      </div>
      <Card style={{ padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color }}>{name}</div>
            <div style={{ fontSize: 12, color: T.text2, marginTop: 3 }}>
              {enabled.length} of {permissions.length} permissions enabled ·{' '}
              {
                records.filter(
                  (item) => role(item.role) === name && item.stakeholderStatus === 'active',
                ).length
              }{' '}
              active members
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: T.text2, textTransform: 'uppercase' }}>
              Transfers to
            </div>
            <div style={{ fontSize: 12, color, marginTop: 4 }}>{destinations[name]}</div>
          </div>
        </div>
        <div
          style={{
            fontSize: 11,
            color: T.text2,
            textTransform: 'uppercase',
            letterSpacing: '0.07em',
            marginBottom: 12,
          }}
        >
          Permissions
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          {permissions.map((permission) => {
            const allowed = permission.roles[String(roleNumber)];
            return (
              <div
                key={permission.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '12px 16px',
                  background: allowed ? `${color}08` : T.surface2,
                  border: `1px solid ${allowed ? `${color}30` : T.border}`,
                  borderRadius: 7,
                }}
              >
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: allowed ? T.text : T.text2 }}>
                    {permissionLabels[permission.name] ?? permission.name}
                  </div>
                  <div style={{ fontSize: 11, color: T.text2, marginTop: 2 }}>
                    Enforced by the deployed smart contracts
                  </div>
                </div>
                <button
                  disabled={busy}
                  onClick={() => void toggle(permission, roleNumber)}
                  style={{
                    width: 40,
                    height: 22,
                    borderRadius: 11,
                    border: 0,
                    cursor: busy ? 'wait' : 'pointer',
                    background: allowed ? color : T.border2,
                    position: 'relative',
                  }}
                >
                  <span
                    style={{
                      position: 'absolute',
                      top: 3,
                      left: allowed ? 21 : 3,
                      width: 16,
                      height: 16,
                      borderRadius: '50%',
                      background: '#fff',
                      boxShadow: '0 1px 3px #0006',
                    }}
                  />
                </button>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function MatrixView({ permissions }: { permissions: RolePermissionRecord[] }) {
  return (
    <Card style={{ overflow: 'hidden' }}>
      <div style={{ padding: '16px 20px', borderBottom: `1px solid ${T.border}` }}>
        <div style={{ fontWeight: 600, fontSize: 14, color: T.navy }}>Permission Matrix</div>
        <div style={{ fontSize: 12, color: T.text2, marginTop: 4 }}>
          Overview of which roles can perform each on-chain operation.
        </div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: T.surface2 }}>
              <th style={{ padding: '12px 20px', textAlign: 'left', minWidth: 220 }}>Permission</th>
              {operationalRoles.map((name) => (
                <th
                  key={name}
                  style={{
                    padding: '12px 16px',
                    color: roleColors[name],
                    textTransform: 'uppercase',
                    fontSize: 11,
                  }}
                >
                  {name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {permissions.map((permission) => (
              <tr key={permission.id} style={{ borderTop: `1px solid ${T.border}` }}>
                <td style={{ padding: '13px 20px' }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>
                    {permissionLabels[permission.name] ?? permission.name}
                  </div>
                  <div style={{ fontSize: 11, color: T.text2 }}>Smart-contract enforced</div>
                </td>
                {[2, 3, 4, 5].map((roleNumber, index) => (
                  <td key={roleNumber} style={{ padding: '13px 16px', textAlign: 'center' }}>
                    <span
                      style={{
                        color: permission.roles[String(roleNumber)]
                          ? roleColors[operationalRoles[index]]
                          : T.border2,
                        fontSize: 16,
                        fontWeight: 700,
                      }}
                    >
                      {permission.roles[String(roleNumber)] ? '✓' : '✕'}
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
function short(value: string) {
  return `${value.slice(0, 8)}...${value.slice(-5)}`;
}
function role(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function capitalize(value: string) {
  return `${value[0].toUpperCase()}${value.slice(1)}`;
}
