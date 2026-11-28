import { navigationActionCount, useNavigationActions } from './action-counts';
import { ActionCountBadge, actionCountLabel } from './shared/ui/ActionCountBadge';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { notify } from '../../components/ui/feedback';
import { Menu, Moon, Sun, X } from 'lucide-react';
import type { CompanyRole } from '@tracechain/shared';

import { Brand } from '../../components/brand/Brand';
import { workspaces } from './workspace-config';
import {
  workspaceNavigation,
  workspaceNavigationGroups,
  workspaceSection,
  type WorkspaceRole,
} from './workspace-navigation';
import { StatusTabs } from './shared/ui';
import './workspace.css';
import { CompanyAvatar } from '../orders/CatalogueMedia';

interface WorkspaceLayoutProps {
  role: WorkspaceRole;
  page: string;
  children: ReactNode;
  pathForPage: (page: string) => string;
  status: string;
  accountAction?: ReactNode;
  identity?: {
    companyName: string;
    credentialStatus: string;
    logoPath?: string;
    logoRevision?: number;
    role: CompanyRole | WorkspaceRole;
    walletAddress: string;
  };
}

export function WorkspaceLayout({
  role,
  page,
  children,
  pathForPage,
  status,
  accountAction,
  identity,
}: WorkspaceLayoutProps) {
  const actions = useNavigationActions(identity?.walletAddress, role);
  const destinations = (id: string) =>
    id === 'requests'
      ? ['requests', 'sent-requests']
      : (workspaceSection(role, id)?.pages.map(([page]) => page) ?? [id]);
  const countFor = (id: string) => navigationActionCount(actions, destinations(id));
  const [light, setLight] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const sidebar = useRef<HTMLElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const current = workspaceNavigation[role].find(([id]) => id === page);
  // Merged pages (e.g. Buying / Selling orders) share one sidebar entry and switch by tabs.
  const section = workspaceSection(role, page);
  const navigate = useNavigate();
  const activeId = section?.pages[0]![0] ?? page;
  const PageIcon = workspaceNavigation[role].find(([id]) => id === activeId)?.[2] ?? current?.[2];

  useEffect(() => {
    if (!menuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    sidebar.current?.querySelector<HTMLButtonElement>('.workspace-close')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
      if (event.key !== 'Tab') return;
      const controls = Array.from(
        sidebar.current?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), summary') ??
          [],
      ).filter((element) => !element.matches('details:not([open]) button'));
      if (!controls?.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const onResize = () => {
      if (window.innerWidth > 720) setMenuOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onResize);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onResize);
      menuButton.current?.focus();
    };
  }, [menuOpen]);

  return (
    <div className={`workspace-ui${light ? ' light-theme' : ''}`}>
      <a className="workspace-skip" href="#workspace-content">
        Skip to content
      </a>
      <div className="workspace-shell">
        {menuOpen && (
          <button
            className="workspace-overlay"
            aria-label="Close navigation"
            onClick={() => setMenuOpen(false)}
          />
        )}
        <aside
          id="workspace-navigation"
          ref={sidebar}
          className={`workspace-sidebar${menuOpen ? ' is-open' : ''}`}
        >
          <Link className="workspace-brand" to={pathForPage('overview')}>
            <Brand />
          </Link>
          <button
            className="workspace-menu workspace-close"
            aria-label="Close navigation"
            onClick={() => setMenuOpen(false)}
          >
            <X aria-hidden="true" size={20} />
          </button>
          <div className="workspace-role">
            <strong>{identity?.companyName ?? workspaces[role].roleLabel}</strong>
            <span>{workspaces[role].roleLabel}</span>
          </div>
          <nav aria-label={`${workspaces[role].roleLabel} navigation`}>
            {workspaceNavigationGroups(role).map((group) => (
              <section className="workspace-nav-group" key={group.label} aria-label={group.label}>
                <h2>{group.label}</h2>
                {group.items.map(([id, label, Icon]) => (
                  <Link
                    key={id}
                    to={pathForPage(id)}
                    className={activeId === id ? 'active' : ''}
                    aria-label={actionCountLabel(countFor(id), label)}
                    title={
                      countFor(id) === null
                        ? 'Action count unavailable until records refresh successfully'
                        : undefined
                    }
                    aria-current={activeId === id ? 'page' : undefined}
                    onClick={() => setMenuOpen(false)}
                  >
                    <Icon
                      aria-hidden="true"
                      size={18}
                      strokeWidth={1.8}
                      style={{ flexShrink: 0 }}
                    />
                    <span>{label}</span>
                    <ActionCountBadge count={countFor(id)} label={label} reserveSpace />
                  </Link>
                ))}
              </section>
            ))}
          </nav>
          <div className="workspace-sidebar-footer">
            <span>{status}</span>
            {identity && <AccountDetails identity={identity} />}
            {accountAction}
          </div>
        </aside>
        <div className="workspace-main" inert={menuOpen || undefined}>
          <header className="workspace-header">
            <button
              className="workspace-menu"
              ref={menuButton}
              aria-label="Open navigation"
              aria-controls="workspace-navigation"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(true)}
            >
              <Menu aria-hidden="true" size={20} />
            </button>
            <h1>
              {PageIcon && (
                <PageIcon
                  aria-hidden="true"
                  size={20}
                  strokeWidth={1.8}
                  style={{ flexShrink: 0 }}
                />
              )}
              {section?.label ?? current?.[1] ?? 'Page not found'}
            </h1>
            <span className="workspace-status">{status}</span>
            {identity && (
              <span className="workspace-company">
                <CompanyAvatar
                  name={identity.companyName}
                  logoPath={identity.logoPath}
                  revision={identity.logoRevision}
                  size="sm"
                />
                <span>{identity.companyName}</span>
              </span>
            )}
            <button
              className="workspace-theme"
              aria-label={light ? 'Use dark theme' : 'Use light theme'}
              onClick={() => setLight(!light)}
            >
              {light ? <Moon aria-hidden="true" size={18} /> : <Sun aria-hidden="true" size={18} />}
            </button>
          </header>
          <main id="workspace-content" className="workspace-content" key={`${role}/${page}`}>
            {section && (
              <div className="workspace-section-tabs">
                <StatusTabs
                  variant="tabs"
                  label={section.label}
                  value={page}
                  onChange={(id) => navigate(pathForPage(id))}
                  tabs={section.pages.map(([value, label]) => ({
                    value,
                    label,
                    actionCount: navigationActionCount(actions, [value]),
                  }))}
                />
              </div>
            )}
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}

function AccountDetails({ identity }: { identity: NonNullable<WorkspaceLayoutProps['identity']> }) {
  const [copyStatus, setCopyStatus] = useState('');
  const shortWallet = `${identity.walletAddress.slice(0, 6)}...${identity.walletAddress.slice(-4)}`;
  return (
    <details className="workspace-account-details">
      <summary>Account details</summary>
      <dl>
        <div>
          <dt>Company</dt>
          <dd>{identity.companyName}</dd>
        </div>
        <div>
          <dt>Role</dt>
          <dd>{String(identity.role).replaceAll('_', ' ')}</dd>
        </div>
        <div>
          <dt>Wallet</dt>
          <dd>
            <code>{shortWallet}</code>
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(identity.walletAddress);
                  setCopyStatus('Wallet address copied.');
                  notify('Wallet address copied.', 'success');
                } catch {
                  setCopyStatus('Unable to copy. Please try again.');
                  notify('Unable to copy. Please try again.', 'error');
                }
              }}
            >
              Copy
            </button>
          </dd>
        </div>
        <div>
          <dt>Credential</dt>
          <dd>{identity.credentialStatus}</dd>
        </div>
      </dl>
      <span role="status">{copyStatus}</span>
    </details>
  );
}
