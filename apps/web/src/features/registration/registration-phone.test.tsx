import { goToContactStep } from './registration.test-helpers';
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it } from 'vitest';
import { RegisterCompanyPage } from './RegisterCompanyPage';

afterEach(cleanup);
const show = () => {
  const result = render(
    <MemoryRouter>
      <RegisterCompanyPage />
    </MemoryRouter>,
  );
  goToContactStep();
  return result;
};

it('offers country selection and formats international phone numbers', () => {
  show();
  const country = screen.getByRole('button', {
    name: 'Contact number country',
  }) as HTMLButtonElement;
  const phone = screen.getByLabelText('Contact number *') as HTMLInputElement;
  expect(country.title).toBe('Malaysia');
  expect(country.querySelector('span')?.getAttribute('aria-hidden')).toBe('true');
  expect(country.querySelector('svg')).toBeTruthy();
  fireEvent.change(phone, { target: { value: '+60123456789' } });
  fireEvent.blur(phone);
  expect(phone.value.replace(/\D/g, '')).toBe('60123456789');
  expect(phone.getAttribute('aria-invalid')).toBe('false');
  fireEvent.click(country);
  expect(screen.getByRole('option', { name: 'Malaysia' }).querySelector('svg')).toBeTruthy();
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search countries' }), {
    target: { value: 'United States' },
  });
  fireEvent.click(screen.getByRole('option', { name: 'United States' }));
  expect(screen.queryByRole('listbox')).toBeNull();
  fireEvent.change(phone, { target: { value: '+12025550123' } });
  fireEvent.blur(phone);
  expect(country.title).toBe('United States');
  expect(country.querySelector('span')?.getAttribute('aria-hidden')).toBe('true');
  expect(country.querySelector('svg')).toBeTruthy();
  expect(phone.value.replace(/\D/g, '')).toBe('12025550123');
  expect(phone.getAttribute('aria-invalid')).toBe('false');
});

it('shows accessible required and invalid-number feedback, then clears it for a valid number', () => {
  show();
  const phone = screen.getByLabelText('Contact number *');
  fireEvent.blur(phone);
  expect(screen.getByRole('alert').textContent).toBe('Contact number is required.');
  fireEvent.change(phone, { target: { value: '+6012' } });
  fireEvent.blur(phone);
  expect(screen.getByRole('alert').textContent).toContain('valid phone number');
  expect(phone.getAttribute('aria-invalid')).toBe('true');
  fireEvent.change(phone, { target: { value: '+60123456789' } });
  expect(screen.queryByText('Enter a valid phone number for the selected country.')).toBeNull();
  expect(phone.getAttribute('aria-invalid')).toBe('false');
});

it('supports country search, keyboard selection and dismissing the dropdown', () => {
  show();
  const country = screen.getByRole('button', { name: 'Contact number country' });
  fireEvent.click(country);
  const search = screen.getByRole('searchbox', { name: 'Search countries' });
  fireEvent.change(search, { target: { value: 'Singapore' } });
  expect(within(screen.getByRole('listbox')).getAllByRole('option')).toHaveLength(1);
  fireEvent.keyDown(search, { key: 'Enter' });
  expect(country.title).toBe('Singapore');
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByRole('listbox')).toBeNull();
  fireEvent.click(country);
  fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' });
  expect(screen.queryByRole('listbox')).toBeNull();
  fireEvent.click(country);
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole('listbox')).toBeNull();
});
