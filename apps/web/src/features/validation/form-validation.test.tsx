// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  calendarDate,
  futureDateError,
  productionDateError,
  quantityError,
  referenceError,
  textError,
  uploadError,
} from './form-validation';
import { Input, SelectField } from '../workspaces/shared/ui';
import { RegisterBatch } from '../workspaces/supplier/batches/RegisterBatchPage';
afterEach(cleanup);

describe('form validation', () => {
  it('rejects whitespace, oversized fields, malformed references and non-integer quantities', () => {
    expect(textError('   ', 'Company', 200)).toContain('required');
    expect(textError('x'.repeat(201), 'Company', 200)).toContain('200');
    for (const value of ['0', '-1', '01', '1.5', '1e3', '0x10', '9'.repeat(40)])
      expect(quantityError(value)).not.toBe('');
    expect(quantityError('50', 'Quantity', '40')).toContain('exceeds');
    expect(quantityError('40', 'Quantity', '40')).toBe('');
    expect(referenceError('bad ref !')).not.toBe('');
    expect(referenceError('BATCH-2026/001')).toBe('');
  });
  it('validates calendar dates, ordering, production time and arrival deadlines', () => {
    const now = new Date('2026-11-11T12:00:00Z');
    expect(Number.isNaN(calendarDate('2026-02-30'))).toBe(true);
    expect(futureDateError('2026-11-10', 'Arrival', now)).toContain('past');
    expect(futureDateError('2026-11-11', 'Arrival', now)).toBe('');
    expect(productionDateError('2026-11-12', '2026-12-01', now)).toContain('future');
    expect(productionDateError('2026-11-10', '2026-11-09', now)).not.toBe('');
    expect(productionDateError('2026-11-01', '2026-12-01', now)).toBe('');
  });
  it('rejects empty, oversized and unsupported uploads', () => {
    const validate = (file: File) =>
      uploadError(file, 1024 * 1024, /\.json$/i, ['application/json']);
    expect(validate(new File([], 'kit.json', { type: 'application/json' }))).toContain('empty');
    expect(validate(new File(['x'], 'kit.exe', { type: 'application/json' }))).toContain('type');
    expect(validate(new File(['x'], 'kit.json', { type: 'text/html' }))).toContain('type');
    expect(
      validate(new File(['x'.repeat(1024 * 1024 + 1)], 'kit.json', { type: 'application/json' })),
    ).toContain('exceeds');
    expect(validate(new File(['{}'], 'kit.json', { type: 'application/json' }))).toBe('');
  });
  it('shows accessible errors for required fields and select values', () => {
    render(
      <>
        <Input label="Company" value="   " onChange={() => {}} required />
        <SelectField
          label="Role"
          value=""
          onChange={() => {}}
          required
          options={[{ value: '', label: 'Select role' }]}
        />
      </>,
    );
    fireEvent.blur(screen.getByLabelText(/Company/));
    expect(screen.getByLabelText(/Company/).getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('Company is required.')).toBeTruthy();
    fireEvent.blur(screen.getByLabelText(/Role/));
    expect(screen.getByLabelText(/Role/).getAttribute('aria-invalid')).toBe('true');
  });
  it('blocks incomplete ingredient registration before API or MetaMask calls', () => {
    const prepare = vi.fn();
    const sign = vi.fn();
    render(<RegisterBatch onBack={() => {}} prepareWorkflow={prepare} submitTransaction={sign} />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue to review' }));
    expect(screen.getByText('Ingredient name is required.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Register with MetaMask' })).toBeNull();
    expect(prepare).not.toHaveBeenCalled();
    expect(sign).not.toHaveBeenCalled();
  });
});
