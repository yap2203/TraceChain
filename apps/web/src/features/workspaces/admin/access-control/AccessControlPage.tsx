import { permissionLabels } from './PersonalPermissions';
import { reportError } from '../../../../components/ui/feedback';
import { LoadingIndicator } from '../../../../components/ui/LoadingIndicator';
import { BrowserProvider } from 'ethers';
import { useCallback, useEffect, useState } from 'react';
import { targetChainId } from '../../../../config/chain';
import {
  getCompanyCredentials,
  getRolePermissions,
  prepareRolePermission,
  sendPreparedTransaction,
  type ChainCredential,
  type RolePermissionRecord,
} from '../../../blockchain/blockchain.api';
import { Alert, Card, SectionTitle, T, UI } from '../../shared/ui';
type Tab = 'roles' | 'matrix';
const operationalRoles = ['Supplier', 'Manufacturer', 'Distributor', 'Retailer'] as const;
const roleColors: Record<string, string> = {
  Supplier: T.teal,
  Manufacturer: T.navy,
  // Fixed hues blended with the theme text colour so they stay readable in dark and light themes.
  Distributor: 'color-mix(in srgb, #0369A1 65%, var(--c-text))',
  Retailer: 'color-mix(in srgb, #7C3AED 65%, var(--c-text))',
};
export default function AccessControl({ section }: { section?: Tab } = {}) {
  const [tab, setTab] = useState<Tab>(section ?? 'roles');
  const [records, setRecords] = useState<ChainCredential[]>([]);
  const [permissions, setPermissions] = useState<RolePermissionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [companies, rolePermissions] = await Promise.all([
        getCompanyCredentials(),
        getRolePermissions(),
      ]);
      setRecords(companies.credentials);
      setPermissions(rolePermissions.permissions);
    } catch (cause) {
      setError(reportError(cause, 'Permission registry read failed.'));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
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
      setError(reportError(cause, 'Permission update failed.'));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingIndicator page label="Loading permissions..." />;
  const active = section ?? tab;
  return (
    <div>
      <SectionTitle
        title={active === 'roles' ? 'Role permissions' : 'Permission matrix'}
        sub={
          active === 'roles'
            ? 'Set the default permissions for each role.'
            : 'Compare the permissions available to each role.'
        }
      />
      {error && (
        <div className="mb-[16px]">
          <Alert type="error" message={error} />
        </div>
      )}
      {!section && (
        <nav className="workspace-choice-tabs" aria-label="Access control sections">
          <button aria-pressed={active === 'roles'} onClick={() => setTab('roles')}>
            Role permissions
          </button>
          <button aria-pressed={active === 'matrix'} onClick={() => setTab('matrix')}>
            Permission matrix
          </button>
        </nav>
      )}
      {active === 'roles' ? (
        <RoleView
          records={records}
          permissions={permissions}
          busy={busy}
          toggle={togglePermission}
        />
      ) : (
        <MatrixView permissions={permissions} />
      )}
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
                border: `1px solid ${selected === index ? `color-mix(in srgb, ${roleColors[roleName]} 38%, transparent)` : T.border}`,
                background:
                  selected === index
                    ? `color-mix(in srgb, ${roleColors[roleName]} 6%, transparent)`
                    : T.surface,
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
                    fontSize: 12,
                    color: T.text2,
                    background: T.surface2,
                    borderRadius: 10,
                    padding: '2px 8px',
                  }}
                >
                  {count}
                </span>
              </div>
              <div style={{ fontSize: 12, color: T.text2, marginTop: 4 }}>
                {permissions.filter((permission) => permission.roles[String(index + 2)]).length}{' '}
                permissions
              </div>
              <div style={{ fontSize: 11, color: roleColors[roleName], marginTop: 6 }}>
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
            <div style={{ fontSize: 11, color: T.text2, textTransform: 'uppercase' }}>
              Transfers to
            </div>
            <div style={{ fontSize: 12, color, marginTop: 4 }}>{destinations[name]}</div>
          </div>
        </div>
        <div
          style={{
            fontSize: 12,
            color: T.text2,
            textTransform: 'uppercase',
            letterSpacing: '0.07em',
            marginBottom: 12,
          }}
        >
          Permissions
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          {permissions.length === 0 && (
            <p style={{ margin: 0, fontSize: 13, color: T.text2 }}>
              No permissions are available to configure yet.
            </p>
          )}
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
                  background: allowed ? `color-mix(in srgb, ${color} 3%, transparent)` : T.surface2,
                  border: `1px solid ${allowed ? `color-mix(in srgb, ${color} 19%, transparent)` : T.border}`,
                  borderRadius: 7,
                }}
              >
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: allowed ? T.text : T.text2 }}>
                    {permissionLabels[permission.name] ?? permission.name}
                  </div>
                  <div style={{ fontSize: 12, color: T.text2, marginTop: 2 }}>
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
        <div style={{ fontWeight: 600, fontSize: 14, color: T.navy }}>Permissions by role</div>
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
                    fontSize: 12,
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
                  <div style={{ fontSize: 12, color: T.text2 }}>Smart-contract enforced</div>
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
function role(value: string) {
  return value
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
