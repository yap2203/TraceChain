import './company-detail.css';
import { BackNavigation } from '../../../../components/ui/BackNavigation';
import { PersonalPermissions } from '../access-control/PersonalPermissions';
import { notify, reportError } from '../../../../components/ui/feedback';
import { BrowserProvider, id } from 'ethers';
import { useRef, useState } from 'react';
import { Copy, Download, Pause, Play, RefreshCw, ShieldOff } from 'lucide-react';
import { CompanyAvatar } from '../../../orders/CatalogueMedia';
import { targetChainId } from '../../../../config/chain';
import { getAuthSession } from '../../../auth/auth.api';
import {
  prepareCredentialLifecycle,
  getCompanyCredentials,
  prepareStakeholderLifecycle,
  sendPreparedTransaction,
  type ChainCredential,
} from '../../../blockchain/blockchain.api';
import { Alert, Badge, Btn, Card, Modal, Textarea } from '../../shared/ui';

export function CredDetail({
  cred,
  onBack,
  onChanged,
  refreshing = false,
  refreshError = '',
}: {
  cred: ChainCredential;
  onBack: () => void;
  onChanged: () => Promise<ChainCredential | void>;
  refreshing?: boolean;
  refreshError?: string;
}) {
  const [action, setAction] = useState<'reactivate' | 'revoke' | 'suspend' | null>(null);
  const [actionTarget, setActionTarget] = useState<'credential' | 'company access'>('credential');
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [phase, setPhase] = useState<
    'idle' | 'wallet' | 'submitted' | 'reading' | 'confirmed' | 'failed'
  >('idle');
  const [error, setError] = useState('');
  const [refreshNeeded, setRefreshNeeded] = useState(false);
  const lock = useRef(false);
  const expectedState = useRef<{
    target: typeof actionTarget;
    status: ChainCredential['status'];
  } | null>(null);
  const busy =
    phase === 'wallet' || (phase === 'submitted' && !refreshNeeded) || phase === 'reading';
  const company = cred.companyName?.trim() || 'Company name unavailable';
  const expired = cred.expiresAt > 0 && cred.expiresAt * 1000 <= Date.now();
  const technical = [
    ['Credential ID', cred.credentialId],
    ['Credential hash', cred.credentialHash],
    ['Encrypted IPFS CID', cred.encryptedCredentialCid],
    ['Application ID', cred.applicationId],
  ];
  const chooseAction = (
    next: NonNullable<typeof action>,
    target: typeof actionTarget = 'credential',
  ) => {
    setReason('');
    setConfirmed(false);
    setError('');
    setPhase('idle');
    setAction(next);
    setActionTarget(target);
  };
  const close = () => {
    if (!lock.current) {
      setAction(null);
      setReason('');
      setConfirmed(false);
    }
  };
  const readResult = async () => {
    const record = await onChanged();
    if (expectedState.current) {
      const expected = expectedState.current;
      if (
        !record ||
        record.credentialId !== cred.credentialId ||
        record.subject.toLowerCase() !== cred.subject.toLowerCase() ||
        (expected.target === 'credential' ? record.status : record.stakeholderStatus) !==
          expected.status
      )
        throw new Error(
          'The refreshed chain state does not yet show this change. Refresh the record; do not resend the transaction.',
        );
      expectedState.current = null;
      setPhase('confirmed');
      notify(
        expected.target === 'credential'
          ? 'Credential change confirmed on-chain.'
          : 'Company access change confirmed on-chain.',
        'success',
      );
    }
    setRefreshNeeded(false);
  };
  const execute = async () => {
    if (lock.current || !action) return;
    if (reason.length > 4000) {
      setError('Reason must be 4000 characters or fewer.');
      return;
    }
    if (action !== 'reactivate' && !reason.trim()) {
      setError('Enter a reason before confirming.');
      return;
    }
    if (action === 'revoke' && !confirmed) {
      setError('Confirm that revocation is permanent.');
      return;
    }
    if (!window.ethereum) {
      setError('Open MetaMask and connect the authorized Admin wallet, then retry.');
      return;
    }
    lock.current = true;
    setPhase('wallet');
    setError('');
    let mined = false;
    try {
      const session = await getAuthSession();
      if (!session.authenticated || !session.authorizationReady || session.role !== 'SYSTEM_ADMIN')
        throw new Error('Sign in with the currently authorized Admin wallet before retrying.');
      const signer = await new BrowserProvider(window.ethereum).getSigner();
      if ((await signer.getAddress()).toLowerCase() !== session.address.toLowerCase())
        throw new Error(
          'The connected wallet changed. Reconnect the signed-in Admin wallet and review this action again.',
        );
      const current = (await getCompanyCredentials()).credentials.find(
        (record) => record.credentialId === cred.credentialId,
      );
      if (
        !current ||
        ['status', 'stakeholderStatus', 'credentialHash', 'updatedAt', 'stakeholderUpdatedAt'].some(
          (field) =>
            current[field as keyof ChainCredential] !== cred[field as keyof ChainCredential],
        )
      )
        throw new Error(
          'This company record changed. Refresh the record and review the action again.',
        );
      const reasonHash = action === 'reactivate' ? undefined : id(reason.trim());
      const prepared =
        actionTarget === 'credential'
          ? await prepareCredentialLifecycle({
              action,
              credentialId: cred.credentialId,
              reasonHash,
            })
          : await prepareStakeholderLifecycle({ account: cred.subject, action, reasonHash });
      if (BigInt(prepared.chainId) !== targetChainId)
        throw new Error('The API transaction targets a different chain.');
      const accounts = (await window.ethereum.request({ method: 'eth_accounts' })) as string[];
      if (accounts[0]?.toLowerCase() !== session.address.toLowerCase())
        throw new Error(
          'The connected wallet changed. Reconnect the signed-in Admin wallet and review this action again.',
        );
      const transaction = await sendPreparedTransaction(signer, prepared);
      setPhase('submitted');
      const receipt = await transaction.wait();
      if (!receipt || receipt.status !== 1)
        throw new Error('The transaction failed. Refresh the record before retrying.');
      mined = true;
      setPhase('reading');
      expectedState.current = {
        target: actionTarget,
        status: action === 'suspend' ? 'suspended' : action === 'revoke' ? 'revoked' : 'active',
      };
      setRefreshNeeded(true);
      setAction(null);
      setReason('');
      setConfirmed(false);
      await readResult();
    } catch (cause) {
      if (!mined) setPhase('failed');
      else setPhase('submitted');
      setError(
        mined
          ? 'The transaction is confirmed, but the record could not be refreshed. Refresh the record; do not resend the transaction.'
          : reportError(
              cause,
              'Company management change failed. Refresh the record and try again.',
            ),
      );
    } finally {
      lock.current = false;
    }
  };
  const refresh = async () => {
    try {
      await readResult();
      setError('');
    } catch (cause) {
      setError(reportError(cause, 'The record could not be refreshed. Please retry.'));
    }
  };
  const manageable = ['active', 'suspended'].includes(cred.status);
  return (
    <div className="admin-company-detail">
      <BackNavigation onClick={onBack}>Back to Manage companies</BackNavigation>
      <header className="admin-company-header">
        <CompanyAvatar
          name={company}
          logoPath={
            /^0x[0-9a-f]{64}$/i.test(cred.applicationId ?? '')
              ? `/api/blockchain/applications/${cred.applicationId}/logo`
              : undefined
          }
          size="lg"
        />
        <div className="admin-company-header__identity">
          <div className="admin-company-header__title">
            <h1>{company}</h1>
            <Badge
              label={`Company: ${titleCase(cred.stakeholderStatus || 'unknown')}`}
              variant={cred.stakeholderStatus === 'unknown' ? 'default' : cred.stakeholderStatus}
            />
          </div>
          <p>
            {displayRole(cred.role)} <span aria-hidden="true">/</span> Registration:{' '}
            {cred.companyRegistrationNumber || 'Unavailable'}
          </p>
        </div>
      </header>
      <div className="admin-company-toolbar action-row">
        <Btn
          variant="outline"
          size="sm"
          icon={<RefreshCw size={15} />}
          disabled={busy || refreshing}
          onClick={() => void refresh()}
        >
          {refreshing ? 'Refreshing record...' : 'Refresh record'}
        </Btn>
        <Btn
          variant="outline"
          size="sm"
          icon={<Copy size={15} />}
          disabled={!cred.credentialId}
          onClick={() => void copyValue('Credential ID', cred.credentialId)}
        >
          Copy credential ID
        </Btn>
        <Btn
          variant="outline"
          size="sm"
          icon={<Download size={15} />}
          onClick={() => downloadSummary(cred)}
        >
          Download summary
        </Btn>
      </div>
      {(error || refreshError) && <Alert type="error" message={error || refreshError} />}
      {phase !== 'idle' && (
        <p className="admin-company-progress" role="status">
          {phase === 'wallet'
            ? 'Awaiting confirmation in MetaMask...'
            : phase === 'submitted'
              ? refreshNeeded
                ? 'Transaction mined. Refresh the record to read the resulting chain state.'
                : 'Transaction submitted. Waiting for blockchain confirmation...'
              : phase === 'reading'
                ? 'Transaction mined. Reading the resulting chain state...'
                : phase === 'confirmed'
                  ? 'Transaction confirmed on-chain.'
                  : 'Transaction failed or was cancelled. The confirmed record is unchanged.'}
        </p>
      )}
      <Card className="admin-company-identity">
        <h2>Company identity</h2>
        <dl className="admin-company-facts">
          <div>
            <dt>Company registration number</dt>
            <dd>{cred.companyRegistrationNumber || 'Unavailable'}</dd>
          </div>
          <div>
            <dt>Approved role</dt>
            <dd>{displayRole(cred.role)}</dd>
          </div>
          <div>
            <dt>Associated wallet</dt>
            <dd>
              <Identifier label="Associated wallet" value={cred.subject} shorten />
            </dd>
          </div>
          <div>
            <dt>Issuer wallet</dt>
            <dd>
              <Identifier label="Issuer wallet" value={cred.issuer} shorten />
            </dd>
          </div>
          <div>
            <dt>Issue date</dt>
            <dd>{formatDate(cred.issuedAt)}</dd>
          </div>
          <div>
            <dt>Expiry date</dt>
            <dd>{formatDate(cred.expiresAt)}</dd>
          </div>
          <div>
            <dt>Last on-chain update</dt>
            <dd>{formatDate(cred.updatedAt)}</dd>
          </div>
        </dl>
        <p className="admin-company-note">
          Cryptographic verification: not performed on this page. Company access and credential
          lifecycle status are separate on-chain records.
        </p>
        <details className="admin-company-technical">
          <summary>Technical details</summary>
          <dl>
            {technical.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>
                  <Identifier label={label!} value={value} />
                </dd>
              </div>
            ))}
          </dl>
        </details>
      </Card>
      <Card className="admin-company-management admin-company-lifecycle">
        <h2>Company management</h2>
        <section aria-label="Company access" className="admin-company-record-controls">
          <div className="admin-company-section-heading">
            <div>
              <h3>Company access</h3>
              <p>
                Current on-chain stakeholder record. Protected actions also require a valid current
                credential and permission.
              </p>
            </div>
            <Badge
              label={`Access: ${titleCase(cred.stakeholderStatus || 'unknown')}`}
              variant={cred.stakeholderStatus === 'unknown' ? 'default' : cred.stakeholderStatus}
            />
          </div>
          {cred.stakeholderStatus === 'active' &&
            cred.status !== 'active' &&
            cred.role !== 'SYSTEM_ADMIN' && (
              <p className="admin-company-note">
                This company record is Active, but this credential is {cred.status}. An Active
                company record alone does not authorize protected actions.
              </p>
            )}
          {cred.role?.toUpperCase().replaceAll(' ', '_') !== 'SYSTEM_ADMIN' &&
          ['active', 'suspended'].includes(cred.stakeholderStatus) ? (
            <div className="action-row">
              <Btn
                size="sm"
                variant="outline"
                icon={<ShieldOff size={15} />}
                style={{ color: 'var(--c-red)' }}
                disabled={busy || refreshing || refreshNeeded}
                onClick={() => chooseAction('revoke', 'company access')}
              >
                Revoke company access
              </Btn>
              {cred.stakeholderStatus === 'active' ? (
                <Btn
                  size="sm"
                  variant="outline"
                  icon={<Pause size={15} />}
                  disabled={busy || refreshing || refreshNeeded}
                  onClick={() => chooseAction('suspend', 'company access')}
                >
                  Suspend company access
                </Btn>
              ) : !expired && cred.status === 'active' ? (
                <Btn
                  size="sm"
                  icon={<Play size={15} />}
                  disabled={busy || refreshing || refreshNeeded}
                  onClick={() => chooseAction('reactivate', 'company access')}
                >
                  Reactivate company access
                </Btn>
              ) : (
                <p className="admin-company-note">
                  A valid, active and unexpired credential is required before company access can be
                  reactivated.
                </p>
              )}
            </div>
          ) : (
            <p className="admin-company-note">
              {cred.role?.toUpperCase().replaceAll(' ', '_') === 'SYSTEM_ADMIN'
                ? 'Administrator access cannot be changed with stakeholder lifecycle controls.'
                : cred.stakeholderStatus === 'revoked'
                  ? 'Company access is permanently revoked and its assigned role has been removed.'
                  : 'Company access controls are unavailable for this record.'}
            </p>
          )}
        </section>
        <section
          aria-label="Issued credential"
          className="admin-company-record-controls admin-company-record-controls--credential"
        >
          <div className="admin-company-section-heading">
            <div>
              <h3>Issued credential</h3>
              <p>Manage this specific credential separately from company access.</p>
            </div>
            <Badge
              label={`Credential: ${titleCase(cred.status || 'unknown')}`}
              variant={cred.status === 'unknown' ? 'default' : cred.status}
            />
          </div>
          {manageable ? (
            <div className="action-row">
              <Btn
                variant="outline"
                size="sm"
                icon={<ShieldOff size={15} />}
                style={{ color: 'var(--c-red)', borderColor: 'var(--c-border2)' }}
                disabled={busy || refreshing || refreshNeeded}
                onClick={() => chooseAction('revoke')}
              >
                Permanently revoke
              </Btn>
              {cred.status === 'active' && (
                <Btn
                  variant="outline"
                  size="sm"
                  icon={<Pause size={15} />}
                  disabled={busy || refreshing || refreshNeeded}
                  onClick={() => chooseAction('suspend')}
                >
                  Suspend credential
                </Btn>
              )}
              {cred.status === 'suspended' && !expired && (
                <Btn
                  size="sm"
                  icon={<Play size={15} />}
                  disabled={busy || refreshing || refreshNeeded}
                  onClick={() => chooseAction('reactivate')}
                >
                  Reactivate credential
                </Btn>
              )}
            </div>
          ) : (
            <p className="admin-company-note">
              {cred.status === 'revoked'
                ? 'This credential is permanently revoked and cannot be reactivated.'
                : cred.status === 'expired'
                  ? 'This credential has expired. Reactivation cannot extend its expiry.'
                  : 'Lifecycle controls are unavailable for this record.'}
            </p>
          )}
          {cred.status === 'suspended' && expired && (
            <p className="admin-company-note">
              This credential is also expired. It cannot be reactivated.
            </p>
          )}
        </section>
      </Card>
      <PersonalPermissions company={cred} />
      {action && (
        <Modal title={`${titleCase(action)} ${actionTarget}`} onClose={close}>
          <div className="admin-company-confirmation">
            <p>
              Company: <strong>{company}</strong>
            </p>
            <p className="admin-company-note">Associated wallet: {cred.subject || 'Unavailable'}</p>
            {actionTarget === 'credential' && (
              <p className="admin-company-note admin-company-code">
                Credential ID: {cred.credentialId || 'Unavailable'}
              </p>
            )}
            <Alert
              type={action === 'revoke' ? 'error' : action === 'suspend' ? 'warning' : 'info'}
              message={
                actionTarget === 'company access'
                  ? action === 'revoke'
                    ? "Revoking company access permanently removes this wallet's assigned stakeholder role. It cannot be reactivated. This does not delete company records or rewrite past transactions."
                    : action === 'suspend'
                      ? 'Suspension blocks this wallet from stakeholder-authorized operations until an authorized administrator reactivates it.'
                      : 'Reactivation restores company access only while the linked credential remains active, unexpired and valid.'
                  : action === 'revoke'
                    ? 'Revocation permanently invalidates this credential. It can never be reactivated. This does not delete company records or rewrite past transactions.'
                    : action === 'suspend'
                      ? 'Suspension blocks credential authorization until an authorized administrator reactivates it.'
                      : 'Reactivation restores authorization only while the credential and stakeholder remain otherwise valid.'
              }
            />
            {action !== 'reactivate' && (
              <Textarea
                label="Reason"
                value={reason}
                onChange={setReason}
                rows={3}
                required
                maxLength={4000}
                placeholder="Only the reason fingerprint is written on-chain."
              />
            )}
            {action === 'revoke' && (
              <label className="admin-company-confirm-check">
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={busy}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                I understand that revoking{' '}
                {actionTarget === 'credential' ? 'this credential' : 'company access'} for {company}{' '}
                is permanent.
              </label>
            )}
            {error && <Alert type="error" message={error} />}
            {busy && (
              <p role="status">
                {phase === 'wallet'
                  ? 'Awaiting confirmation in MetaMask...'
                  : 'Transaction submitted. Waiting for confirmation...'}
              </p>
            )}
            <div className="action-row">
              <Btn variant="outline" disabled={busy} onClick={close}>
                Cancel
              </Btn>
              <Btn
                variant={action === 'revoke' ? 'danger' : 'primary'}
                disabled={
                  busy ||
                  (action !== 'reactivate' && !reason.trim()) ||
                  (action === 'revoke' && !confirmed)
                }
                onClick={() => void execute()}
              >
                {busy ? 'Waiting for confirmation...' : `Confirm ${action}`}
              </Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Identifier({
  label,
  value,
  shorten = false,
}: {
  label: string;
  value?: string;
  shorten?: boolean;
}) {
  if (!value) return <span>Unavailable</span>;
  return (
    <div className="admin-company-identifier">
      <div>
        <span className={shorten ? '' : 'admin-company-code'}>
          {shorten && value.length > 20 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value}
        </span>
        <button
          type="button"
          className="admin-company-copy"
          aria-label={`Copy ${label}`}
          onClick={() => void copyValue(label, value)}
        >
          <Copy size={15} aria-hidden="true" />
          <span className="sr-only">Copy</span>
        </button>
      </div>
      {shorten && (
        <details>
          <summary>Show full address</summary>
          <span className="admin-company-code">{value}</span>
        </details>
      )}
    </div>
  );
}
async function copyValue(label: string, value: string) {
  try {
    await navigator.clipboard.writeText(value);
    notify(`${label} copied.`, 'success');
  } catch {
    notify(
      'Copy failed. Use Show full address or Technical details to select and copy the value.',
      'error',
    );
  }
}
function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}
function displayRole(value?: string) {
  return value
    ? value
        .toLowerCase()
        .replaceAll('_', ' ')
        .replace(/\b\w/g, (letter) => letter.toUpperCase())
    : 'Unavailable';
}
export function formatDate(timestamp?: number) {
  if (!timestamp || timestamp < 0 || !Number.isFinite(timestamp)) return 'Unavailable';
  const date = new Date(timestamp * 1000);
  return Number.isFinite(date.getTime())
    ? `${new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Singapore' }).format(date)} SGT (UTC+08:00)`
    : 'Unavailable';
}
function downloadSummary(credential: ChainCredential) {
  try {
    const { encryptedCredentialCid: _cid, ...safe } = credential;
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            {
              title: 'Company identity summary',
              generatedAt: new Date().toISOString(),
              verification: 'Cryptographic verification not performed on this page',
              ...safe,
            },
            null,
            2,
          ),
        ],
        { type: 'application/json' },
      ),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `credential-summary-${credential.credentialId?.slice(-12) || 'unavailable'}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify('Company identity summary downloaded.', 'success');
  } catch {
    notify('The summary could not be downloaded. Please try again.', 'error');
  }
}
