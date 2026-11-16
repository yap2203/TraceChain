// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const wallet = '0x1000000000000000000000000000000000000001';
vi.mock('ethers', async (importOriginal) => {
  const original = await importOriginal<typeof import('ethers')>();
  return {
    ...original,
    BrowserProvider: class {
      send() {
        return Promise.resolve([wallet]);
      }
    },
  };
});

import { RegisterCompanyPage } from './RegisterCompanyPage';

describe('company registration logo', () => {
  beforeEach(() => {
    vi.stubGlobal('ethereum', {});
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:company-logo'),
      revokeObjectURL: vi.fn(),
    });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('previews, replaces and removes an optional logo without mixing it with documents', async () => {
    render(
      <MemoryRouter>
        <RegisterCompanyPage />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText('Registered company name *'), {
      target: { value: 'Cocoa Works' },
    });
    const chooser = screen.getByLabelText('Choose company logo');
    const first = new File(['logo'], 'first.webp', { type: 'image/webp' });
    fireEvent.change(chooser, { target: { files: [first] } });
    expect((await screen.findByAltText('Selected company logo preview')).getAttribute('src')).toBe(
      'blob:company-logo',
    );
    expect(screen.getByText('Replace logo')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.queryByAltText('Selected company logo preview')).toBeNull();
    expect(screen.getByText('CW')).toBeTruthy();
    expect(screen.getByText('Choose logo')).toBeTruthy();
  });

  it('shows the selected logo on review while keeping registration optional', async () => {
    render(
      <MemoryRouter>
        <RegisterCompanyPage />
      </MemoryRouter>,
    );
    const values: Array<[string, string]> = [
      ['Registered company name *', 'Cocoa Works'],
      ['Registration number *', 'REG-1'],
      ['Company email *', 'hello@example.com'],
      ['Contact number *', '60123456789'],
      ['Primary dispatch / receiving location name *', 'Main factory'],
      ['Business address *', '1 Supply Road'],
      ['Authorised representative *', 'A. Representative'],
      ['Representative position *', 'Director'],
    ];
    for (const [label, value] of values)
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    fireEvent.change(screen.getByLabelText('Requested supply-chain role *'), {
      target: { value: 'MANUFACTURER' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Connect/ }));
    await waitFor(() => expect(screen.getByText(wallet)).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Choose company logo'), {
      target: {
        files: [new File(['logo'], 'company.webp', { type: 'image/webp' })],
      },
    });
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    for (const label of [
      'Company registration proof',
      'Business licence / role proof',
      'Representative authorisation',
    ])
      fireEvent.change(screen.getByLabelText(new RegExp(label)), {
        target: {
          files: [
            new File(['document'], `${label.replaceAll(' ', '-')}.pdf`, {
              type: 'application/pdf',
            }),
          ],
        },
      });
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    expect(await screen.findByText('Review your application')).toBeTruthy();
    expect(screen.getByAltText('Company logo selected for submission')).toBeTruthy();
    expect(screen.getByText('company.webp')).toBeTruthy();
  });
});
