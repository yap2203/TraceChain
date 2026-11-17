import {
  fillCompanyDetails,
  fillContactDetails,
  continueRegistration,
  goToWalletStep,
} from './registration.test-helpers';
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  it('allows selecting progress steps while directing incomplete applications to the first missing section', async () => {
    render(
      <MemoryRouter>
        <RegisterCompanyPage />
      </MemoryRouter>,
    );
    const next = screen.getByRole('button', { name: 'Continue' });
    expect(next.querySelector('.ui-button__label svg')).toBeNull();
    expect(next.lastElementChild?.tagName.toLowerCase()).toBe('svg');
    fireEvent.click(screen.getByRole('button', { name: 'Step 4: Supporting documents' }));
    expect(screen.getByRole('heading', { name: 'Company details' })).toBeTruthy();
    expect(screen.getByText('Registered company name is required.')).toBeTruthy();
    fillCompanyDetails();
    fireEvent.click(screen.getByRole('button', { name: 'Step 4: Supporting documents' }));
    expect(screen.getByRole('heading', { name: 'Contact & representative' })).toBeTruthy();
    fillContactDetails();
    fireEvent.click(screen.getByRole('button', { name: 'Step 3: Wallet & identity' }));
    fireEvent.click(screen.getByRole('button', { name: 'Connect MetaMask' }));
    await screen.findByText(wallet);
    fireEvent.click(screen.getByRole('button', { name: 'Step 4: Supporting documents' }));
    expect(screen.getByRole('heading', { name: 'Supporting documents' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Step 1: Company details' }));
    expect(screen.getByDisplayValue('Cocoa Works')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Step 5: Review & submit' }));
    expect(screen.getByRole('heading', { name: 'Supporting documents' })).toBeTruthy();
    expect(screen.getByText('Upload all three required supporting documents.')).toBeTruthy();
  });
  it('validates the current step only and preserves values when navigating back', () => {
    render(
      <MemoryRouter>
        <RegisterCompanyPage />
      </MemoryRouter>,
    );
    fillCompanyDetails();
    continueRegistration();
    expect(screen.getByRole('heading', { name: 'Contact & representative' })).toBeTruthy();
    fillContactDetails();
    fireEvent.change(screen.getByLabelText('Company email *'), { target: { value: 'invalid' } });
    continueRegistration();
    expect(screen.getByRole('heading', { name: 'Contact & representative' })).toBeTruthy();
    expect(screen.getByText('Enter a valid company email address.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Company email *'), {
      target: { value: 'hello@example.com' },
    });
    continueRegistration();
    expect(screen.getByRole('heading', { name: 'Wallet & identity' })).toBeTruthy();
    expect(screen.queryByLabelText('Company email *')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Back/ }));
    expect(screen.getByDisplayValue('hello@example.com')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Back/ }));
    expect(screen.getByDisplayValue('Cocoa Works')).toBeTruthy();
    expect(screen.getByDisplayValue('1 Supply Road')).toBeTruthy();
    expect(screen.getByText('Step 1 of 5')).toBeTruthy();
  });
  it('groups the registration fields into recognizable company, contact, location, representative and wallet categories', () => {
    render(
      <MemoryRouter>
        <RegisterCompanyPage />
      </MemoryRouter>,
    );
    const company = screen.getByRole('group', { name: 'Company details' });
    expect(within(company).getByLabelText('Registered company name *')).toBeTruthy();
    expect(within(company).getByLabelText('Business address *')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Contact details' })).toBeNull();
    fillCompanyDetails();
    continueRegistration();
    const contact = screen.getByRole('group', { name: 'Contact details' });
    expect(within(contact).getByLabelText('Company email *')).toBeTruthy();
    expect(within(contact).getByLabelText('Contact number *')).toBeTruthy();
    expect(
      within(screen.getByRole('group', { name: 'Authorised representative' })).getByLabelText(
        'Representative position *',
      ),
    ).toBeTruthy();
    fillContactDetails();
    continueRegistration();
    expect(screen.queryByRole('group', { name: 'Dispatch & receiving location' })).toBeNull();
    expect(screen.queryByLabelText('Dispatch / receiving address *')).toBeNull();
    expect(
      within(screen.getByRole('group', { name: 'Wallet & digital identity' })).getByRole('button', {
        name: 'Connect MetaMask',
      }),
    ).toBeTruthy();
  });
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
    fillCompanyDetails();
    fireEvent.change(screen.getByLabelText('Choose company logo'), {
      target: { files: [new File(['logo'], 'company.webp', { type: 'image/webp' })] },
    });
    continueRegistration();
    fillContactDetails();
    continueRegistration();
    fireEvent.click(screen.getByRole('button', { name: /Connect/ }));
    await waitFor(() => expect(screen.getByText(wallet)).toBeTruthy());
    continueRegistration();
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
    fireEvent.change(screen.getByLabelText(/Optional certifications/), {
      target: { files: [new File(['png'], 'certificate.png', { type: 'image/png' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    expect(await screen.findByText('Review your application')).toBeTruthy();
    expect(screen.getByAltText('Company logo selected for submission')).toBeTruthy();
    expect(screen.getByText('company.webp')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Submit application' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Preview Company-registration-proof.pdf' }));
    expect(screen.getByRole('dialog', { name: 'Document preview' })).toBeTruthy();
    expect(screen.getByTitle('Selected PDF document').getAttribute('sandbox')).toBe('');
    expect(
      screen.getByRole('link', { name: 'Download selected file' }).getAttribute('download'),
    ).toBe('Company-registration-proof.pdf');
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:company-logo');
    fireEvent.click(screen.getByRole('button', { name: 'Preview certificate.png' }));
    expect(screen.getByAltText('Selected document: certificate.png')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Change documents' }));
    expect(screen.getByText('3 of 3 required documents selected')).toBeTruthy();
    continueRegistration();
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
  });

  it('shows document progress, replacement, per-slot errors and preserved selected states', async () => {
    render(
      <MemoryRouter>
        <RegisterCompanyPage />
      </MemoryRouter>,
    );
    fillCompanyInformation();
    fireEvent.click(screen.getByRole('button', { name: /Connect/ }));
    await waitFor(() => expect(screen.getByText(wallet)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));

    expect(screen.getByText('0 of 3 required documents selected')).toBeTruthy();
    const registration = screen.getByLabelText(/Company registration proof/);
    const longPdfName = `${'company-registration-'.repeat(8)}proof.pdf`;
    fireEvent.change(registration, {
      target: { files: [new File(['pdf'], longPdfName, { type: 'application/pdf' })] },
    });
    expect(screen.getByText('1 of 3 required documents selected')).toBeTruthy();
    expect(screen.getByText('File selected')).toBeTruthy();
    expect(screen.getByText(longPdfName).getAttribute('title')).toBe(longPdfName);
    expect(registration.closest('label')?.classList.contains('document-upload--selected')).toBe(
      true,
    );

    fireEvent.change(screen.getByLabelText(/Optional certifications/), {
      target: {
        files: [new File(['optional'], 'optional.pdf', { type: 'application/pdf' })],
      },
    });
    expect(screen.getByText('1 of 3 required documents selected')).toBeTruthy();

    fireEvent.change(registration, {
      target: {
        files: [new File(['replacement'], 'replacement.png', { type: 'image/png' })],
      },
    });
    expect(screen.queryByText(longPdfName)).toBeNull();
    expect(screen.getByText('replacement.png')).toBeTruthy();
    expect(screen.getAllByText('Change file').length).toBeGreaterThanOrEqual(2);

    fireEvent.change(registration, {
      target: { files: [new File(['invalid'], 'rejected.txt', { type: 'text/plain' })] },
    });
    expect(screen.getByText('The selected file type is not supported.')).toBeTruthy();
    expect(registration.getAttribute('aria-invalid')).toBe('true');
    expect(registration.closest('label')?.classList.contains('document-upload--selected')).toBe(
      false,
    );
    expect(screen.getByText('0 of 3 required documents selected')).toBeTruthy();

    for (const [label, name, type] of [
      [/Company registration proof/, 'registration.pdf', 'application/pdf'],
      [/Business licence \/ role proof/, 'licence.jpg', 'image/jpeg'],
      [/Representative authorisation/, 'authorisation.png', 'image/png'],
    ] as const)
      fireEvent.change(screen.getByLabelText(label), {
        target: { files: [new File(['valid'], name, { type })] },
      });
    expect(screen.getByText('3 of 3 required documents selected')).toBeTruthy();
    expect(screen.queryByText('The selected file type is not supported.')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    expect(await screen.findByText('Review your application')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Back/ }));
    expect(screen.getByText('3 of 3 required documents selected')).toBeTruthy();
    expect(screen.getAllByText('File selected')).toHaveLength(4);
  });
});

function fillCompanyInformation() {
  goToWalletStep();
}
