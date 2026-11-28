import { authRequestScope, resetAuthRequestScope } from '../auth/auth-request-scope';
import { observeNavigationData } from './action-counts';
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceLayout } from './WorkspaceLayout';
import { WorkspaceGuide } from './WorkspaceGuide';
import {
  workspaceNavigation,
  workspaceNavigationGroups,
  type WorkspaceRole,
} from './workspace-navigation';
import { workspacePath } from './workspace-paths';

afterEach(() => {
  cleanup();
  resetAuthRequestScope();
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
      expect(workspaceNavigation[role].map(([id]) => id)).toEqual(expect.arrayContaining(ids));
    }
  });
  it('preserves canonical links and marks the active page', () => {
    show('batches');
    const navigation = screen.getByRole('navigation', { name: 'Supplier navigation' });
    const link = within(navigation).getByRole('link', { name: 'My ingredients' });
    expect(link.getAttribute('href')).toBe(workspacePath('supplier', 'batches'));
    expect(link.getAttribute('aria-current')).toBe('page');
    expect(within(navigation).getByRole('region', { name: 'Company' })).toBeTruthy();
  });
  it('shows merged pages as one sidebar entry with tabs for each page', () => {
    show('product-orders', 'manufacturer');
    const navigation = screen.getByRole('navigation', { name: 'Manufacturer navigation' });
    const orders = within(navigation).getByRole('link', { name: 'Orders' });
    expect(orders.getAttribute('href')).toBe(workspacePath('manufacturer', 'orders'));
    expect(orders.getAttribute('aria-current')).toBe('page');
    expect(
      within(navigation).queryByRole('link', { name: 'Product requests from Retailers' }),
    ).toBeNull();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Orders');
    expect(
      screen
        .getByRole('tab', { name: 'Product requests from Retailers' })
        .getAttribute('aria-selected'),
    ).toBe('true');
    expect(screen.getByRole('tab', { name: 'Ingredient requests to Suppliers' })).toBeTruthy();
  });
  it('moves focus between section tabs with arrow keys without opening them', () => {
    show('product-orders', 'manufacturer');
    const selling = screen.getByRole('tab', { name: 'Product requests from Retailers' });
    const buying = screen.getByRole('tab', { name: 'Ingredient requests to Suppliers' });
    expect(selling.tabIndex).toBe(0);
    expect(buying.tabIndex).toBe(-1);
    selling.focus();
    fireEvent.keyDown(selling, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(buying);
    expect(selling.getAttribute('aria-selected')).toBe('true');
  });
  it.each(['supplier', 'manufacturer', 'distributor', 'retailer'] as const)(
    'highlights only the exact information-request page for %s',
    (role) => {
      for (const page of ['requests']) {
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
    render(
      <MemoryRouter initialEntries={[workspacePath('manufacturer', 'overview')]}>
        <WorkspaceGuide />
      </MemoryRouter>,
    );
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
    expect(screen.getByRole('link', { name: 'Evidence Exchange' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Sent requests' })).toBeNull();
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
    fireEvent.click(screen.getByRole('link', { name: 'Ingredient requests from Manufacturers' }));
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

it('shares an accessible red needs-action count between sidebar and destination tabs', async () => {
  show('product-orders', 'manufacturer');
  const pending = {
    orderId: 'only-once',
    seller: wallet,
    buyer: 'other',
    status: 1,
    decision: { status: 0 },
    expiresAt: Date.now() / 1000 + 3600,
  };
  act(() =>
    observeNavigationData(
      '?scope=order-list&direction=received',
      { actor: wallet, orders: [pending, pending] },
      authRequestScope(),
    ),
  );
  expect(screen.getByRole('link', { name: 'Orders, 1 action required' })).toBeTruthy();
  expect(
    screen.getByRole('tab', { name: 'Product requests from Retailers, 1 action required' }),
  ).toBeTruthy();
  act(() =>
    observeNavigationData(
      '?scope=order-list&direction=received',
      undefined,
      authRequestScope(),
      true,
    ),
  );
  expect(screen.getByRole('link', { name: 'Orders, action count unavailable' })).toBeTruthy();
  act(() =>
    observeNavigationData(
      '?scope=order-list&direction=received',
      { actor: wallet, orders: [{ ...pending, decision: { status: 1 } }] },
      authRequestScope(),
    ),
  );
  expect(screen.getByRole('link', { name: 'Orders' })).toBeTruthy();
  expect(document.querySelector('.workspace-action-count')).toBeNull();
});
