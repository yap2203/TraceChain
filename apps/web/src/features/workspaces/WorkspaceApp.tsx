import { LoadingIndicator } from '../../components/ui/LoadingIndicator';
import { lazy, Suspense } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';

import { useWalletAuthentication } from '../auth/useWalletAuthentication';
import { WorkspaceAccessGate } from './WorkspaceAccessGate';
import { WorkspaceLayout } from './WorkspaceLayout';
import { workspaces } from './workspace-config';
import { workspaceNavigation, type WorkspaceRole } from './workspace-navigation';
import { workspacePage, workspacePath } from './workspace-paths';

const WorkspaceScreen = lazy(() =>
  import('./WorkspaceScreen').then((module) => ({ default: module.WorkspaceScreen })),
);

export default function WorkspaceApp({ role }: { role: WorkspaceRole }) {
  const authentication = useWalletAuthentication();
  const { '*': route = '' } = useParams();
  const [search] = useSearchParams();
  const state = authentication.state;
  const page = workspacePage(role, route || 'overview');
  const exists = workspaceNavigation[role].some(([id]) => id === page);
  const canonicalPath = workspacePath(role, page);
  const authenticated = state.phase === 'authenticated';
  const compactSupplierPage = role === 'supplier' && (page === 'batches' || page === 'orders');
  const status =
    state.phase === 'restoring'
      ? 'Checking session'
      : authenticated
        ? state.authorizationReady
          ? 'Configured blockchain · Authorized'
          : 'Blockchain authorization required'
        : 'Sign-in required';

  const content = (
    <fieldset disabled={!state.authorizationReady} className="workspace-pending-workflows">
      <legend className={state.authorizationReady && compactSupplierPage ? 'sr-only' : undefined}>
        {state.authorizationReady
          ? compactSupplierPage
            ? 'Authorized workspace content'
            : 'Connected to the configured local blockchain.'
          : 'Blockchain authorization is required.'}
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
      identity={
        authenticated && state.authorizationReady && state.address && state.role
          ? {
              companyName: state.companyName ?? workspaces[role].roleLabel,
              credentialStatus: state.authorizationStatus ?? 'UNAVAILABLE',
              role: state.role,
              walletAddress: state.address,
            }
          : undefined
      }
      accountAction={
        authenticated ? (
          <button className="workspace-account-action" onClick={() => void authentication.logout()}>
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
