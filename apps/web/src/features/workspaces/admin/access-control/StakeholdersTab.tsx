import { useState } from 'react';
import { T, MONO, UI, Badge, Btn, Card, Alert, TxModal } from '../../shared/ui';
import { type Role, type Stakeholder } from './types';
import { ROLE_COLORS } from './fixtures';

export function StakeholdersTab({
  stakeholders,
  onManage,
}: {
  stakeholders: Stakeholder[];
  onManage: (s: Stakeholder) => void;
}) {
  const [roleFilter, setRoleFilter] = useState('all');
  const [txState, setTx] = useState<'pending' | 'confirmed' | 'failed' | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<string | null>(null);

  const filtered =
    roleFilter === 'all'
      ? stakeholders
      : stakeholders.filter((s) => s.role.toLowerCase() === roleFilter);
  const counts = { Supplier: 0, Manufacturer: 0, Distributor: 0, Retailer: 0 };
  stakeholders.forEach((s) => {
    counts[s.role]++;
  });

  const revoke = (company: string) => {
    setPendingRevoke(company);
    setTx('pending');
    setTimeout(() => setTx('confirmed'), 2500);
  };

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
        {(Object.entries(counts) as [Role, number][]).map(([role, count]) => (
          <Card
            key={role}
            onClick={() =>
              setRoleFilter(roleFilter === role.toLowerCase() ? 'all' : role.toLowerCase())
            }
            style={{
              padding: '16px 20px',
              cursor: 'pointer',
              transition: 'border-color 0.2s',
              borderColor: roleFilter === role.toLowerCase() ? ROLE_COLORS[role] : T.border,
            }}
          >
            <div
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}
            >
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
                  {role}s
                </div>
                <div style={{ fontSize: 28, fontWeight: 700, color: ROLE_COLORS[role] }}>
                  {count}
                </div>
              </div>
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: ROLE_COLORS[role],
                  marginTop: 4,
                }}
              />
            </div>
          </Card>
        ))}
      </div>

      <Card>
        <div
          style={{
            padding: '14px 20px',
            borderBottom: `1px solid ${T.border}`,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span style={{ fontWeight: 600, fontSize: 14, color: T.navy }}>
            Stakeholders{' '}
            <span style={{ color: T.text2, fontWeight: 400 }}>({filtered.length})</span>
          </span>
          <div
            style={{
              display: 'flex',
              gap: 0,
              background: T.surface2,
              borderRadius: 6,
              overflow: 'hidden',
              border: `1px solid ${T.border}`,
            }}
          >
            {['all', 'supplier', 'manufacturer', 'distributor', 'retailer'].map((f) => (
              <button
                key={f}
                onClick={() => setRoleFilter(f)}
                style={{
                  padding: '6px 12px',
                  fontSize: 11,
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: UI,
                  background: roleFilter === f ? T.border2 : 'transparent',
                  color: roleFilter === f ? T.navy : T.text2,
                  textTransform: 'capitalize',
                }}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        <div style={{ padding: '10px 20px 0' }}>
          <Alert
            type="warning"
            message="Role changes and revocations write to the smart contract and are irreversible once confirmed."
          />
        </div>

        <div style={{ overflowX: 'auto' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: T.surface2 }}>
                  {[
                    'Stakeholder',
                    'Wallet',
                    'Role',
                    'Credential',
                    'Joined',
                    'Status',
                    'Actions',
                  ].map((h) => (
                    <th
                      key={h}
                      style={{
                        padding: '10px 18px',
                        textAlign: 'left',
                        fontSize: 10,
                        color: T.text2,
                        fontWeight: 600,
                        letterSpacing: '0.06em',
                        textTransform: 'uppercase',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr
                    key={s.wallet}
                    style={{ borderTop: `1px solid ${T.border}`, transition: 'background 0.15s' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = T.surface2)}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <td style={{ padding: '13px 18px' }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: T.text }}>
                        {s.company}
                      </div>
                    </td>
                    <td style={{ padding: '13px 18px' }}>
                      <span style={{ fontFamily: MONO, fontSize: 11, color: T.teal }}>
                        {s.wallet.slice(0, 8) + '…' + s.wallet.slice(-4)}
                      </span>
                    </td>
                    <td style={{ padding: '13px 18px' }}>
                      <span style={{ fontSize: 12, color: ROLE_COLORS[s.role], fontWeight: 500 }}>
                        {s.role}
                      </span>
                    </td>
                    <td
                      style={{
                        padding: '13px 18px',
                        fontFamily: MONO,
                        fontSize: 11,
                        color: T.text2,
                      }}
                    >
                      {s.cred}
                    </td>
                    <td style={{ padding: '13px 18px', fontSize: 12, color: T.text2 }}>
                      {s.joined}
                    </td>
                    <td style={{ padding: '13px 18px' }}>
                      <Badge
                        label={s.status}
                        variant={
                          s.status === 'verified'
                            ? 'verified'
                            : s.status === 'suspended'
                              ? 'pending'
                              : 'rejected'
                        }
                      />
                    </td>
                    <td style={{ padding: '13px 18px' }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <Btn onClick={() => onManage(s)} variant="secondary" size="sm">
                          Manage
                        </Btn>
                        <Btn onClick={() => revoke(s.company)} variant="danger" size="sm">
                          Revoke
                        </Btn>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Card>

      <TxModal
        state={txState}
        title={`Revoking: ${pendingRevoke}`}
        message={`Credential for ${pendingRevoke} has been revoked on-chain.`}
        onClose={() => {
          setTx(null);
          setPendingRevoke(null);
        }}
      />
    </div>
  );
}
