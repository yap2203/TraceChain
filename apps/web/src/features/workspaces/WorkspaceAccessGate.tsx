import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { LockKeyhole, LogIn, RefreshCw } from 'lucide-react';
import type { useWalletAuthentication } from '../auth/useWalletAuthentication';
import type { WorkspaceRole } from './workspace-navigation';

/** Only a role cryptographically verified by the server may unlock page content. */
export function WorkspaceAccessGate({
  state,
  role,
  authorizedRole,
  children,
}: {
  state: ReturnType<typeof useWalletAuthentication>['state'];
  role: WorkspaceRole;
  authorizedRole?: WorkspaceRole;
  children: ReactNode;
}) {
  const authenticated = state.phase === 'authenticated';
  const restoring = state.phase === 'restoring';
  const unavailable = state.phase === 'error';
  if (authenticated && authorizedRole === role) return children;
  return (
    <section className="workspace-access-panel" aria-live="polite">
      {restoring ? (
        <RefreshCw aria-hidden="true" size={30} />
      ) : authenticated ? (
        <LockKeyhole aria-hidden="true" size={30} />
      ) : (
        <LogIn aria-hidden="true" size={30} />
      )}
      <h2>
        {restoring
          ? 'Checking your session'
          : unavailable
            ? 'Unable to check your session'
            : authenticated
              ? 'Company Role Credential verification is required.'
              : 'Sign in to your workspace'}
      </h2>
      <p>
        {restoring
          ? 'Please wait while we confirm your wallet session.'
          : unavailable
            ? 'We could not reach the authentication service. Return to sign-in to try again.'
            : authenticated
              ? 'Your wallet is verified. Workspace records and actions remain locked until your company role can be verified.'
              : 'Connect your wallet and sign in to continue. Access to company records requires a verified Company Role Credential.'}
      </p>
      {!restoring && (
        <div className="workspace-access-actions">
          <Link className="workspace-access-primary" to="/login#sign-in">
            {authenticated ? 'Manage wallet session' : 'Go to wallet sign-in'}
          </Link>
          <Link to="/register-company">Register a company</Link>
        </div>
      )}
    </section>
  );
}
