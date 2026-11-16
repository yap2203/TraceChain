// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ApplicationDocumentsPanel } from './ApplicationDocumentsPanel';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it('loads authorized filenames and previews/downloads only after an explicit action', async () => {
  const fetchMock = vi.fn(
    async (url: string) =>
      new Response(
        url.endsWith('/0')
          ? '%PDF-1.7\nprivate'
          : JSON.stringify({
              documents: [
                {
                  kind: 'registrationProof',
                  fileName: 'company.pdf',
                  mimeType: 'application/pdf',
                  size: 120,
                  index: 0,
                },
              ],
            }),
      ),
  );
  vi.stubGlobal('fetch', fetchMock);
  const create = vi.fn(() => 'blob:test-preview'),
    revoke = vi.fn();
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
  render(<ApplicationDocumentsPanel applicationId="0x123" readOnly />);
  expect(await screen.findByText(/company.pdf/)).toBeTruthy();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'View document' }));
  expect(await screen.findByTitle('Document preview')).toBeTruthy();
  expect(fetchMock.mock.calls[1]![0]).toContain('/0');
  expect(screen.queryByText('Save supporting documents')).toBeNull();
  cleanup();
  expect(revoke).toHaveBeenCalledWith('blob:test-preview');
});
it('allows applicants to attach the three missing legacy files and sends their actual contents', async () => {
  let saved = false;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/me'))
      return new Response(JSON.stringify({ applications: [{ id: '0x123', status: 'pending' }] }));
    if (init?.method === 'POST') {
      saved = true;
      return new Response('{}');
    }
    return new Response(
      JSON.stringify({
        documents: saved
          ? [
              {
                kind: 'registrationProof',
                fileName: 'proof.pdf',
                size: 12,
                index: 0,
                mimeType: 'application/pdf',
              },
            ]
          : [],
      }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<ApplicationDocumentsPanel />);
  expect(await screen.findByText(/Earlier registration versions/)).toBeTruthy();
  const save = screen.getByRole('button', {
    name: 'Save supporting documents',
  }) as HTMLButtonElement;
  expect(save.disabled).toBe(true);
  for (const label of ['Company registration', 'Business proof', 'Authorisation proof']) {
    fireEvent.change(screen.getByLabelText(new RegExp(label)), {
      target: {
        files: [new File(['%PDF-1.7\nprivate'], 'proof.pdf', { type: 'application/pdf' })],
      },
    });
  }
  fireEvent.click(save);
  await waitFor(() => expect(saved).toBe(true));
  const init = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')![1]!;
  const payload = JSON.parse(init.body as string);
  expect(payload.documents).toHaveLength(3);
  expect(atob(payload.documents[0].data)).toBe('%PDF-1.7\nprivate');
  expect(await screen.findByText(/proof.pdf/)).toBeTruthy();
});
it('shows a readable authorization error without exposing private file contents', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: { message: 'Application documents are not available to this wallet.' },
          }),
          { status: 404 },
        ),
    ),
  );
  render(<ApplicationDocumentsPanel applicationId="0x123" readOnly />);
  expect(
    await screen.findByText('Application documents are not available to this wallet.'),
  ).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'View document' })).toBeNull();
});
