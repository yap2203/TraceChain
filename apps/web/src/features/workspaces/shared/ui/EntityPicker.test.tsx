// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { EntityPicker, type EntityOption } from './EntityPicker';

afterEach(cleanup);

const options: EntityOption[] = [
  {
    id: 'a',
    title: 'Cocoa powder',
    subtitle: 'Batch COCOA-001',
    facts: [{ label: 'Available', value: '50 kg' }],
  },
  {
    id: 'b',
    title: 'Cocoa powder',
    subtitle: 'Batch COCOA-002',
    disabledReason: 'This batch has expired.',
  },
  { id: 'c', title: 'Milk powder', subtitle: 'Batch MILK-001' },
];

function Harness() {
  const [value, setValue] = useState('');
  return (
    <>
      <EntityPicker
        label="Your stock"
        value={value}
        onChange={setValue}
        options={options}
        dialogTitle="Choose stock"
        chooseLabel="Choose stock"
        confirmLabel="Use this stock"
        searchPlaceholder="Search stock"
        emptyText="No stock"
      />
      <output aria-label="value">{value}</output>
    </>
  );
}

it('searches, blocks unavailable records with a reason, confirms and keeps the search on reopen', () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: /Choose stock/ }));
  expect(screen.getByText('3 matches')).toBeTruthy();
  fireEvent.change(screen.getByPlaceholderText('Search stock'), { target: { value: 'cocoa' } });
  expect(screen.getByText('2 matches')).toBeTruthy();
  const expired = screen.getByRole('button', { name: /COCOA-002/ }) as HTMLButtonElement;
  expect(expired.disabled).toBe(true);
  expect(screen.getByText('This batch has expired.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /COCOA-001/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Use this stock' }));
  expect(screen.getByLabelText('value').textContent).toBe('a');
  // Selected summary shows the distinguishing reference, with a Change action.
  expect(screen.getByText('Batch COCOA-001')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Change' }));
  expect((screen.getByPlaceholderText('Search stock') as HTMLInputElement).value).toBe('cocoa');
});
