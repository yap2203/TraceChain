import { useState } from 'react';
import { T, MONO, UI, Btn, Alert, TxModal } from '../../shared/ui';
import { type Role, type Stakeholder } from './types';
import { ROLE_COLORS } from './fixtures';

export function ManageRolePanel({
  stakeholder,
  onClose,
  onSave,
}: {
  stakeholder: Stakeholder;
  onClose: () => void;
  onSave: (wallet: string, newRole: Role) => void;
}) {
  const [newRole, setNewRole] = useState<Role>(stakeholder.role);
  const [txState, setTx] = useState<'pending' | 'confirmed' | 'failed' | null>(null);
  const changed = newRole !== stakeholder.role;

  const save = () => {
    setTx('pending');
    setTimeout(() => setTx('confirmed'), 3000);
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: '#00000060',
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          background: T.surface,
          border: `1px solid ${T.border}`,
          borderRadius: 12,
          width: 500,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '20px 24px',
            borderBottom: `1px solid ${T.border}`,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: T.navy }}>Manage Role</div>
            <div style={{ fontSize: 12, color: T.text2, marginTop: 3 }}>{stakeholder.company}</div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: T.text2,
              cursor: 'pointer',
              fontSize: 18,
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ padding: 24, display: 'grid', gap: 18 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div style={{ background: T.surface2, borderRadius: 7, padding: '12px 14px' }}>
              <div
                style={{
                  fontSize: 10,
                  color: T.text2,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  marginBottom: 5,
                }}
              >
                Wallet
              </div>
              <div style={{ fontFamily: MONO, fontSize: 11, color: T.teal }}>
                {stakeholder.wallet.slice(0, 10) + '…' + stakeholder.wallet.slice(-6)}
              </div>
            </div>
            <div style={{ background: T.surface2, borderRadius: 7, padding: '12px 14px' }}>
              <div
                style={{
                  fontSize: 10,
                  color: T.text2,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  marginBottom: 5,
                }}
              >
                Current Role
              </div>
              <div style={{ fontSize: 13, color: ROLE_COLORS[stakeholder.role], fontWeight: 600 }}>
                {stakeholder.role}
              </div>
            </div>
          </div>

          <div>
            <div style={{ fontSize: 12, color: T.text2, fontWeight: 500, marginBottom: 8 }}>
              Assign New Role
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8 }}>
              {(['Supplier', 'Manufacturer', 'Distributor', 'Retailer'] as Role[]).map((r) => (
                <button
                  key={r}
                  onClick={() => setNewRole(r)}
                  style={{
                    padding: '12px 16px',
                    border: `1px solid ${newRole === r ? ROLE_COLORS[r] + '80' : T.border}`,
                    borderRadius: 7,
                    cursor: 'pointer',
                    fontFamily: UI,
                    textAlign: 'left',
                    background: newRole === r ? `${ROLE_COLORS[r]}12` : T.surface2,
                    transition: 'all 0.15s',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: newRole === r ? ROLE_COLORS[r] : T.text,
                      }}
                    >
                      {r}
                    </span>
                    {newRole === r && (
                      <span style={{ color: ROLE_COLORS[r], fontSize: 14 }}>✓</span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: T.text2, marginTop: 3 }}>
                    {r === 'Supplier' && 'Stage 1 — Register products'}
                    {r === 'Manufacturer' && 'Stage 2 — Process materials'}
                    {r === 'Distributor' && 'Stage 3 — Ship products'}
                    {r === 'Retailer' && 'Stage 4 — Final receipt'}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {changed && (
            <Alert
              type="warning"
              message={`Changing role from ${stakeholder.role} to ${newRole} re-issues the credential on-chain. This action is irreversible.`}
            />
          )}

          <div style={{ display: 'flex', gap: 10 }}>
            <Btn onClick={onClose} variant="ghost" size="md" style={{ flex: 1 }}>
              Cancel
            </Btn>
            <Btn onClick={save} size="md" disabled={!changed} style={{ flex: 2 }}>
              {changed ? `Reassign to ${newRole}` : 'No Changes'}
            </Btn>
          </div>
        </div>
      </div>

      <TxModal
        state={txState}
        title="Reassigning Role"
        message={`${stakeholder.company} has been reassigned to ${newRole}. A new credential has been issued.`}
        onClose={() => {
          setTx(null);
          onSave(stakeholder.wallet, newRole);
          onClose();
        }}
      />
    </div>
  );
}
