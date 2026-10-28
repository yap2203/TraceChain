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

export default function WorkspaceApp({ role }: { role: WorkspaceRole }) {
  const { '*': route = '' } = useParams();
  const [search] = useSearchParams();
  const { state, logout } = useWalletAuthentication();
  const page = workspacePage(role, route || 'overview');
  const exists = workspaceNavigation[role].some(([id]) => id === page);
  const canonicalPath = workspacePath(role, page);
  const authenticated = state.phase === 'authenticated';
  const restoring = state.phase === 'restoring';
  const status = restoring
    ? 'Checking session'
    : authenticated
      ? 'Credential required'
      : 'Sign-in required';

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
        authenticated ? (
          <button className="workspace-account-action" onClick={() => void logout()}>
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
      ) : (
        // The session API currently provides no cryptographically verified role.
        // Do not derive authorizedRole from a URL, wallet address, or local storage.
        <WorkspaceAccessGate state={state} role={role}>
          <fieldset disabled className="workspace-pending-workflows">
            <legend>Business workflows are not connected yet</legend>
            <Suspense fallback={<p role="status">Loading page…</p>}>
              <WorkspaceScreen role={role} page={page} />
            </Suspense>
          </fieldset>
        </WorkspaceAccessGate>
      )}
    </WorkspaceLayout>
  );
}
