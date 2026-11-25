// @vitest-environment jsdom
import { useState } from 'react';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { it, expect, vi, afterEach } from 'vitest';
const mocks = vi.hoisted(() => ({ upload: vi.fn() }));
vi.mock('./ingredient-batch.api', () => ({ uploadCertificationDocument: mocks.upload }));
import {
  CertificationEditor,
  certificationEntries,
  type CertificationDraft,
} from './CertificationEditor';
function Harness() {
  const [entries, setEntries] = useState<CertificationDraft[]>([]);
  return (
    <>
      <CertificationEditor
        operationId="11111111-1111-4111-8111-111111111111"
        entries={entries}
        setEntries={setEntries}
      />
      <output aria-label="Saved entry IDs">{entries.map((entry) => entry.id).join(',')}</output>
      <output aria-label="Stored document counts">
        {certificationEntries(entries, 'BATCH-1')
          .map((entry) => entry.documents.length)
          .join(',')}
      </output>
    </>
  );
}
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it('keeps stable entry identity when removing a middle certification', () => {
  render(<Harness />);
  for (let i = 0; i < 3; i++) fireEvent.click(screen.getByText('Add certification'));
  const ids = screen.getByLabelText('Saved entry IDs').textContent!.split(',');
  const cards = screen.getAllByText('Remove certification');
  fireEvent.click(cards[1]!);
  expect(screen.getByLabelText('Saved entry IDs').textContent).toBe([ids[0], ids[2]].join(','));
});
it('tracks multiple files separately, retries a failed upload with the same ID, and removes files before issuance', async () => {
  const data =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jDfsAAAAASUVORK5CYII=';
  const file = (name: string) =>
    new File([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], name, { type: 'image/png' });
  mocks.upload.mockImplementation(async (input: any, progress: (n: number) => void) => {
    progress(50);
    if (
      input.fileName === 'retry.png' &&
      mocks.upload.mock.calls.filter((call) => call[0].fileName === 'retry.png').length === 1
    )
      throw new Error('Upload service unavailable.');
    return { ...input, data: undefined, size: 68, sha256: 'ab'.repeat(32), cid: 'bafy-test' };
  });
  render(<Harness />);
  fireEvent.click(screen.getByText('Add certification'));
  fireEvent.change(screen.getByLabelText('Documents for certification 1'), {
    target: { files: [file('ok.png'), file('retry.png')] },
  });
  await screen.findByText('Upload service unavailable.');
  await waitFor(() =>
    expect(screen.getByLabelText('Stored document counts').textContent).toBe('1'),
  );
  const first = mocks.upload.mock.calls.find((call) => call[0].fileName === 'retry.png')![0].id;
  fireEvent.click(screen.getByText('Retry upload'));
  await waitFor(() =>
    expect(screen.getByLabelText('Stored document counts').textContent).toBe('2'),
  );
  expect(
    mocks.upload.mock.calls
      .filter((call) => call[0].fileName === 'retry.png')
      .map((call) => call[0].id),
  ).toEqual([first, first]);
  fireEvent.click(screen.getAllByText('Remove file')[0]!);
  expect(screen.getByLabelText('Stored document counts').textContent).toBe('1');
});
it('rejects unsupported files and excess file counts without pretending persistence succeeded', async () => {
  render(<Harness />);
  fireEvent.click(screen.getByText('Add certification'));
  const input = screen.getByLabelText('Documents for certification 1');
  fireEvent.change(input, {
    target: { files: [new File(['html'], 'unsafe.html', { type: 'text/html' })] },
  });
  await screen.findByText('Use PDF, PNG or JPEG files up to 10 MB each.');
  expect(mocks.upload).not.toHaveBeenCalled();
  fireEvent.change(input, {
    target: {
      files: Array.from({ length: 4 }, () => new File(['file'], 'x.png', { type: 'image/png' })),
    },
  });
  expect(await screen.findByText(/Use up to 3 files/)).toBeTruthy();
  expect(mocks.upload).not.toHaveBeenCalled();
});
