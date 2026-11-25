import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import type { IngredientCertification, CertificationDocument } from '@tracechain/shared';
import { Btn, Input, SelectField, Modal, Alert } from '../../shared/ui';
import { uploadCertificationDocument } from './ingredient-batch.api';
import { readableError } from '../../../../components/ui/feedback';

export interface CertificationFileDraft {
  id: string;
  file: File;
  status: 'uploading' | 'stored' | 'failed';
  progress: number;
  error?: string;
  document?: CertificationDocument;
}
export interface CertificationDraft extends Omit<IngredientCertification, 'documents'> {
  files: CertificationFileDraft[];
}
// "This batch" always covers the batch being registered, so its reference is not typed.
export const certificationEntries = (
  drafts: CertificationDraft[],
  batchReference: string,
): IngredientCertification[] =>
  drafts.map(({ files, ...entry }) => ({
    ...entry,
    scopeReference:
      entry.scope === 'This batch' ? batchReference : entry.scopeReference?.trim() || undefined,
    documents: files.flatMap((file) => (file.document ? [file.document] : [])),
  }));
export function certificationError(entries: CertificationDraft[]) {
  if (entries.length > 20) return 'Use at most 20 certifications.';
  const files = entries.flatMap((entry) => entry.files);
  if (files.length > 20 || files.reduce((sum, item) => sum + item.file.size, 0) > 20 * 1024 * 1024)
    return 'Use at most 20 files and 20 MB total.';
  for (const entry of entries) {
    if (!entry.name.trim() || !entry.issuer.trim() || !entry.reference.trim())
      return 'Each certification needs a name, issuer and certificate reference.';
    if (entry.scope !== 'Company' && entry.scope !== 'This batch' && !entry.scopeReference?.trim())
      return 'Identify the facility, ingredient or batch covered by each certification.';
    if (!entry.noExpiry && !entry.expiryDate)
      return 'Enter certification expiry or select No expiry stated.';
    if (entry.noExpiry && entry.expiryDate)
      return 'Clear expiry when No expiry stated is selected.';
    if (entry.issueDate && entry.expiryDate && entry.expiryDate < entry.issueDate)
      return 'Certification expiry must follow issue date.';
    if (!entry.files.length)
      return 'Attach at least one supporting document to each certification.';
    if (entry.files.some((file) => file.status !== 'stored'))
      return 'Finish or retry certification document uploads before continuing.';
  }
  return '';
}
export async function fileData(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]!);
    reader.onerror = () => reject(new Error('The file could not be read.'));
    reader.readAsDataURL(file);
  });
}
export async function validateCertificationFile(file: File) {
  if (
    !['application/pdf', 'image/png', 'image/jpeg'].includes(file.type) ||
    file.size === 0 ||
    file.size > 10 * 1024 * 1024
  )
    throw new Error('Use PDF, PNG or JPEG files up to 10 MB each.');
  const data = await fileData(file),
    bytes = atob(data);
  const valid =
    file.type === 'application/pdf'
      ? /\.pdf$/i.test(file.name) &&
        bytes.startsWith('%PDF-') &&
        bytes.slice(-1024).includes('%%EOF')
      : file.type === 'image/png'
        ? /\.png$/i.test(file.name) &&
          bytes.startsWith('\x89PNG\r\n\x1a\n') &&
          bytes.slice(-12).includes('IEND')
        : /\.jpe?g$/i.test(file.name) &&
          bytes.startsWith('\xff\xd8\xff') &&
          bytes.endsWith('\xff\xd9');
  if (!valid) throw new Error('The file is corrupt or its type/extension does not match.');
  return data;
}
export function CertificationEditor({
  entries,
  setEntries,
  operationId,
  sourceFile,
  showErrors = false,
  disabled = false,
  readOnly = false,
  batchReference = '',
}: {
  entries: CertificationDraft[];
  setEntries: Dispatch<SetStateAction<CertificationDraft[]>>;
  operationId: string;
  batchReference?: string;
  sourceFile?: File;
  showErrors?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
}) {
  const [error, setError] = useState(''),
    [preview, setPreview] = useState<{ url: string; file: File }>();
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview.url);
    },
    [preview],
  );
  const patch = (id: string, values: Partial<CertificationDraft>) =>
    setEntries((current) =>
      current.map((entry) => (entry.id === id ? { ...entry, ...values } : entry)),
    );
  const upload = async (entryId: string, item: CertificationFileDraft) => {
    const update = (values: Partial<CertificationFileDraft>) =>
      setEntries((current) =>
        current.map((entry) =>
          entry.id === entryId
            ? {
                ...entry,
                files: entry.files.map((file) =>
                  file.id === item.id ? { ...file, ...values } : file,
                ),
              }
            : entry,
        ),
      );
    update({ status: 'uploading', error: undefined, progress: 0 });
    try {
      const data = await validateCertificationFile(item.file);
      const document = await uploadCertificationDocument(
        {
          id: item.id,
          operationId,
          certificationId: entryId,
          fileName: item.file.name,
          mimeType: item.file.type,
          data,
        },
        (progress) => update({ progress }),
      );
      update({ status: 'stored', progress: 100, document });
    } catch (cause) {
      update({ status: 'failed', error: readableError(cause, 'Upload failed. Retry this file.') });
    }
  };
  const addFiles = (entry: CertificationDraft, files: File[]) => {
    const all = entries.flatMap((value) => value.files);
    if (
      entry.files.length + files.length > 3 ||
      all.length + files.length > 20 ||
      [...all.map((value) => value.file), ...files].reduce((sum, file) => sum + file.size, 0) >
        20 * 1024 * 1024
    ) {
      setError('Use up to 3 files per certification, 20 files and 20 MB in total.');
      return;
    }
    setError('');
    const drafts = files.map((file) => ({
      id: crypto.randomUUID(),
      file,
      status: 'uploading' as const,
      progress: 0,
    }));
    patch(entry.id, { files: [...entry.files, ...drafts] });
    drafts.forEach((item) => void upload(entry.id, item));
  };
  return (
    <div className="ingredient-certifications">
      <p className="ingredient-help">
        Supplier-provided certifications. Not independently verified by the stated authority.
      </p>
      {error && <Alert type="error" message={error} />}
      {!entries.length && <p>No certifications supplied.</p>}
      {entries.map((entry, index) => (
        <details
          key={entry.id}
          open={!readOnly && index === entries.length - 1}
          className="ingredient-certification-card"
        >
          <summary>
            {entry.name || `Certification ${index + 1}`} · {entry.scope} · {entry.files.length}{' '}
            {entry.files.length === 1 ? 'document' : 'documents'}
            {!readOnly && ' · Edit'}
          </summary>
          {!readOnly ? (
            <>
              <div className="workspace-form-grid">
                <SelectField
                  label="Certification type"
                  value={
                    ['Organic', 'Halal', 'Fair Trade', 'HACCP', 'GMP', 'ISO 22000'].includes(
                      entry.name,
                    )
                      ? entry.name
                      : 'Other'
                  }
                  onChange={(name) => patch(entry.id, { name: name === 'Other' ? '' : name })}
                  options={[
                    'Organic',
                    'Halal',
                    'Fair Trade',
                    'HACCP',
                    'GMP',
                    'ISO 22000',
                    'Other',
                  ].map((value) => ({ value, label: value }))}
                />
                <Input
                  label="Certification name"
                  value={entry.name}
                  onChange={(name) => patch(entry.id, { name })}
                  required
                  maxLength={120}
                  error={
                    showErrors && !entry.name.trim() ? 'Certification name is required.' : undefined
                  }
                />
                <Input
                  label="Issuing organization"
                  value={entry.issuer}
                  onChange={(issuer) => patch(entry.id, { issuer })}
                  required
                  maxLength={160}
                  error={
                    showErrors && !entry.issuer.trim()
                      ? 'Issuing organization is required.'
                      : undefined
                  }
                />
                <Input
                  label="Certificate reference"
                  value={entry.reference}
                  onChange={(reference) => patch(entry.id, { reference })}
                  required
                  maxLength={120}
                  error={
                    showErrors && !entry.reference.trim()
                      ? 'Certificate reference is required.'
                      : undefined
                  }
                />
                <Input
                  label="Certificate issue date (optional)"
                  type="date"
                  value={entry.issueDate ?? ''}
                  onChange={(issueDate) => patch(entry.id, { issueDate: issueDate || undefined })}
                />
                <Input
                  label="Certificate expiry date"
                  required={!entry.noExpiry}
                  error={
                    showErrors && !entry.noExpiry && !entry.expiryDate
                      ? 'Enter expiry or select No expiry stated.'
                      : undefined
                  }
                  type="date"
                  value={entry.expiryDate ?? ''}
                  disabled={entry.noExpiry}
                  onChange={(expiryDate) =>
                    patch(entry.id, { expiryDate: expiryDate || undefined })
                  }
                />
                <label>
                  <input
                    type="checkbox"
                    checked={entry.noExpiry}
                    onChange={(event) =>
                      patch(entry.id, {
                        noExpiry: event.target.checked,
                        expiryDate: event.target.checked ? undefined : entry.expiryDate,
                      })
                    }
                  />{' '}
                  No expiry stated
                </label>
                <SelectField
                  label="Certification scope"
                  required
                  value={entry.scope}
                  onChange={(scope) =>
                    patch(entry.id, { scope: scope as CertificationDraft['scope'] })
                  }
                  options={['Company', 'Facility', 'Ingredient', 'This batch'].map((value) => ({
                    value,
                    label: value,
                  }))}
                />
                {entry.scope === 'This batch' && (
                  <p className="text-[12px] text-ws-text2 m-0">
                    Covers this batch{batchReference.trim() ? ` (${batchReference.trim()})` : ''}.
                  </p>
                )}
                {entry.scope !== 'Company' && entry.scope !== 'This batch' && (
                  <Input
                    label="Covered facility / ingredient reference"
                    value={entry.scopeReference ?? ''}
                    onChange={(scopeReference) => patch(entry.id, { scopeReference })}
                    required
                    maxLength={160}
                    error={
                      showErrors && !entry.scopeReference?.trim()
                        ? 'Identify the covered facility, ingredient or batch.'
                        : undefined
                    }
                  />
                )}
              </div>
              <label className="ingredient-certification-upload">
                <span>
                  Supporting documents <span className="text-ws-red">*</span>
                </span>
                <input
                  aria-label={`Documents for certification ${index + 1}`}
                  type="file"
                  aria-invalid={showErrors && !entry.files.length}
                  multiple
                  accept=".pdf,.png,.jpg,.jpeg"
                  disabled={disabled}
                  onChange={(event) => {
                    addFiles(entry, Array.from(event.target.files ?? []));
                    event.target.value = '';
                  }}
                />
                <small className="ingredient-help">
                  PDF (up to 50 pages), PNG or JPEG. Up to 10 MB each, 3 files per certification; 20
                  files / 20 MB total.
                </small>
              </label>
              {showErrors && !entry.files.length && (
                <p role="alert" className="text-ws-red">
                  Attach at least one supporting document.
                </p>
              )}
              {sourceFile &&
                ['application/pdf', 'image/png', 'image/jpeg'].includes(sourceFile.type) && (
                  <Btn
                    variant="outline"
                    size="sm"
                    disabled={disabled}
                    onClick={() => addFiles(entry, [sourceFile])}
                  >
                    Attach uploaded supply document
                  </Btn>
                )}
            </>
          ) : (
            <dl className="workspace-review-grid">
              {[
                ['Issuer', entry.issuer],
                ['Certificate reference', entry.reference],
                ['Scope', entry.scope],
                [
                  'Covered reference',
                  entry.scope === 'This batch' ? batchReference : entry.scopeReference,
                ],
                ['Issue date', entry.issueDate],
                ['Expiry', entry.noExpiry ? 'No expiry stated' : entry.expiryDate],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value || 'Unavailable'}</dd>
                </div>
              ))}
            </dl>
          )}
          {entry.files.map((item) => (
            <div className="ingredient-certification-file" key={item.id}>
              <div>
                <strong>{item.file.name}</strong>
                <small>
                  {(item.file.size / 1024).toFixed(1)} KB ·{' '}
                  {item.status === 'stored'
                    ? 'Encrypted copy stored'
                    : item.status === 'uploading'
                      ? `Uploading ${item.progress}%${item.progress === 100 ? ' · Encrypting and pinning' : ''}`
                      : 'Upload failed'}
                </small>
                {item.error && <span role="alert">{item.error}</span>}
              </div>
              <div className="action-row">
                <Btn
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setPreview({ url: URL.createObjectURL(item.file), file: item.file })
                  }
                >
                  Preview
                </Btn>
                <Btn
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const url = URL.createObjectURL(item.file),
                      link = document.createElement('a');
                    link.href = url;
                    link.download = item.file.name;
                    link.click();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                  }}
                >
                  Download
                </Btn>
                {!readOnly && item.status === 'failed' && (
                  <Btn size="sm" disabled={disabled} onClick={() => void upload(entry.id, item)}>
                    Retry upload
                  </Btn>
                )}
                {!readOnly && (
                  <Btn
                    size="sm"
                    variant="ghost"
                    disabled={disabled}
                    onClick={() =>
                      patch(entry.id, { files: entry.files.filter((file) => file.id !== item.id) })
                    }
                  >
                    Remove file
                  </Btn>
                )}
              </div>
            </div>
          ))}
          {!readOnly && (
            <div className="action-row">
              <Btn
                size="sm"
                variant="ghost"
                disabled={disabled}
                onClick={() =>
                  setEntries((current) => current.filter((value) => value.id !== entry.id))
                }
              >
                Remove certification
              </Btn>
            </div>
          )}
        </details>
      ))}
      {!readOnly && (
        <Btn
          variant="outline"
          disabled={disabled || entries.length >= 20}
          onClick={() =>
            setEntries((current) => [
              ...current,
              {
                id: crypto.randomUUID(),
                name: '',
                issuer: '',
                reference: '',
                scope: 'This batch',
                scopeReference: '',
                noExpiry: false,
                files: [],
              },
            ])
          }
        >
          Add certification
        </Btn>
      )}
      {preview && (
        <Modal title={preview.file.name} onClose={() => setPreview(undefined)}>
          <div className="document-preview-media">
            {preview.file.type === 'application/pdf' ? (
              <iframe
                title="Certification document preview"
                src={preview.url}
                sandbox=""
                className="registration-document-pdf"
              />
            ) : (
              <img
                alt="Certification document"
                src={preview.url}
                className="registration-document-image"
              />
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
