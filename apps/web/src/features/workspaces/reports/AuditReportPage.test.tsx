// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OperationalData } from '../../blockchain/blockchain.api';

const operational = vi.hoisted<{
  data: OperationalData;
  error: string;
  loading: boolean;
  reload: ReturnType<typeof vi.fn>;
}>(() => ({
  data: {
    evidenceRequests: [],
    ingredientBatches: [],
    productBatches: [],
    transfers: [],
  },
  error: '',
  loading: false,
  reload: vi.fn(),
}));

vi.mock('../../blockchain/useOperationalData', () => ({
  useOperationalData: () => operational,
}));

import AuditReport from './AuditReportPage';

describe('on-chain audit report', () => {
  afterEach(() => {
    cleanup();
    operational.data = {
      evidenceRequests: [],
      ingredientBatches: [],
      productBatches: [],
      transfers: [],
    };
    operational.error = '';
    operational.loading = false;
  });

  it('renders current blockchain records without the former sample report', () => {
    operational.data.productBatches = [
      {
        batchId: `0x${'11'.repeat(32)}`,
        expiresAt: 1_900_000_000,
        ingredients: [],
        manufacturer: '0x2000000000000000000000000000000000000002',
        manufacturerName: 'On-chain Manufacturer',
        metadataHash: `0x${'22'.repeat(32)}`,
        producedAt: 1_800_000_000,
        publicCid: 'bafy-product',
        status: 1,
        totalQuantity: '250',
        unit: 'units',
      },
    ];
    render(<AuditReport />);
    expect(screen.getByText('On-chain Audit Report')).toBeTruthy();
    expect(screen.getByText('On-chain Manufacturer')).toBeTruthy();
    expect(screen.getByText('250 units')).toBeTruthy();
    expect(screen.queryByText('Milk Chocolate')).toBeNull();
    expect(screen.queryByText('All Checks Passed — Product Verified')).toBeNull();
  });

  it('shows an honest empty state when the wallet has no associated records', () => {
    render(<AuditReport />);
    expect(screen.getByText('No on-chain records found')).toBeTruthy();
  });
});
