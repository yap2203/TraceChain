import { useState, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Menu, Moon, Sun, X } from 'lucide-react';
import type { CompanyRole } from '@tracechain/shared';

import { Brand } from '../../components/brand/Brand';
import { workspaces } from './workspace-config';
import { workspaceNavigation, type WorkspaceRole } from './workspace-navigation';
import './workspace.css';

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
  const [light, setLight] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const current = workspaceNavigation[role].find(([id]) => id === page);
  const PageIcon = current?.[2];

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
        <aside className={`workspace-sidebar${menuOpen ? ' is-open' : ''}`}>
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
            <span>Workspace</span>
            <strong>{identity?.companyName ?? workspaces[role].roleLabel}</strong>
            <span>{workspaces[role].roleLabel}</span>
          </div>
          <nav aria-label={`${workspaces[role].roleLabel} navigation`}>
            {workspaceNavigation[role].map(([id, label, Icon]) => (
              <NavLink key={id} to={pathForPage(id)} onClick={() => setMenuOpen(false)}>
                <Icon aria-hidden="true" size={18} strokeWidth={1.8} style={{ flexShrink: 0 }} />
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="workspace-sidebar-footer">
            <strong>{identity?.companyName ?? workspaces[role].roleLabel}</strong>
            <span>{workspaces[role].roleLabel}</span>
            <span>{status}</span>
            {identity && <AccountDetails identity={identity} />}
            {accountAction}
          </div>
        </aside>
        <div className="workspace-main">
          <header className="workspace-header">
            <button
              className="workspace-menu"
              aria-label="Open navigation"
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
              {current?.[1] ?? 'Page not found'}
            </h1>
            <span className="workspace-status">{status}</span>
            {identity && <span className="workspace-company">{identity.companyName}</span>}
            <button
              className="workspace-theme"
              aria-label={light ? 'Use dark theme' : 'Use light theme'}
              onClick={() => setLight(!light)}
            >
              {light ? <Moon aria-hidden="true" size={18} /> : <Sun aria-hidden="true" size={18} />}
            </button>
          </header>
          <main id="workspace-content" className="workspace-content" key={`${role}/${page}`}>
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}

function AccountDetails({ identity }: { identity: NonNullable<WorkspaceLayoutProps['identity']> }) {
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
              onClick={() => void navigator.clipboard.writeText(identity.walletAddress)}
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
    </details>
  );
}
