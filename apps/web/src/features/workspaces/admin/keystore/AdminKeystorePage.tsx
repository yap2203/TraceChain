import { useEffect, useRef, useState } from 'react';
import { Download, KeyRound, LockKeyhole, Upload } from 'lucide-react';

import { LoadingIndicator } from '../../../../components/ui/LoadingIndicator';
import { reportError } from '../../../../components/ui/feedback';
import { Alert, Badge, Btn, Card, SectionTitle } from '../../shared/ui';
import {
  downloadAdminKeystore,
  getAdminKeystoreStatus,
  lockAdminKeystore,
  unlockAdminKeystore,
  type AdminKeystoreStatus,
} from './admin-keystore.api';

const MAX_FILE_SIZE = 2 * 1024 * 1024;

export default function AdminKeystorePage() {
  const [status, setStatus] = useState<AdminKeystoreStatus>();
  const [password, setPassword] = useState('');
  const [selected, setSelected] = useState<File>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void refresh();
  }, []);

  const refresh = async () => {
    setError('');
    try {
      setStatus(await getAdminKeystoreStatus());
    } catch (cause) {
      setError(reportError(cause, 'Could not read the keystore status.'));
    }
  };

  const unlock = async () => {
    if (!selected) return setError('Select the encrypted administrator keystore JSON file.');
    if (selected.size > MAX_FILE_SIZE)
      return setError('The keystore file must be 2 MB or smaller.');
    if (password.length < 12) return setError('Enter the keystore password (12+ characters).');
    setBusy('unlock');
    setError('');
    try {
      await unlockAdminKeystore(await selected.text(), password);
      setPassword('');
      setSelected(undefined);
      if (fileInput.current) fileInput.current.value = '';
      await refresh();
    } catch (cause) {
      setError(reportError(cause, 'Incorrect password or invalid keystore file.'));
    } finally {
      setBusy('');
    }
  };

  const download = async (action: 'export' | 'initialize') => {
    if (password.length < 12) return setError('Enter a new download password (12+ characters).');
    setBusy(action);
    setError('');
    try {
      const blob = await downloadAdminKeystore(action, password);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'tracechain-admin-keystore.json';
      link.click();
      URL.revokeObjectURL(url);
      setPassword('');
      await refresh();
    } catch (cause) {
      setError(reportError(cause, 'Could not create the encrypted keystore download.'));
    } finally {
      setBusy('');
    }
  };

  if (!status && !error) return <LoadingIndicator page label="Loading keystore status..." />;

  return (
    <div className="grid min-w-0 max-w-[900px] gap-[16px]">
      <SectionTitle
        title="Administrator keystore"
        sub="Unlock protected TraceChain encryption and issuer-signing keys for this API session."
      />
      {error && <Alert type="error" message={error} />}
      <Card>
        <div className="grid gap-[16px]">
          <div className="flex flex-wrap items-center justify-between gap-[12px]">
            <div className="flex items-center gap-[10px]">
              {status?.status === 'Unlocked' ? <KeyRound size={24} /> : <LockKeyhole size={24} />}
              <div>
                <strong>Current status</strong>
                <p className="m-0 text-[12px] text-ws-muted">
                  A restart always returns this backend to Locked.
                </p>
              </div>
            </div>
            <Badge
              variant={status?.status === 'Unlocked' ? 'active' : 'pending'}
              label={status?.status ?? 'Unavailable'}
            />
          </div>

          <Alert
            type="warning"
            message="TraceChain never stores this password. Losing both the keystore file and its password makes the protected keys unrecoverable."
          />

          {status?.status === 'Locked' && (
            <div className="grid gap-[12px]">
              <label className="grid gap-[6px] text-[13px] font-semibold">
                Upload keystore JSON
                <input
                  ref={fileInput}
                  type="file"
                  accept="application/json,.json"
                  onChange={(event) => {
                    setError('');
                    setSelected(event.target.files?.[0]);
                  }}
                />
              </label>
              {selected && (
                <span className="text-[12px] text-ws-muted">Selected: {selected.name}</span>
              )}
            </div>
          )}

          <label className="grid gap-[6px] text-[13px] font-semibold">
            {status?.status === 'Locked' ? 'Keystore password' : 'New download password'}
            <input
              aria-label="Administrator keystore password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="At least 12 characters"
            />
          </label>

          <div className="flex flex-wrap gap-[10px]">
            {status?.status === 'Locked' && (
              <Btn
                onClick={() => void unlock()}
                disabled={Boolean(busy)}
                icon={<Upload size={16} />}
              >
                {busy === 'unlock' ? 'Unlocking...' : 'Unlock keystore'}
              </Btn>
            )}
            {status?.status === 'Unlocked' && (
              <>
                <Btn
                  onClick={() => void download('export')}
                  disabled={Boolean(busy)}
                  icon={<Download size={16} />}
                >
                  {busy === 'export' ? 'Preparing...' : 'Download encrypted keystore'}
                </Btn>
                <Btn
                  variant="outline"
                  disabled={Boolean(busy)}
                  onClick={async () => {
                    setBusy('lock');
                    setError('');
                    try {
                      await lockAdminKeystore();
                      setPassword('');
                      await refresh();
                    } catch (cause) {
                      setError(reportError(cause, 'Could not lock the keystore.'));
                    } finally {
                      setBusy('');
                    }
                  }}
                >
                  Lock now
                </Btn>
              </>
            )}
            {status?.status === 'Locked' && status.initializationAllowed && (
              <Btn
                variant="outline"
                disabled={Boolean(busy)}
                onClick={() => void download('initialize')}
                icon={<Download size={16} />}
              >
                {busy === 'initialize' ? 'Creating...' : 'Create initial keystore'}
              </Btn>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
