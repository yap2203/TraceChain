// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TechnicalIdentifier } from '../workspaces/shared/ui';
import { RequestedFields, ingredientRequestedRows, verificationBadge } from './EvidenceIdentity';

afterEach(cleanup);

it('marks requested fields as shared, missing (required) or not shared', () => {
  const rows = ingredientRequestedRows({
    requestedClaims: ['countryOfOrigin', 'certifications', 'productionDate'],
    requiredClaims: ['countryOfOrigin', 'certifications'],
    sharedClaims: { ['certification_' + 'a'.repeat(32)]: { name: 'Organic' } },
  });
  expect(rows.map((row) => [row.claim, row.state])).toEqual([
    ['countryOfOrigin', 'missing'],
    ['certifications', 'shared'],
    ['productionDate', 'notShared'],
  ]);
  render(<RequestedFields title="Requested fields" rows={rows} />);
  expect(screen.getByText('1 of 3 shared')).toBeTruthy();
  expect(screen.getByText('Missing')).toBeTruthy();
});

it('never labels unverified evidence as verified', () => {
  expect(verificationBadge('NOT_VERIFIED').label).toBe('Not verified yet');
  expect(verificationBadge(undefined).label).toBe('Not verified yet');
  expect(verificationBadge('PASSED')).toEqual({
    label: 'Verification passed',
    variant: 'verified',
  });
});

it('shortens an identifier for display but copies and expands the full value', async () => {
  const value = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  render(<TechnicalIdentifier label="Supplier wallet" value={value} />);
  expect(screen.queryByText(value)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Copy Supplier wallet' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(value));
  fireEvent.click(screen.getByRole('button', { name: 'Show full Supplier wallet' }));
  expect(screen.getByText(value)).toBeTruthy();
});
