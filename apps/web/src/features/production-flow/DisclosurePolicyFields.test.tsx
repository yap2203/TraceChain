// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, it, expect } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { COMPANY_ALWAYS_CLAIMS, type IngredientRequestPolicy } from '@tracechain/shared';
import { CompanyRequestFields } from './CompanyRequestFields';
import { IngredientRequestPolicyFields } from './IngredientRequestPolicyFields';
import { IngredientClaimValue } from './IngredientClaimValue';
afterEach(cleanup);
it('uses checkbox selection and keeps grouped registration claims together', () => {
  function Form() {
    const [r, setR] = useState<string[]>([...COMPANY_ALWAYS_CLAIMS]);
    const [o, setO] = useState<string[]>([]);
    return (
      <>
        <CompanyRequestFields
          required={r}
          optional={o}
          onChange={(required, optional) => {
            setR(required);
            setO(optional);
          }}
        />
        <output aria-label="required">{r.join(',')}</output>
        <output aria-label="optional">{o.join(',')}</output>
      </>
    );
  }
  render(<Form />);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Company registration number' }));
  expect(screen.getByLabelText('optional').textContent).toBe(
    'companyRegistrationNumber,registrationCountry',
  );
  fireEvent.click(screen.getAllByRole('button', { name: 'Required' })[0]);
  expect(screen.getByLabelText('required').textContent).toContain(
    'companyRegistrationNumber,registrationCountry',
  );
  expect(screen.getByLabelText('required').textContent).toContain('companyName');
  expect(screen.getByLabelText('optional').textContent).toBe('');
  expect(screen.getByRole('checkbox', { name: 'Application reference' })).toBeTruthy();
});
it('uses shared request templates and explicit unknown-allergen policy', () => {
  function Form() {
    const [p, setP] = useState<IngredientRequestPolicy>({ policyVersion: 2, template: 'custom' });
    const [r, setR] = useState<readonly string[]>([]);
    return (
      <>
        <IngredientRequestPolicyFields policy={p} onChange={setP} onRequirements={setR} />
        <output aria-label="required">{r.join(',')}</output>
        <output aria-label="policy">{JSON.stringify(p)}</output>
      </>
    );
  }
  render(<Form />);
  expect(screen.queryByRole('option', { name: 'Quality check' })).toBeNull();
  fireEvent.change(screen.getByLabelText('Request template'), { target: { value: 'basic' } });
  expect(screen.getByLabelText('required').textContent).toBe(
    'countryOfOrigin,productionDate,expiryDate',
  );
  fireEvent.change(screen.getByLabelText('Request template'), { target: { value: 'food' } });
  expect(screen.getByLabelText('required').textContent).toBe('allergenDeclaration');
  const allow = screen.getByRole('checkbox');
  expect((allow as HTMLInputElement).checked).toBe(false);
  fireEvent.click(allow);
  expect(screen.getByLabelText('policy').textContent).toContain('"allowUnknownAllergens":true');
  fireEvent.change(screen.getByLabelText('Request template'), {
    target: { value: 'certification' },
  });
  fireEvent.change(screen.getByLabelText('Certification scope'), {
    target: { value: 'This batch' },
  });
  expect(screen.getByLabelText('policy').textContent).toContain('"scope":"This batch"');
});
it('does not render retired processing or quality values from legacy metadata', () => {
  const { container } = render(
    <>
      <IngredientClaimValue name="processingLocation" value="Legacy processing plant" />
      <IngredientClaimValue name="qualityTest_legacy" value={{ results: 'Legacy result' }} />
      <IngredientClaimValue
        name="originDetails"
        value={{
          countryName: 'Ghana',
          region: 'Ashanti',
          processingLocation: 'Legacy processing plant',
        }}
      />
    </>,
  );
  expect(screen.queryByText('Legacy processing plant')).toBeNull();
  expect(screen.queryByText('Legacy result')).toBeNull();
  expect(screen.getByText('Ghana')).toBeTruthy();
  expect(screen.getByText('Ashanti')).toBeTruthy();
  expect(container.textContent).not.toContain('Processing');
  expect(container.textContent).not.toContain('quality');
});
