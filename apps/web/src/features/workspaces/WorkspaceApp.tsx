import { LoadingIndicator } from '../../components/ui/LoadingIndicator';
import { lazy, Suspense } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { WorkspaceAccessGate } from './WorkspaceAccessGate';

import { shortenAddress, useWalletAuthentication } from '../auth/useWalletAuthentication';
import { WorkspaceLayout } from './WorkspaceLayout';
import { workspaceNavigation, type WorkspaceRole } from './workspace-navigation';
import { workspacePage, workspacePath } from './workspace-paths';

const WorkspaceScreen = lazy(() =>
  import('./WorkspaceScreen').then((module) => ({ default: module.WorkspaceScreen })),
);

// Temporary local UI access only. Production builds always use the session gate.
const localUiAccess =
  import.meta.env.DEV && ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);

export default function WorkspaceApp({ role }: { role: WorkspaceRole }) {
  return localUiAccess ? <WorkspaceView role={role} /> : <AuthenticatedWorkspace role={role} />;
}

function AuthenticatedWorkspace({ role }: { role: WorkspaceRole }) {
  const authentication = useWalletAuthentication();
  return <WorkspaceView role={role} authentication={authentication} />;
}

function WorkspaceView({
  role,
  authentication,
}: {
  role: WorkspaceRole;
  authentication?: ReturnType<typeof useWalletAuthentication>;
}) {
  const { '*': route = '' } = useParams();
  const [search] = useSearchParams();
  const state = authentication?.state ?? { phase: 'idle', message: '' };
  const page = workspacePage(role, route || 'overview');
  const exists = workspaceNavigation[role].some(([id]) => id === page);
  const canonicalPath = workspacePath(role, page);
  const authenticated = state.phase === 'authenticated';
  const restoring = state.phase === 'restoring';
  const status = localUiAccess
    ? 'Local development · Sample data'
    : restoring
      ? 'Checking session'
      : authenticated
        ? 'Credential required'
        : 'Sign-in required';

  const content = (
    <fieldset disabled={!localUiAccess} className="workspace-pending-workflows">
      <legend>
        {localUiAccess
          ? 'Sample data and simulated actions. Changes are not saved.'
          : 'Business workflows are not connected yet'}
      </legend>
      <Suspense fallback={<LoadingIndicator fullScreen label="Loading page…" />}>
        <WorkspaceScreen role={role} page={page} />
      </Suspense>
    </fieldset>
  );

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
      accountAction={
        localUiAccess ? undefined : authenticated ? (
          <button
            className="workspace-account-action"
            onClick={() => void authentication?.logout()}
          >
            Sign out {state.address ? shortenAddress(state.address) : ''}
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
      ) : localUiAccess ? (
        content
      ) : (
        // The session API currently provides no cryptographically verified role.
        // Do not derive authorizedRole from a URL, wallet address, or local storage.
        <WorkspaceAccessGate state={state} role={role}>
          {content}
        </WorkspaceAccessGate>
      )}
    </WorkspaceLayout>
  );
}
