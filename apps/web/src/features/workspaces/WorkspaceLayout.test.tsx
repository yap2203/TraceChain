// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceLayout } from './WorkspaceLayout';
import {
  workspaceNavigation,
  workspaceNavigationGroups,
  type WorkspaceRole,
} from './workspace-navigation';
import { workspacePath } from './workspace-paths';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'clipboard');
});
const wallet = '0x1000000000000000000000000000000000000001';
function show(page = 'overview', role: WorkspaceRole = 'supplier') {
  return render(
    <MemoryRouter initialEntries={[workspacePath(role, page)]}>
      <WorkspaceLayout
        role={role}
        page={page}
        pathForPage={(id) => workspacePath(role, id)}
        status="Wallet authorized"
        identity={{
          companyName: 'Registered company',
          credentialStatus: 'ACTIVE',
          role,
          walletAddress: wallet,
        }}
        accountAction={<button>Sign out</button>}
      >
        <p>Workspace contents</p>
      </WorkspaceLayout>
    </MemoryRouter>,
  );
}

describe('workspace navigation and guidance', () => {
  it('groups every existing role route exactly once and starts with Overview', () => {
    for (const role of Object.keys(workspaceNavigation) as WorkspaceRole[]) {
      const ids = workspaceNavigationGroups(role).flatMap((group) => group.items.map(([id]) => id));
      expect(ids[0]).toBe('overview');
      expect(new Set(ids).size).toBe(ids.length);
      expect([...ids].sort()).toEqual(workspaceNavigation[role].map(([id]) => id).sort());
    }
  });
  it('preserves canonical links and marks the active page', () => {
    show('batches');
    const navigation = screen.getByRole('navigation', { name: 'Supplier navigation' });
    const link = within(navigation).getByRole('link', { name: 'My ingredients' });
    expect(link.getAttribute('href')).toBe(workspacePath('supplier', 'batches'));
    expect(link.getAttribute('aria-current')).toBe('page');
    expect(within(navigation).getByRole('region', { name: 'Profile' })).toBeTruthy();
  });
  it.each(['supplier', 'manufacturer', 'distributor', 'retailer'] as const)(
    'highlights only the exact information-request page for %s',
    (role) => {
      for (const page of ['requests', 'sent-requests']) {
        const view = show(page, role);
        const nav = screen.getByRole('navigation', { name: /navigation$/ });
        const active = within(nav)
          .getAllByRole('link')
          .filter((link) => link.getAttribute('aria-current') === 'page');
        expect(active).toHaveLength(1);
        expect(active[0].getAttribute('href')).toBe(workspacePath(role, page));
        view.unmount();
      }
    },
  );
  it('shows role-specific quick actions on the overview', () => {
    show('overview', 'manufacturer');
    const quick = screen.getByRole('region', { name: 'Quick actions' });
    expect(
      within(quick)
        .getByRole('link', { name: /Manage products/ })
        .getAttribute('href'),
    ).toBe(workspacePath('manufacturer', 'products'));
    expect(within(quick).getAllByRole('link')).toHaveLength(3);
  });
  it('uses role-specific sidebar destinations instead of a page guidance panel', () => {
    show('orders');
    expect(screen.queryByText('How to use this page')).toBeNull();
    expect(screen.getByRole('link', { name: 'Received requests' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Sent requests' })).toBeTruthy();
  });
  it('closes mobile navigation with Escape and restores focus and scroll', () => {
    show();
    const trigger = screen.getByRole('button', { name: 'Open navigation' });
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.body.style.overflow).toBe('hidden');
    expect(
      screen.getByText('Workspace contents').closest('.workspace-main')?.hasAttribute('inert'),
    ).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.body.style.overflow).toBe('');
    expect(document.activeElement).toBe(trigger);
  });
  it('traps mobile focus and closes after selecting a page', () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    screen.getByRole('button', { name: 'Sign out' }).focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('link', { name: /TraceChain/ }));
    fireEvent.click(screen.getByRole('link', { name: 'Incoming orders' }));
    expect(
      screen.getByRole('button', { name: 'Open navigation' }).getAttribute('aria-expanded'),
    ).toBe('false');
  });
  it('reports wallet-copy success without replacing the page', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    show();
    fireEvent.click(screen.getByText('Account details'));
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe('Wallet address copied.'),
    );
    expect(writeText).toHaveBeenCalledWith(wallet);
    expect(screen.getByText('Workspace contents')).toBeTruthy();
  });
});
