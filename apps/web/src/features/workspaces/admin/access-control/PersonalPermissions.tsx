import { reportError } from '../../../../components/ui/feedback';
import { LoadingIndicator } from '../../../../components/ui/LoadingIndicator';
import { BrowserProvider } from 'ethers';
import { useEffect, useState } from 'react';
import { targetChainId } from '../../../../config/chain';
import {
  getPersonalPermissions,
  preparePersonalPermission,
  sendPreparedTransaction,
  type ChainCredential,
  type PersonalPermissionRecord,
} from '../../../blockchain/blockchain.api';
import { Alert, Btn, Card, Modal, T } from '../../shared/ui';
export const permissionLabels: Record<string, string> = {
  REGISTER_INGREDIENT: 'Register ingredient batches',
  ISSUE_INGREDIENT_CREDENTIAL: 'Issue ingredient/evidence credentials',
  REQUEST_EVIDENCE: 'Request supplier evidence',
  REGISTER_PRODUCT: 'Register product batches',
  INITIATE_TRANSFER: 'Initiate permitted custody transfers',
  RECEIVE_TRANSFER: 'Receive intended custody transfers',
};
function role(value: string) {
  return value
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
export function PersonalPermissions({ company }: { company: ChainCredential }) {
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [permissions, setPermissions] = useState<PersonalPermissionRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState<{
    permission: PersonalPermissionRecord;
    setting: number;
  } | null>(null);
  const eligible =
    role(company.role) !== 'System Admin' &&
    ['active', 'suspended'].includes(company.stakeholderStatus);
  const account = eligible ? company.subject : '';
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
  }, [account, refreshVersion]);
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
          ? 'The permission transaction is confirmed, but the refreshed state is unavailable. Use Refresh permissions; do not resend the transaction.'
          : reportError(cause, 'Individual permission update failed.'),
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
      <p style={{ overflowWrap: 'anywhere' }}>
        Company wallet: <code>{company.subject}</code>
      </p>
      {!eligible && (
        <p>
          Individual overrides apply to active or suspended company wallets. Admin authority and
          revoked records cannot be changed here.
        </p>
      )}
      {account && (
        <Btn
          variant="outline"
          disabled={busy || loading}
          onClick={() => setRefreshVersion((value) => value + 1)}
        >
          Refresh permissions
        </Btn>
      )}
      {error && <Alert type="error" message={error} />}
      {notice && <div role="status">{notice}</div>}
      {loading && (
        <LoadingIndicator page label="Reading individual permissions from the blockchain..." />
      )}
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
          <div className="action-row">
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
