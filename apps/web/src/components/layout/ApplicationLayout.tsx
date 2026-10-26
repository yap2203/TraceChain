import { useState, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';

import { Brand } from '../brand/Brand';
import { AppIcon, type AppIconName } from '../icons/AppIcon';
import { StatusBadge } from '../ui';

export interface NavigationItem {
  icon: AppIconName;
  label: string;
  to: string;
}

interface ApplicationLayoutProps {
  actions?: ReactNode;
  children: ReactNode;
  description: string;
  navigation: readonly NavigationItem[];
  organisation: string;
  roleLabel: string;
  title: string;
}

export function ApplicationLayout({
  actions,
  children,
  description,
  navigation,
  organisation,
  roleLabel,
  title,
}: ApplicationLayoutProps) {
  const [isNavigationOpen, setIsNavigationOpen] = useState(false);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#app-content">
        Skip to content
      </a>

      <aside className={`app-sidebar${isNavigationOpen ? ' is-open' : ''}`}>
        <div className="app-sidebar__top">
          <Link className="app-sidebar__brand" to="/login">
            <Brand />
          </Link>
          <button
            aria-label="Close navigation"
            className="app-sidebar__close"
            onClick={() => setIsNavigationOpen(false)}
            type="button"
          >
            <AppIcon name="close" />
          </button>
        </div>

        <div className="workspace-label">
          <span>Workspace</span>
          <strong>{roleLabel}</strong>
        </div>

        <nav className="app-navigation" aria-label={`${roleLabel} navigation`}>
          {navigation.map((item) => (
            <NavLink
              className={({ isActive }) => (isActive ? 'active' : undefined)}
              key={item.to}
              onClick={() => setIsNavigationOpen(false)}
              to={item.to}
            >
              <AppIcon name={item.icon} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="app-sidebar__footer">
          <span className="organisation-avatar" aria-hidden="true">
            {organisation.charAt(0)}
          </span>
          <span>
            <strong>{organisation}</strong>
            <small>{roleLabel}</small>
          </span>
        </div>
      </aside>

      {isNavigationOpen && (
        <button
          aria-label="Close navigation"
          className="app-sidebar-overlay"
          onClick={() => setIsNavigationOpen(false)}
          type="button"
        />
      )}

      <div className="app-shell__main">
        <header className="app-header">
          <button
            aria-expanded={isNavigationOpen}
            aria-label="Open navigation"
            className="app-header__menu"
            onClick={() => setIsNavigationOpen(true)}
            type="button"
          >
            <AppIcon name="menu" />
          </button>

          <div className="app-header__context">
            <span>{roleLabel}</span>
            <strong>TraceChain workspace</strong>
          </div>

          <div className="wallet-placeholder" aria-label="Wallet status: not connected">
            <span className="wallet-placeholder__dot" />
            <span>
              <small>Wallet</small>
              <strong>Not connected</strong>
            </span>
            <StatusBadge tone="info">Sepolia</StatusBadge>
          </div>
        </header>

        <main className="app-content" id="app-content">
          <header className="page-heading">
            <div>
              <p>{roleLabel}</p>
              <h1>{title}</h1>
              <span>{description}</span>
            </div>
            {actions && <div className="page-heading__actions">{actions}</div>}
          </header>

          {children}
        </main>
      </div>
    </div>
  );
}
