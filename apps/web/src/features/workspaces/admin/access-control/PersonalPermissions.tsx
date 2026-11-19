import { reportError } from '../../../../components/ui/feedback';
import { LoadingIndicator } from '../../../../components/ui/LoadingIndicator';
import { BrowserProvider } from 'ethers';
import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { targetChainId } from '../../../../config/chain';
import {
  getPersonalPermissions,
  preparePersonalPermission,
  sendPreparedTransaction,
  type ChainCredential,
  type PersonalPermissionRecord,
} from '../../../blockchain/blockchain.api';
import { Alert, Badge, Btn, Card, Modal } from '../../shared/ui';
export const permissionLabels: Record<string, string> = {
  REGISTER_INGREDIENT: 'Register ingredient batches',
  ISSUE_INGREDIENT_CREDENTIAL: 'Issue ingredient/evidence credentials',
  REQUEST_EVIDENCE: 'Request supplier evidence',
  REGISTER_PRODUCT: 'Register product batches',
  INITIATE_TRANSFER: 'Initiate permitted custody transfers',
  RECEIVE_TRANSFER: 'Receive intended custody transfers',
};
const settings = ['Inherit', 'Allow', 'Deny'];
export function PersonalPermissions({ company }: { company: ChainCredential }) {
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [permissions, setPermissions] = useState<PersonalPermissionRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [refreshNeeded, setRefreshNeeded] = useState(false);
  const [progress, setProgress] = useState('');
  const [pending, setPending] = useState<{
    permission: PersonalPermissionRecord;
    setting: number;
  } | null>(null);
  const previousAccount = useRef('');
  const lock = useRef(false);
  const requestVersion = useRef(0);
  const normalizedRole = company.role?.toUpperCase().replaceAll(' ', '_');
  const eligible =
    normalizedRole !== 'SYSTEM_ADMIN' &&
    ['active', 'suspended'].includes(company.stakeholderStatus);
  const account = eligible ? company.subject : '';
  const authorizationBlocked =
    company.status !== 'active' ||
    company.stakeholderStatus !== 'active' ||
    (company.expiresAt > 0 && company.expiresAt * 1000 <= Date.now());
  useEffect(() => {
    const version = ++requestVersion.current;
    let current = true;
    if (previousAccount.current !== account) {
      setPermissions([]);
      setNotice('');
      setPending(null);
      setRefreshNeeded(false);
      setProgress('');
      previousAccount.current = account;
    }
    setError('');
    setLoading(Boolean(account));
    if (!account) return;
    getPersonalPermissions(account)
      .then((result) => {
        if (current && version === requestVersion.current) {
          setPermissions(result.permissions);
          setRefreshNeeded(false);
        }
      })
      .catch(() => {
        if (current && version === requestVersion.current)
          setError(
            'Company permissions could not be loaded. Refresh to retry; check the API and RPC connection if this continues.',
          );
      })
      .finally(() => {
        if (current && version === requestVersion.current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [account, refreshVersion, company.updatedAt, company.stakeholderStatus, company.status]);
  const save = async () => {
    if (lock.current || !pending || !account) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    setProgress('Awaiting confirmation in MetaMask...');
    let confirmed = false;
    try {
      if (!window.ethereum) throw new Error('Connect MetaMask to update company permissions.');
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
      setProgress('Transaction submitted. Waiting for blockchain confirmation...');
      const receipt = await transaction.wait();
      if (!receipt || receipt.status !== 1)
        throw new Error('The permission transaction was not confirmed. Refresh before retrying.');
      confirmed = true;
      setPending(null);
      setProgress('');
      setNotice('Individual permission updated on-chain.');
      setRefreshNeeded(true);
      const result = await getPersonalPermissions(account);
      setPermissions(result.permissions);
      setRefreshNeeded(false);
    } catch (cause) {
      setProgress('');
      setError(
        confirmed
          ? 'The permission transaction is confirmed, but the refreshed state is unavailable. Use Refresh permissions; do not resend the transaction.'
          : reportError(cause, 'Company permission update failed. Refresh and try again.'),
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <Card className="admin-company-permissions">
      <header className="admin-company-section-heading">
        <div>
          <h2>Company permissions</h2>
          <p>Choose Inherit to follow role permissions, or set an individual override.</p>
        </div>
        {account && (
          <Btn
            size="sm"
            variant="outline"
            icon={<RefreshCw size={15} />}
            disabled={busy || loading}
            onClick={() => setRefreshVersion((value) => value + 1)}
          >
            {loading ? 'Refreshing...' : 'Refresh permissions'}
          </Btn>
        )}
      </header>
      {!eligible && (
        <p className="admin-company-note">
          Individual overrides apply to active or suspended company wallets. Admin authority and
          revoked records cannot be changed here.
        </p>
      )}
      {eligible && (
        <p className="admin-company-note">
          Each override requires its own MetaMask transaction.{' '}
          {authorizationBlocked
            ? 'Current company or credential status blocks authorization; an Allow override cannot bypass suspension, revocation or expiry.'
            : 'Allow does not bypass contract role requirements or credential validity checks.'}
        </p>
      )}
      {error && <Alert type="error" message={error} />}
      {notice && (
        <p role="status" className="admin-company-progress">
          {notice}
        </p>
      )}
      {loading && permissions.length === 0 && (
        <LoadingIndicator page label="Reading company permissions from the blockchain..." />
      )}
      {account && !loading && !error && permissions.length === 0 && (
        <p className="admin-company-note">
          No operational permissions were returned for this company.
        </p>
      )}
      {permissions.length > 0 && (
        <div
          className="admin-company-permission-scroll"
          role="region"
          aria-label="Company permission records"
          tabIndex={0}
          aria-busy={loading}
        >
          <table className="admin-company-permission-table">
            <caption className="sr-only">
              Persisted on-chain permissions for {company.companyName || 'this company'}. Each
              override requires a separate transaction.
            </caption>
            <colgroup>
              <col className="permission-name-column" />
              <col className="permission-default-column" />
              <col className="permission-override-column" />
              <col className="permission-effective-column" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Permission</th>
                <th scope="col">Role default</th>
                <th scope="col">Company override</th>
                <th scope="col">Effective access</th>
              </tr>
            </thead>
            <tbody>
              {permissions.map((permission) => {
                const label = permissionLabels[permission.name] || permission.name;
                const isPending = pending?.permission.id === permission.id;
                return (
                  <tr key={permission.id} aria-busy={isPending && busy}>
                    <th scope="row">
                      <span>{label}</span>
                      {permission.setting !== 0 && (
                        <span className="admin-company-override-indicator">
                          Individual override
                        </span>
                      )}
                    </th>
                    <td>
                      <span className="admin-company-default">
                        {permission.roleAllowed ? 'Allow' : 'Deny'}
                      </span>
                    </td>
                    <td>
                      <label className="sr-only" htmlFor={`company-permission-${permission.id}`}>
                        Company override: {label}
                      </label>
                      <select
                        id={`company-permission-${permission.id}`}
                        value={permission.setting}
                        disabled={busy || loading || refreshNeeded}
                        onChange={(event) => {
                          const setting = Number(event.target.value);
                          if (setting !== permission.setting) {
                            setError('');
                            setPending({ permission, setting });
                          }
                        }}
                      >
                        <option value={0}>Inherit</option>
                        <option value={1}>Allow</option>
                        <option value={2}>Deny</option>
                      </select>
                      {isPending && (
                        <span className="admin-company-row-pending" role="status">
                          {busy ? progress : `Pending: ${settings[pending.setting]} (not saved)`}
                        </span>
                      )}
                    </td>
                    <td>
                      <Badge
                        label={permission.effective ? 'Allowed' : 'Denied'}
                        variant={permission.effective ? 'active' : 'revoked'}
                      />
                      {permission.setting === 1 && !permission.effective && (
                        <small className="admin-company-access-note">
                          Allow is recorded; current authorization still blocks access.
                        </small>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {pending && (
        <Modal
          title="Confirm company permission"
          onClose={() => {
            if (!busy) setPending(null);
          }}
        >
          <div className="admin-company-confirmation">
            <p>
              Company: <strong>{company.companyName || 'Company name unavailable'}</strong>
            </p>
            <p>{permissionLabels[pending.permission.name] || pending.permission.name}</p>
            <dl className="admin-company-pending-values">
              <div>
                <dt>Saved override</dt>
                <dd>{settings[pending.permission.setting]}</dd>
              </div>
              <div>
                <dt>Requested override</dt>
                <dd>{settings[pending.setting]} (not saved)</dd>
              </div>
            </dl>
            <p className="admin-company-note">
              Only this company wallet changes. The saved override and effective access stay
              unchanged until the transaction confirms and the record is refreshed.
            </p>
            {progress && <p role="status">{progress}</p>}
            {error && <Alert type="error" message={error} />}
            <div className="action-row">
              <Btn variant="outline" disabled={busy} onClick={() => setPending(null)}>
                Cancel
              </Btn>
              <Btn disabled={busy} onClick={() => void save()}>
                {busy ? 'Waiting for confirmation...' : 'Confirm permission'}
              </Btn>
            </div>
          </div>
        </Modal>
      )}
    </Card>
  );
}
