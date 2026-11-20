import { useEffect, useState } from 'react';
import { ingredientClaimLabel, isRetiredIngredientClaim } from '@tracechain/shared';
import { Btn, Modal, Alert } from '../workspaces/shared/ui';
import { readableError } from '../../components/ui/feedback';
export interface PrivateEvidenceFile {
  fileName: string;
  mimeType: string;
  data: string;
}
const fieldLabels: Record<string, string> = {
  countryCode: 'Country code',
  countryName: 'Country of origin',
  region: 'Origin region',
  city: 'City / district',
  facility: 'Source facility / farm reference',
  privateAddress: 'Private source address',
  name: 'Certification name',
  issuer: 'Stated issuing organization',
  reference: 'Certificate reference',
  issueDate: 'Issue date',
  expiryDate: 'Expiry date',
  noExpiry: 'No expiry stated',
  scope: 'Scope',
  scopeReference: 'Covered reference',
  kind: 'Declaration',
  details: 'Details',
};
const allergenLabels: Record<string, string> = {
  contains: 'Contains',
  mayContain: 'May contain',
  declaresNone: 'Supplier declares none',
  unknown: 'Unknown',
};
export function IngredientClaimValue({
  name,
  value,
  loadDocument,
}: {
  name: string;
  value: unknown;
  loadDocument?: (id: string) => Promise<PrivateEvidenceFile>;
}) {
  const [preview, setPreview] = useState<{ url: string; file: PrivateEvidenceFile }>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview.url);
    },
    [preview],
  );
  if (isRetiredIngredientClaim(name)) return null;
  const open = async (id: string, download = false) => {
    if (!loadDocument) return;
    setBusy(true);
    setError('');
    try {
      const file = await loadDocument(id);
      if (!['application/pdf', 'image/png', 'image/jpeg'].includes(file.mimeType))
        throw new Error('Unsupported document type.');
      const bytes = Uint8Array.from(atob(file.data), (character) => character.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: file.mimeType }));
      if (download) {
        const link = document.createElement('a');
        link.href = url;
        link.download = file.fileName;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else setPreview({ url, file });
    } catch (cause) {
      setError(
        readableError(
          cause,
          'The authorized document could not be retrieved. Retry when the service is available.',
        ),
      );
    } finally {
      setBusy(false);
    }
  };
  const object =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  return (
    <div className="min-w-0 break-words">
      <strong>{ingredientClaimLabel(name)}</strong>
      {Array.isArray(value) && value.some((item) => item && typeof item === 'object') ? (
        <div>
          {value.map((item, index) => (
            <IngredientClaimValue
              key={index}
              name={`${name.startsWith('quality') ? 'qualityTest' : 'certification'}_${index + 1}`}
              value={item}
              loadDocument={loadDocument}
            />
          ))}
        </div>
      ) : object ? (
        <dl>
          {Object.entries(object)
            .filter(
              ([key]) =>
                ![
                  'documents',
                  'id',
                  'certificationId',
                  'qualityTestId',
                  'processingCountry',
                  'processingLocation',
                ].includes(key),
            )
            .map(([key, item]) => (
              <div key={key}>
                <dt>{fieldLabels[key] ?? key}</dt>
                <dd className="m-0">
                  {typeof item === 'boolean'
                    ? item
                      ? 'Yes'
                      : 'No'
                    : key === 'kind'
                      ? (allergenLabels[String(item)] ?? String(item))
                      : String(item ?? 'Unavailable')}
                </dd>
              </div>
            ))}
        </dl>
      ) : (
        <p>
          {Array.isArray(value)
            ? value.map((item) => String(item)).join(', ')
            : String(value ?? 'Unavailable')}
        </p>
      )}
      {object && name.startsWith('certification') && (
        <p className="text-sm text-ws-text2">
          Supplier-provided certification; the stated authority has not independently verified this
          document through TraceChain.
        </p>
      )}
      {object && Array.isArray(object.documents) && (
        <>
          <p>
            The complete selected file will be shared. Structured selective disclosure cannot redact
            information inside a PDF or image.
          </p>
          {object.documents.map((document: any) => (
            <div key={document.id} className="my-3">
              <span>
                {document.fileName} · {document.size} bytes
              </span>
              <div className="action-row">
                <Btn
                  size="sm"
                  variant="outline"
                  disabled={busy || !loadDocument}
                  onClick={() => void open(document.id, true)}
                >
                  Download document
                </Btn>
                <Btn
                  size="sm"
                  variant="outline"
                  disabled={busy || !loadDocument}
                  onClick={() => void open(document.id)}
                >
                  Preview document
                </Btn>
              </div>
            </div>
          ))}
        </>
      )}
      {error && <Alert type="error" message={error} />}
      {preview && (
        <Modal title={preview.file.fileName} onClose={() => setPreview(undefined)}>
          <div className="document-preview-media">
            {preview.file.mimeType === 'application/pdf' ? (
              <iframe
                title="Certification document"
                sandbox=""
                src={preview.url}
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
