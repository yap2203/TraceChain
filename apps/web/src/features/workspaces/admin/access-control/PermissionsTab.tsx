import { T, Badge, Card } from '../../shared/ui';
import { type Role, type RoleDefinition } from './types';
import { ALL_PERMISSIONS, ROLE_COLORS } from './fixtures';

export function PermissionsTab({ roleDefs }: { roleDefs: RoleDefinition[] }) {
  const roles: Role[] = ['Supplier', 'Manufacturer', 'Distributor', 'Retailer'];

  return (
    <Card style={{ overflow: 'hidden' }}>
      <div style={{ padding: '16px 20px', borderBottom: `1px solid ${T.border}` }}>
        <div style={{ fontWeight: 600, fontSize: 14, color: T.navy }}>Permission Matrix</div>
        <div style={{ fontSize: 12, color: T.text2, marginTop: 4 }}>
          Overview of which roles can perform which actions across the platform.
        </div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: T.surface2 }}>
                <th
                  style={{
                    padding: '12px 20px',
                    textAlign: 'left',
                    fontSize: 11,
                    color: T.text2,
                    fontWeight: 600,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    minWidth: 220,
                  }}
                >
                  Permission
                </th>
                {roles.map((r) => (
                  <th
                    key={r}
                    style={{
                      padding: '12px 16px',
                      textAlign: 'center',
                      fontSize: 11,
                      color: ROLE_COLORS[r],
                      fontWeight: 700,
                      letterSpacing: '0.04em',
                      textTransform: 'uppercase',
                    }}
                  >
                    {r}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ALL_PERMISSIONS.map((perm) => {
                const isAdminOnly = [
                  'issue_credential',
                  'revoke_credential',
                  'deploy_contract',
                  'manage_roles',
                ].includes(perm.id);
                return (
                  <tr
                    key={perm.id}
                    style={{
                      borderTop: `1px solid ${T.border}`,
                      background: isAdminOnly ? 'rgba(139,92,246,0.06)' : 'transparent',
                    }}
                  >
                    <td style={{ padding: '13px 20px' }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: T.text }}>
                        {perm.label}
                      </div>
                      <div style={{ fontSize: 11, color: T.text2, marginTop: 2 }}>
                        {perm.description}
                      </div>
                      {isAdminOnly && (
                        <div style={{ marginTop: 4 }}>
                          <Badge label="Admin only" variant="default" />
                        </div>
                      )}
                    </td>
                    {roles.map((r) => {
                      const def = roleDefs.find((d) => d.role === r)!;
                      const has = def.permissions.includes(perm.id);
                      return (
                        <td key={r} style={{ padding: '13px 16px', textAlign: 'center' }}>
                          {isAdminOnly ? (
                            <span style={{ color: T.text3, fontSize: 14 }}>—</span>
                          ) : has ? (
                            <span style={{ color: ROLE_COLORS[r], fontSize: 16, fontWeight: 700 }}>
                              ✓
                            </span>
                          ) : (
                            <span style={{ color: T.border2, fontSize: 16 }}>✕</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </Card>
  );
}
