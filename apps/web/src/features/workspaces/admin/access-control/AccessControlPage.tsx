import { useState } from 'react';
import { UsersRound, ShieldCheck, TableProperties, type LucideIcon } from 'lucide-react';
import { T, UI } from '../../shared/ui';
import { type Role, type Tab, type RoleDefinition, type Stakeholder } from './types';
import { INITIAL_ROLE_DEFS, INITIAL_STAKEHOLDERS } from './fixtures';
import { StakeholdersTab } from './StakeholdersTab';
import { ManageRolePanel } from './ManageRolePanel';
import { RolesTab } from './RolesTab';
import { PermissionsTab } from './PermissionsTab';

export default function AccessControl() {
  const [tab, setTab] = useState<Tab>('stakeholders');
  const [stakeholders, setStakeholders] = useState<Stakeholder[]>(INITIAL_STAKEHOLDERS);
  const [roleDefs, setRoleDefs] = useState<RoleDefinition[]>(INITIAL_ROLE_DEFS);
  const [managing, setManaging] = useState<Stakeholder | null>(null);

  const handleRoleChange = (wallet: string, newRole: Role) => {
    setStakeholders((prev) => prev.map((s) => (s.wallet === wallet ? { ...s, role: newRole } : s)));
  };

  const togglePermission = (role: Role, permId: string) => {
    setRoleDefs((prev) =>
      prev.map((d) => {
        if (d.role !== role) return d;
        const has = d.permissions.includes(permId);
        return {
          ...d,
          permissions: has ? d.permissions.filter((p) => p !== permId) : [...d.permissions, permId],
        };
      }),
    );
  };

  const TAB_LABELS: { id: Tab; label: string; desc: string; Icon: LucideIcon }[] = [
    { id: 'stakeholders', label: 'Stakeholders', desc: 'Manage members & roles', Icon: UsersRound },
    {
      id: 'roles',
      label: 'Role Permissions',
      desc: 'Configure per-role access',
      Icon: ShieldCheck,
    },
    {
      id: 'permissions',
      label: 'Permission Matrix',
      desc: 'Full access overview',
      Icon: TableProperties,
    },
  ];

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {TAB_LABELS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: '12px 20px',
              borderRadius: 8,
              border: `1px solid ${tab === t.id ? `color-mix(in srgb, ${T.teal} 31%, transparent)` : T.border}`,
              background: tab === t.id ? T.tealLight : T.surface,
              cursor: 'pointer',
              fontFamily: UI,
              textAlign: 'left',
              transition: 'all 0.15s',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontWeight: 600,
                fontSize: 13,
                color: tab === t.id ? T.teal : T.text,
              }}
            >
              <t.Icon aria-hidden="true" size={17} strokeWidth={1.8} />
              {t.label}
            </div>
            <div style={{ fontSize: 11, color: T.text2, marginTop: 2 }}>{t.desc}</div>
          </button>
        ))}
      </div>

      {tab === 'stakeholders' && (
        <StakeholdersTab stakeholders={stakeholders} onManage={setManaging} />
      )}
      {tab === 'roles' && <RolesTab roleDefs={roleDefs} onTogglePermission={togglePermission} />}
      {tab === 'permissions' && <PermissionsTab roleDefs={roleDefs} />}

      {managing && (
        <ManageRolePanel
          stakeholder={managing}
          onClose={() => setManaging(null)}
          onSave={handleRoleChange}
        />
      )}
    </div>
  );
}
