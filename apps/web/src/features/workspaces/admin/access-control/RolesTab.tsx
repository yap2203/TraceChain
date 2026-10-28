import { useState } from 'react';
import { T, UI, Badge, Card } from '../../shared/ui';
import { type Role, type RoleDefinition } from './types';
import { ALL_PERMISSIONS } from './fixtures';

export function RolesTab({
  roleDefs,
  onTogglePermission,
}: {
  roleDefs: RoleDefinition[];
  onTogglePermission: (role: Role, permId: string) => void;
}) {
  const [selectedRole, setSelectedRole] = useState<Role>('Supplier');
  const def = roleDefs.find((r) => r.role === selectedRole)!;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 20 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {roleDefs.map((r) => (
          <button
            key={r.role}
            onClick={() => setSelectedRole(r.role)}
            style={{
              padding: '14px 16px',
              borderRadius: 8,
              border: `1px solid ${selectedRole === r.role ? r.color + '60' : T.border}`,
              background: selectedRole === r.role ? `${r.color}10` : T.surface,
              cursor: 'pointer',
              fontFamily: UI,
              textAlign: 'left',
              transition: 'all 0.15s',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span
                style={{
                  fontWeight: 600,
                  fontSize: 13,
                  color: selectedRole === r.role ? r.color : T.text,
                }}
              >
                {r.role}
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
                {r.count}
              </span>
            </div>
            <div style={{ fontSize: 11, color: T.text2, marginTop: 4 }}>
              {r.permissions.length} permissions
            </div>
            {r.canTransferTo.length > 0 && (
              <div style={{ fontSize: 10, color: r.color, marginTop: 6 }}>
                → {r.canTransferTo.join(', ')}
              </div>
            )}
          </button>
        ))}
      </div>

      <Card style={{ padding: 24 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: 20,
          }}
        >
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: def.color }}>{def.role}</div>
            <div style={{ fontSize: 12, color: T.text2, marginTop: 3 }}>
              {def.permissions.length} of {ALL_PERMISSIONS.length} permissions enabled · {def.count}{' '}
              active members
            </div>
          </div>
          <div>
            <div
              style={{
                fontSize: 10,
                color: T.text2,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                marginBottom: 4,
              }}
            >
              Transfers to
            </div>
            {def.canTransferTo.length > 0 ? (
              def.canTransferTo.map((r) => <Badge key={r} label={r} variant="accepted" />)
            ) : (
              <span style={{ fontSize: 12, color: T.text2 }}>End of chain</span>
            )}
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
          {ALL_PERMISSIONS.map((perm) => {
            const enabled = def.permissions.includes(perm.id);
            return (
              <div
                key={perm.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '12px 16px',
                  background: enabled ? `${def.color}08` : T.surface2,
                  border: `1px solid ${enabled ? def.color + '30' : T.border}`,
                  borderRadius: 7,
                  transition: 'all 0.2s',
                }}
              >
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: enabled ? T.text : T.text2 }}>
                    {perm.label}
                  </div>
                  <div style={{ fontSize: 11, color: T.text2, marginTop: 2 }}>
                    {perm.description}
                  </div>
                </div>
                <button
                  onClick={() => onTogglePermission(def.role, perm.id)}
                  style={{
                    width: 40,
                    height: 22,
                    borderRadius: 11,
                    border: 'none',
                    cursor: 'pointer',
                    background: enabled ? def.color : T.border2,
                    position: 'relative',
                    transition: 'background 0.2s',
                    flexShrink: 0,
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      top: 3,
                      left: enabled ? 21 : 3,
                      width: 16,
                      height: 16,
                      borderRadius: '50%',
                      background: '#fff',
                      transition: 'left 0.2s',
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
