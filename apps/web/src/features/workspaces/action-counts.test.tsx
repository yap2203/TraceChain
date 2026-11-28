// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { authRequestScope, resetAuthRequestScope } from '../auth/auth-request-scope';
import {
  invalidateNavigationActions,
  navigationActionCount,
  observeNavigationData,
  registerActionCountScope,
} from './action-counts';
import { ActionCountBadge } from './shared/ui/ActionCountBadge';
import { shipmentNeedsAction } from '../orders/delivery-state';

afterEach(() => {
  cleanup();
  resetAuthRequestScope();
  vi.unstubAllGlobals();
});
const actor = '0x1000000000000000000000000000000000000001';
const other = '0x2000000000000000000000000000000000000002';
const future = () => Date.now() / 1000 + 3600;

it('isolates roles/wallets, deduplicates actions, and performs no extra requests', () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const scope = authRequestScope();
  const entry = registerActionCountScope(actor, 'manufacturer');
  const order = {
    orderId: 'one',
    seller: actor,
    buyer: other,
    status: 1,
    decision: { status: 0 },
    expiresAt: future(),
  };
  observeNavigationData(
    '?scope=order-list&direction=received',
    { actor, orders: [order, order, { ...order, orderId: 'not-yours', seller: other }] },
    scope,
  );
  expect(navigationActionCount(entry.snapshot, ['product-orders'])).toBe(1);
  observeNavigationData('?scope=order-list&direction=sent', { actor, orders: [] }, scope);
  expect(navigationActionCount(entry.snapshot, ['product-orders'])).toBe(1);
  observeNavigationData(
    '?scope=order-list&direction=received',
    { actor: other, orders: [] },
    scope,
  );
  expect(navigationActionCount(entry.snapshot, ['product-orders'])).toBeNull();
  resetAuthRequestScope();
  const next = registerActionCountScope(other, 'supplier');
  observeNavigationData('?scope=order-list&direction=received', { actor, orders: [order] }, scope);
  expect(navigationActionCount(next.snapshot, ['orders'])).toBeUndefined();
  expect(fetch).not.toHaveBeenCalled();
});

it('updates after completion and a normal cross-device refresh; failures hide old counts', () => {
  const entry = registerActionCountScope(actor, 'distributor'),
    scope = authRequestScope();
  const offer = {
    offerId: 'OFFER',
    distributor: actor,
    sender: other,
    status: 'REQUESTED',
    expiresAt: future(),
  };
  observeNavigationData('/custody-offers', { offers: [offer, offer] }, scope);
  expect(navigationActionCount(entry.snapshot, ['intake'])).toBe(1);
  invalidateNavigationActions();
  expect(navigationActionCount(entry.snapshot, ['intake'])).toBeNull();
  observeNavigationData('/custody-offers', { offers: [{ ...offer, status: 'RECEIVED' }] }, scope);
  expect(navigationActionCount(entry.snapshot, ['intake'])).toBe(0);
  observeNavigationData('/custody-offers', { offers: [offer] }, scope);
  expect(navigationActionCount(entry.snapshot, ['intake'])).toBe(1);
  observeNavigationData('/custody-offers', undefined, scope, true);
  expect(navigationActionCount(entry.snapshot, ['intake'])).toBeNull();
});

it('counts shared/company and ingredient work without double counting or unread semantics', () => {
  const entry = registerActionCountScope(actor, 'supplier'),
    scope = authRequestScope();
  const row = { requestId: 'req', direction: 'received', status: 'REQUESTED', expiresAt: future() };
  observeNavigationData(
    '/information-requests',
    { actor, requests: [row, row, { ...row, requestId: 'done', status: 'VERIFIED' }] },
    scope,
  );
  expect(navigationActionCount(entry.snapshot, ['requests'])).toBeNull();
  observeNavigationData(
    '/operations',
    {
      actorWallet: actor,
      evidenceRequests: [
        { requestId: 'ingredient', supplier: actor, requester: other, status: 1, dueAt: future() },
      ],
    },
    scope,
  );
  expect(navigationActionCount(entry.snapshot, ['requests', 'sent-requests'])).toBe(2);
  observeNavigationData(
    '/information-requests',
    { actor, requests: [{ ...row, status: 'VERIFIED' }] },
    scope,
  );
  expect(navigationActionCount(entry.snapshot, ['requests', 'sent-requests'])).toBe(1);
});

it('uses the same recipient/action rule as shipment Needs action and removes completed receipts', () => {
  const entry = registerActionCountScope(actor, 'retailer'),
    scope = authRequestScope();
  const shipment = {
    shipmentId: 'SHIP',
    kind: 'product',
    status: 1,
    recipient: actor,
    sender: other,
  };
  expect(shipmentNeedsAction(shipment, actor)).toBe(true);
  expect(shipmentNeedsAction(shipment, other)).toBe(false);
  observeNavigationData(
    '?scope=shipment-workspace',
    { actor, orders: [], logistics: { shipments: [shipment, shipment] } },
    scope,
  );
  expect(navigationActionCount(entry.snapshot, ['shipments'])).toBe(1);
  observeNavigationData(
    '?scope=shipment-workspace',
    { actor, orders: [], logistics: { shipments: [{ ...shipment, status: 2 }] } },
    scope,
  );
  expect(navigationActionCount(entry.snapshot, ['shipments'])).toBe(0);
});

it('uses server aggregate order counts and a consistent accessible 99+ badge', () => {
  const entry = registerActionCountScope(actor, 'supplier'),
    scope = authRequestScope();
  observeNavigationData(
    '?scope=order-list&direction=received',
    { actor, orders: [], pagination: { counts: { attention: 150 } } },
    scope,
  );
  render(
    <ActionCountBadge count={navigationActionCount(entry.snapshot, ['orders'])} label="Orders" />,
  );
  expect(screen.getByText('99+')).toBeTruthy();
  expect(screen.getByLabelText('More than 99 actions required for Orders')).toBeTruthy();
  cleanup();
  render(<ActionCountBadge count={0} label="Orders" />);
  expect(screen.queryByText('0')).toBeNull();
});
