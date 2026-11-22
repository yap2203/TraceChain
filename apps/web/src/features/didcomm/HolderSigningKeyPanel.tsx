import { reportError } from '../../components/ui/feedback';
import { useRef, useState } from 'react';
import { Link, useInRouterContext } from 'react-router-dom';

import {
  createBindingProof,
  createMessagingAgent,
  exportRecoveryKit,
  getActiveMessagingAgent,
  importRecoveryKit,
  setActiveMessagingAgent,
  type HolderMessagingAgent,
} from './didcomm-agent';
import { didCommApi } from './didcomm.api';
import { Alert, Btn, Card } from '../workspaces/shared/ui';
import { uploadError } from '../validation/form-validation';
import { workspacePath } from '../workspaces/workspace-paths';
import type { WorkspaceRole } from '../workspaces/workspace-navigation';

export function PresentationSigningSettingsLink({ role }: { role: WorkspaceRole }) {
  const inRouter = useInRouterContext();
  const to = `${workspacePath(role, 'mycredential')}#legacy-presentation-signing`;
  const text = 'Manage legacy presentation keys';
  // SPA navigation preserves the in-memory holder key while changing workspace pages.
  return inRouter ? <Link to={to}>{text}</Link> : <a href={to}>{text}</a>;
}

/**
 * This key signs holder presentations. It is deliberately not used for DIDComm transport; the
 * backend now owns separate messaging keys. Existing recovery files remain compatible.
 */
