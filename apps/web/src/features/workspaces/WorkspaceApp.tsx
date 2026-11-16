import { LoadingIndicator } from '../../components/ui/LoadingIndicator';
import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { notify, reportError } from '../../components/ui/feedback';

import { useWalletAuthentication } from '../auth/useWalletAuthentication';
import { WorkspaceAccessGate } from './WorkspaceAccessGate';
import { WorkspaceLayout } from './WorkspaceLayout';
import { workspaces } from './workspace-config';
import { workspaceNavigation, type WorkspaceRole } from './workspace-navigation';
import { workspacePage, workspacePath } from './workspace-paths';
import { getMyCompanyBranding } from '../orders/orders.api';

const WorkspaceScreen = lazy(() =>
  import('./WorkspaceScreen').then((module) => ({ default: module.WorkspaceScreen })),
);

export default function WorkspaceApp({ role }: { role: WorkspaceRole }) {
  const authentication = useWalletAuthentication();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);
  const [logoPath, setLogoPath] = useState<string>();
  const { '*': route = '' } = useParams();
  const [search] = useSearchParams();
  const state = authentication.state;
  const page = workspacePage(role, route || 'overview');
  const exists = workspaceNavigation[role].some(([id]) => id === page);
  const canonicalPath = workspacePath(role, page);
  const authenticated = state.phase === 'authenticated';
  useEffect(() => {
    let active = true;
    if (!authenticated || !state.authorizationReady) {
      setLogoPath(undefined);
      return;
    }
    setLogoPath(undefined);
    void getMyCompanyBranding()
      .then(({ branding }) => active && setLogoPath(branding.logoPath))
      .catch(() => active && setLogoPath(undefined));
    return () => {
      active = false;
    };
  }, [authenticated, state.authorizationReady, state.address]);
  const status =
    state.phase === 'restoring'
      ? 'Checking session'
      : authenticated
        ? state.authorizationReady
          ? 'Wallet authorized'
          : 'Blockchain authorization required'
        : 'Sign-in required';

  const content = (
    <fieldset disabled={!state.authorizationReady} className="workspace-pending-workflows">
      <legend className={state.authorizationReady ? 'sr-only' : undefined}>
        {state.authorizationReady
          ? 'Authorized workspace content'
          : 'Blockchain authorization is required.'}
      </legend>
      <Suspense fallback={<LoadingIndicator page label="Loading page…" />}>
        <WorkspaceScreen role={role} page={page} />
      </Suspense>
    </fieldset>
  );

  if (signingOut) return <LoadingIndicator fullScreen label="Signing out…" />;
  if (state.phase === 'idle') return <Navigate replace to="/login" />;
  if (exists && `/${role}/${route}` !== canonicalPath) {
    const query = search.toString();
    return <Navigate replace to={`${canonicalPath}${query ? `?${query}` : ''}`} />;
  }

  return (
    <WorkspaceLayout
      role={role}
      page={page}
      pathForPage={(id) => workspacePath(role, id)}
      status={status}
      identity={
        authenticated && state.authorizationReady && state.address && state.role
          ? {
              companyName: state.companyName ?? workspaces[role].roleLabel,
              credentialStatus: state.authorizationStatus ?? 'UNAVAILABLE',
              logoPath,
              role: state.role,
              walletAddress: state.address,
            }
          : undefined
      }
      accountAction={
        authenticated ? (
          <button
            className="workspace-account-action"
            onClick={async () => {
              setSigningOut(true);
              try {
                await authentication.logout();
                notify('You have signed out.', 'success');
                navigate('/login', { replace: true });
              } catch (cause) {
                reportError(cause, 'Sign-out could not be completed. Please try again.');
                setSigningOut(false);
              }
            }}
          >
            Sign out
          </button>
        ) : (
          <Link to="/login#sign-in">Wallet sign-in</Link>
        )
      }
    >
      {!exists ? (
        <section className="workspace-access-panel">
          <h2>Page not found</h2>
          <p>This page is not part of this workspace.</p>
          <Link to={workspacePath(role, 'overview')}>Return to overview</Link>
        </section>
      ) : (
        <WorkspaceAccessGate state={state} role={role}>
          {content}
        </WorkspaceAccessGate>
      )}
    </WorkspaceLayout>
  );
}
