import { LoadingIndicator } from '../../components/ui/LoadingIndicator';
import { lazy, Suspense } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';

import { shortenAddress, useWalletAuthentication } from '../auth/useWalletAuthentication';
import { WorkspaceAccessGate } from './WorkspaceAccessGate';
import { WorkspaceLayout } from './WorkspaceLayout';
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
  const status = state.phase === 'restoring'
    ? 'Checking session'
    : authenticated
      ? state.authorizationReady
        ? 'Local blockchain · Authorized'
        : state.locallyVerified
          ? 'Blockchain verification required'
          : 'Credential required'
      : 'Sign-in required';

  const content = (
    <fieldset disabled={!state.authorizationReady} className="workspace-pending-workflows">
      <legend>{state.authorizationReady ? 'Connected to the configured local blockchain.' : 'Blockchain authorization is required.'}</legend>
      <Suspense fallback={<LoadingIndicator fullScreen label="Loading page…" />}>
        <WorkspaceScreen role={role} page={page} />
      </Suspense>
    </fieldset>
  );

  if (exists && `/${role}/${route}` !== canonicalPath) {
    const query = search.toString();
    return <Navigate replace to={`${canonicalPath}${query ? `?${query}` : ''}`} />;
  }

  return <WorkspaceLayout
    role={role}
    page={page}
    pathForPage={(id) => workspacePath(role, id)}
    status={status}
    accountAction={authenticated ? <button className="workspace-account-action" onClick={() => void authentication.logout()}>Sign out {state.address ? shortenAddress(state.address) : ''}</button> : <Link to="/login#sign-in">Wallet sign-in</Link>}
  >
    {!exists ? <section className="workspace-access-panel"><h2>Page not found</h2><p>This page is not part of this workspace.</p><Link to={workspacePath(role, 'overview')}>Return to overview</Link></section> : <WorkspaceAccessGate state={state} role={role}>{content}</WorkspaceAccessGate>}
  </WorkspaceLayout>;
}