export function HolderSigningKeyPanel({ expectedDid }: { expectedDid?: string }) {
  const [ready, setReady] = useState(() => {
    const active = getActiveMessagingAgent();
    return !!active && (!expectedDid || active.did === expectedDid);
  });
  const [backupPassword, setBackupPassword] = useState('');
  const [confirmBackupPassword, setConfirmBackupPassword] = useState('');
  const [restorePassword, setRestorePassword] = useState('');
  const [pendingHolder, setPendingHolder] = useState<HolderMessagingAgent>();
  const [backupConfirmed, setBackupConfirmed] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const file = useRef<HTMLInputElement>(null);

  const validateBackupPassword = () => {
    if (backupPassword.length < 12)
      throw new Error('Use a presentation-keystore password of at least 12 characters.');
    if (backupPassword !== confirmBackupPassword)
      throw new Error('The password confirmation does not match.');
  };

  const download = async (holder: HolderMessagingAgent) => {
    validateBackupPassword();
    const content = await exportRecoveryKit(holder, backupPassword);
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
    try {
      const link = document.createElement('a');
      link.href = url;
      link.download = 'tracechain-presentation-keystore.json';
      link.click();
    } finally {
      URL.revokeObjectURL(url);
    }
    setBackupPassword('');
    setConfirmBackupPassword('');
  };

  const createAndDownload = async () => {
    setBusy('create');
    setError('');
    try {
      validateBackupPassword();
      const holder = await createMessagingAgent();
      await download(holder);
      setPendingHolder(holder);
      setBackupConfirmed(false);
    } catch (cause) {
      setError(reportError(cause, 'Could not create and download the presentation keystore.'));
    } finally {
      setBusy('');
    }
  };

  const bind = async () => {
    if (!pendingHolder || !backupConfirmed) return;
    setBusy('bind');
    setError('');
    try {
      const challenge = await didCommApi.challenge();
      await didCommApi.bind(await createBindingProof(pendingHolder, challenge));
      setActiveMessagingAgent(pendingHolder);
      setPendingHolder(undefined);
      setBackupConfirmed(false);
      setReady(true);
    } catch (cause) {
      setError(reportError(cause, 'Could not bind the backed-up presentation key.'));
    } finally {
      setBusy('');
    }
  };

  const restore = async (selected?: File) => {
    if (!selected) return;
    setBusy('restore');
    setError('');
    try {
      const invalid = uploadError(selected, 1 * 1024 * 1024, /\.json$/i, ['application/json']);
      if (invalid) throw new Error(invalid);
      if (restorePassword.length < 12)
        throw new Error('Enter the original presentation-keystore password (12+ characters).');
      const holder = await importRecoveryKit(await selected.text(), restorePassword);
      if (expectedDid && holder.did !== expectedDid)
        throw new Error('This backup is not the presentation key bound to the credential.');
      setActiveMessagingAgent(holder);
      setReady(true);
      setRestorePassword('');
    } catch (cause) {
      setError(reportError(cause, 'Could not restore the presentation key.'));
    } finally {
      setBusy('');
      if (file.current) file.current.value = '';
    }
  };

  const backup = async () => {
    setBusy('backup');
    setError('');
    try {
      const holder = getActiveMessagingAgent();
      if (!holder) throw new Error('Create or restore the presentation key first.');
      await download(holder);
    } catch (cause) {
      setError(reportError(cause, 'Could not create the encrypted backup.'));
    } finally {
      setBusy('');
    }
  };

  const downloadPendingAgain = async () => {
    if (!pendingHolder) return;
    setBusy('backup');
    setError('');
    try {
      await download(pendingHolder);
      setBackupConfirmed(false);
    } catch (cause) {
      setError(reportError(cause, 'Could not create the encrypted backup.'));
    } finally {
      setBusy('');
    }
  };

  return (
    <Card>
      <div style={{ display: 'grid', gap: 8 }}>
        <b>Presentation signature settings</b>
        <div style={{ fontSize: 12 }}>
          Create or restore the company key used to sign approved credential presentations. The
          decrypted key stays only in browser memory. Keep the encrypted keystore separate from its
          password so the company administrator can restore it on another device.
        </div>
        {error && <Alert type="error" message={error} />}

        {!pendingHolder && (ready || !expectedDid) && (
          <>
            <input
              aria-label="Presentation key backup password"
              type="password"
              autoComplete="new-password"
              value={backupPassword}
              onChange={(event) => setBackupPassword(event.target.value)}
              placeholder="New backup password (12+ characters)"
            />
            <input
              aria-label="Confirm presentation key backup password"
              type="password"
              autoComplete="new-password"
              value={confirmBackupPassword}
              onChange={(event) => setConfirmBackupPassword(event.target.value)}
              placeholder="Confirm backup password"
            />
          </>
        )}

        {!ready && !pendingHolder && (
          <>
            {!expectedDid && (
              <Btn disabled={Boolean(busy)} onClick={() => void createAndDownload()}>
                {busy === 'create' ? 'Preparing...' : 'Generate and download keystore'}
              </Btn>
            )}
            <div className="text-[12px] text-ws-muted">Or restore an existing bound key:</div>
            <input
              aria-label="Presentation key restore password"
              type="password"
              autoComplete="current-password"
              value={restorePassword}
              onChange={(event) => setRestorePassword(event.target.value)}
              placeholder="Original backup password"
            />
            <input
              ref={file}
              type="file"
              accept="application/json,.json"
              aria-label="Restore presentation key backup"
              disabled={Boolean(busy)}
              onChange={(event) => void restore(event.target.files?.[0])}
            />
          </>
        )}

        {pendingHolder && (
          <div className="grid gap-[10px]">
            <Alert
              type="success"
              message="Encrypted presentation keystore downloaded. The key is not bound to the company yet."
            />
            <label className="flex items-start gap-[8px] text-[13px]">
              <input
                type="checkbox"
                checked={backupConfirmed}
                onChange={(event) => setBackupConfirmed(event.target.checked)}
              />
              I saved the encrypted presentation keystore and its password separately.
            </label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Btn disabled={!backupConfirmed || Boolean(busy)} onClick={() => void bind()}>
                {busy === 'bind' ? 'Binding...' : 'Bind key to company'}
              </Btn>
              <Btn
                variant="outline"
                disabled={Boolean(busy)}
                onClick={() => {
                  pendingHolder.privateKey.fill(0);
                  setPendingHolder(undefined);
                  setBackupConfirmed(false);
                  setBackupPassword('');
                  setConfirmBackupPassword('');
                }}
              >
                Discard unbound key
              </Btn>
            </div>
            <div className="text-[12px] text-ws-muted">
              To download this same unbound key again, enter and confirm a new backup password.
            </div>
            <input
              aria-label="Presentation key backup password"
              type="password"
              autoComplete="new-password"
              value={backupPassword}
              onChange={(event) => setBackupPassword(event.target.value)}
              placeholder="New backup password (12+ characters)"
            />
            <input
              aria-label="Confirm presentation key backup password"
              type="password"
              autoComplete="new-password"
              value={confirmBackupPassword}
              onChange={(event) => setConfirmBackupPassword(event.target.value)}
              placeholder="Confirm backup password"
            />
            <Btn
              variant="outline"
              disabled={Boolean(busy)}
              onClick={() => void downloadPendingAgain()}
            >
              Download again
            </Btn>
          </div>
        )}

        {ready && !pendingHolder && (
          <Btn variant="outline" disabled={Boolean(busy)} onClick={() => void backup()}>
            {busy === 'backup' ? 'Preparing...' : 'Download encrypted presentation keystore'}
          </Btn>
        )}
      </div>
    </Card>
  );
}
