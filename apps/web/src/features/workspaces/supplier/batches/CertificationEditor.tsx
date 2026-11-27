import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { FileText, Trash2, Upload } from 'lucide-react';
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
  const pickers = useRef<Record<string, HTMLInputElement | null>>({});
  // One compact row per document: name and state on the left, actions on the right.
  const fileRow = (entry: CertificationDraft, item: CertificationFileDraft) => (
    <div className="ingredient-certification-file" key={item.id}>
      <FileText size={18} aria-hidden="true" />
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
          variant="ghost"
          onClick={() => setPreview({ url: URL.createObjectURL(item.file), file: item.file })}
        >
          Preview
        </Btn>
        <Btn
          size="sm"
          variant="ghost"
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
  );
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
            <strong>{entry.name || `Certification ${index + 1}`}</strong>
            <span className="ingredient-certification-card__tags">
              {/* Completion only: says nothing about verification, which certifications never have here. */}
              {!readOnly && certificationError([entry]) && (
                <span className="is-incomplete" title={certificationError([entry])}>
                  Incomplete
                </span>
              )}
              <span>{entry.scope}</span>
              <span>
                {entry.files.length} {entry.files.length === 1 ? 'document' : 'documents'}
              </span>
              {entry.noExpiry ? (
                <span>No expiry</span>
              ) : (
                entry.expiryDate && <span>Expires {entry.expiryDate}</span>
              )}
            </span>
            {!readOnly && <span className="ingredient-certification-card__edit">Edit</span>}
          </summary>
          {!readOnly ? (
            <div className="ingredient-certification-card__body">
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
                  label="Issue date (optional)"
                  type="date"
                  value={entry.issueDate ?? ''}
                  onChange={(issueDate) => patch(entry.id, { issueDate: issueDate || undefined })}
                />
                {/* Expiry date and "No expiry stated" share one cell; the date hides when it does not apply. */}
                <div className="ingredient-certification-card__expiry">
                  {!entry.noExpiry && (
                    <Input
                      label="Certificate expiry date"
                      required
                      error={
                        showErrors && !entry.expiryDate
                          ? 'Enter expiry or select No expiry stated.'
                          : undefined
                      }
                      type="date"
                      value={entry.expiryDate ?? ''}
                      onChange={(expiryDate) =>
                        patch(entry.id, { expiryDate: expiryDate || undefined })
                      }
                    />
                  )}
                  <label className="ingredient-certification-card__check">
                    <input
                      type="checkbox"
                      checked={entry.noExpiry}
                      onChange={(event) =>
                        patch(entry.id, {
                          noExpiry: event.target.checked,
                          expiryDate: event.target.checked ? undefined : entry.expiryDate,
                        })
                      }
                    />
                    No expiry stated
                  </label>
                </div>
                <div className="ingredient-certification-card__scope">
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
                    <small className="ingredient-help">
                      Covers this batch{batchReference.trim() ? ` (${batchReference.trim()})` : ''}.
                    </small>
                  )}
                </div>
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
              <section
                className="ingredient-certification-docs"
                data-error={showErrors && !entry.files.length}
              >
                <header>
                  <div>
                    <strong>
                      Supporting documents <span className="text-ws-red">*</span>
                    </strong>
                    <small className="ingredient-help">
                      PDF (up to 50 pages), PNG or JPEG · up to 10 MB each · 3 per certification
                    </small>
                  </div>
                  <div className="action-row">
                    {sourceFile &&
                      ['application/pdf', 'image/png', 'image/jpeg'].includes(sourceFile.type) && (
                        <Btn
                          variant="ghost"
                          size="sm"
                          disabled={disabled}
                          onClick={() => addFiles(entry, [sourceFile])}
                        >
                          Attach uploaded supply document
                        </Btn>
                      )}
                    <Btn
                      variant="outline"
                      size="sm"
                      icon={<Upload size={14} aria-hidden="true" />}
                      disabled={disabled || entry.files.length >= 3}
                      onClick={() => pickers.current[entry.id]?.click()}
                    >
                      Add documents
                    </Btn>
                  </div>
                  {/* Native picker stays for accessibility and tests; the button opens it. */}
                  <input
                    ref={(element) => {
                      pickers.current[entry.id] = element;
                    }}
                    className="sr-only"
                    tabIndex={-1}
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
                </header>
                {!entry.files.length && (
                  <p className="ingredient-certification-docs__empty">
                    No documents yet. Add the certificate or other supporting evidence.
                  </p>
                )}
                {showErrors && !entry.files.length && (
                  <p role="alert" className="text-ws-red">
                    Attach at least one supporting document.
                  </p>
                )}
                {entry.files.map((item) => fileRow(entry, item))}
              </section>
              <div className="ingredient-certification-card__footer">
                <Btn
                  size="sm"
                  variant="danger"
                  icon={<Trash2 size={14} aria-hidden="true" />}
                  disabled={disabled}
                  onClick={() =>
                    setEntries((current) => current.filter((value) => value.id !== entry.id))
                  }
                >
                  Remove certification
                </Btn>
              </div>
            </div>
          ) : (
            <div className="ingredient-certification-card__body">
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
              {entry.files.length > 0 && (
                <section className="ingredient-certification-docs">
                  {entry.files.map((item) => fileRow(entry, item))}
                </section>
              )}
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
