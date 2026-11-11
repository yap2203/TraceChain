import { useEffect, useRef, useState, type ChangeEvent } from 'react';

import type { CompanyRole } from '@tracechain/shared';

import { credentialFailureHeading } from './login-auth-presentation';
import type { CredentialVerificationState } from './useWalletAuthentication';

const MAX_CREDENTIAL_FILE_SIZE = 240 * 1024;

const reasonLabels: Record<string, string> = {
  EXPIRED: 'The credential has expired.',
  INACTIVE_STATUS: 'The credential is not active.',
  INVALID_SIGNATURE: 'The credential signature is invalid.',
  MALFORMED_CREDENTIAL: 'The file is not a valid Company Role Credential.',
  NOT_YET_VALID: 'The credential is not valid yet.',
  UNSUPPORTED_ROLE: 'The credential contains an unsupported role.',
  UNTRUSTED_ISSUER: 'The credential was not issued by the trusted TraceChain authority.',
  WRONG_WALLET: 'The credential does not belong to the signed-in wallet.',
};

export function CredentialVerificationPanel({
  authorizationReady = false,
  credentialId,
  credentialState,
  credentialVerified,
  onChainStatusChecked = false,
  onPresent,
  role,
  walletAddress,
}: {
  authorizationReady?: boolean;
  credentialId?: string;
  credentialState: CredentialVerificationState;
  credentialVerified: boolean;
  onChainStatusChecked?: boolean;
  onPresent: (credential: Record<string, unknown>) => Promise<void>;
  role?: CompanyRole;
  walletAddress?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState('');
  const [showReplacementPicker, setShowReplacementPicker] = useState(false);
  const busy = credentialState.phase === 'reading' || credentialState.phase === 'verifying';
  const hasError = Boolean(fileError) || credentialState.phase === 'error';
  const blockchainAuthorizationComplete = authorizationReady && onChainStatusChecked;

  useEffect(() => {
    if (credentialVerified && credentialState.phase === 'success') {
      setFileError('');
      setShowReplacementPicker(false);
    }
  }, [credentialState.phase, credentialVerified]);

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setFileError('');
    if (!file) return;

    try {
      if (!file.name.toLowerCase().endsWith('.json') && file.type !== 'application/json') {
        throw new Error('Choose a JSON credential file.');
      }
      if (!file.size) throw new Error('The selected credential file is empty.');
      if (file.size > MAX_CREDENTIAL_FILE_SIZE) {
        throw new Error('The credential file must be smaller than 240 KiB.');
      }
      const parsed = JSON.parse(await file.text()) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('The credential file must contain one JSON object.');
      }
      await onPresent(parsed as Record<string, unknown>);
    } catch (error) {
      setFileError(
        error instanceof Error ? error.message : 'The credential file could not be read.',
      );
    } finally {
      if (input.current) input.current.value = '';
    }
  };

  const filePicker = (
    <label className={`credential-file-button${busy ? ' is-disabled' : ''}`}>
      {busy ? 'Verifying credential…' : 'Choose credential file'}
      <input
        ref={input}
        accept="application/json,.json"
        disabled={busy}
        onChange={(event) => void handleFile(event)}
        type="file"
      />
    </label>
  );

  if (credentialVerified) {
    return (
      <section className="credential-verification-panel" aria-labelledby="credential-title">
        <div className="credential-summary-heading">
          <div>
            <span>Company access</span>
            <h3 id="credential-title">{formatRole(role)} verified locally</h3>
          </div>
          <span className="local-verification-badge">Locally verified</span>
        </div>

        <dl className="verified-identity-summary">
          <div>
            <dt>Role</dt>
            <dd>{formatRole(role)}</dd>
          </div>
          <div>
            <dt>Wallet</dt>
            <dd>{walletAddress ?? 'Authenticated wallet'}</dd>
          </div>
        </dl>

        <ol className="authorization-status" aria-label="Authorization progress">
          <li className="is-complete">
            <span aria-hidden="true">✓</span>
            <p>
              Wallet connected <strong>Complete</strong>
            </p>
          </li>
          <li className="is-complete">
            <span aria-hidden="true">✓</span>
            <p>
              Role credential verified <strong>Complete</strong>
            </p>
          </li>
          <li className={blockchainAuthorizationComplete ? 'is-complete' : 'is-pending'}>
            <span aria-hidden="true">{blockchainAuthorizationComplete ? '✓' : '3'}</span>
            <p>
              Blockchain authorization{' '}
              <strong>{blockchainAuthorizationComplete ? 'Complete' : 'Pending'}</strong>
            </p>
          </li>
        </ol>

        <p className="authorization-pending-note">
          {blockchainAuthorizationComplete
            ? 'Wallet, role credential, and blockchain authorization checks are complete.'
            : 'Dashboard access remains locked until blockchain role and credential-status verification is complete.'}
        </p>

        <button
          aria-controls="replacement-credential-picker"
          aria-expanded={showReplacementPicker}
          className="replace-credential-button"
          onClick={() => {
            setFileError('');
            setShowReplacementPicker((visible) => !visible);
          }}
          type="button"
        >
          {showReplacementPicker ? 'Cancel replacement' : 'Replace credential'}
        </button>

        {showReplacementPicker && (
          <div className="replacement-credential-picker" id="replacement-credential-picker">
            <p>Select another JSON credential only if your company credential has changed.</p>
            {filePicker}
            {hasError && (
              <div className="credential-result credential-result--error" role="alert">
                <strong>{credentialFailureHeading(true)}</strong>
                <p>
                  The selected file was rejected. Your existing verified session remains unchanged.
                </p>
                <p>{fileError || credentialState.message}</p>
                <FailureReasons reasons={credentialState.reasons} />
              </div>
            )}
          </div>
        )}

        {credentialId && <small className="credential-id">Credential: {credentialId}</small>}
      </section>
    );
  }

  return (
    <section className="credential-verification-panel" aria-labelledby="credential-title">
      <div>
        <span>Company access</span>
        <h3 id="credential-title">Verify role credential</h3>
      </div>
      <p>Select the JSON credential provided by the TraceChain authority.</p>
      {filePicker}
      {hasError && (
        <div className="credential-result credential-result--error" role="alert">
          <strong>{credentialFailureHeading(false)}</strong>
          <p>{fileError || credentialState.message}</p>
          <FailureReasons reasons={credentialState.reasons} />
        </div>
      )}
    </section>
  );
}

function FailureReasons({ reasons }: { reasons: readonly string[] }) {
  if (reasons.length === 0) return null;
  return (
    <ul>
      {reasons.map((reason) => (
        <li key={reason}>{reasonLabels[reason] ?? reason}</li>
      ))}
    </ul>
  );
}

function formatRole(role?: CompanyRole) {
  if (!role) return 'Company role';
  return role
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
