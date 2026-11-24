// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it } from 'vitest';
import type { EvidenceClaimDefinition } from '@tracechain/shared';
import {
  classifyEvidenceClaims,
  evidenceClaimLists,
  EvidenceClaimSelector,
  type ClaimClassification,
} from './EvidenceClaimSelector';

const catalogue: readonly EvidenceClaimDefinition[] = [
  { id: 'alpha', label: 'Alpha', group: 'Claims', credentialPath: 'alpha' },
  { id: 'beta', label: 'Beta', group: 'Claims', credentialPath: 'beta' },
  { id: 'gamma', label: 'Gamma', group: 'Claims', credentialPath: 'gamma' },
];

afterEach(cleanup);

function Harness() {
  const [fields, setFields] = useState<Record<string, ClaimClassification>>(() =>
    classifyEvidenceClaims(catalogue.map((claim) => claim.id), [], []),
  );
  const lists = evidenceClaimLists(fields);
  return (
    <>
      <EvidenceClaimSelector
        catalogue={catalogue}
        required={lists.required}
        optional={lists.optional}
        onChange={(required, optional) =>
          setFields(
            classifyEvidenceClaims(
              catalogue.map((claim) => claim.id),
              required,
              optional,
            ),
          )
        }
      />
      <output aria-label="required claims">{lists.required.join(',')}</output>
      <output aria-label="optional claims">{lists.optional.join(',')}</output>
    </>
  );
}

function lists() {
  return {
    required: screen.getByLabelText('required claims').textContent,
    optional: screen.getByLabelText('optional claims').textContent,
  };
}

it('selects a field as Optional and then switches it to Required', () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Alpha' }));
  expect(lists()).toEqual({ required: '', optional: 'alpha' });
  fireEvent.click(within(screen.getByRole('group', { name: 'Alpha requirement' })).getByRole('button', { name: 'Required' }));
  expect(lists()).toEqual({ required: 'alpha', optional: '' });
});

it('switches a Required field to Optional without retaining overlap', () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Alpha' }));
  const requirement = screen.getByRole('group', { name: 'Alpha requirement' });
  fireEvent.click(within(requirement).getByRole('button', { name: 'Required' }));
  fireEvent.click(within(requirement).getByRole('button', { name: 'Optional' }));
  expect(lists()).toEqual({ required: '', optional: 'alpha' });
});

it('deselects either classification from both collections', () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Alpha' }));
  fireEvent.click(within(screen.getByRole('group', { name: 'Alpha requirement' })).getByRole('button', { name: 'Required' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Alpha' }));
  expect(lists()).toEqual({ required: '', optional: '' });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Beta' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Beta' }));
  expect(lists()).toEqual({ required: '', optional: '' });
});

it('keeps Select all exclusive when classifications change', () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
  expect(lists()).toEqual({ required: '', optional: 'alpha,beta,gamma' });
  fireEvent.click(within(screen.getByRole('group', { name: 'Beta requirement' })).getByRole('button', { name: 'Required' }));
  expect(lists()).toEqual({ required: 'beta', optional: 'alpha,gamma' });
});

it('deduplicates input and resolves an existing overlap to Required', () => {
  const fields = classifyEvidenceClaims(
    catalogue.map((claim) => claim.id),
    ['alpha', 'alpha'],
    ['alpha', 'beta', 'beta'],
  );
  expect(evidenceClaimLists(fields)).toEqual({ required: ['alpha'], optional: ['beta'] });
});
