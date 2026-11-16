import { useEffect, useRef, useState } from 'react';
import { Download, Eye, FileText } from 'lucide-react';
import { Alert, Btn, Card, Modal, SectionTitle } from '../workspaces/shared/ui';
import { LoadingIndicator } from '../../components/ui/LoadingIndicator';
import { notify, readableError } from '../../components/ui/feedback';

const base =
  (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '') +
  '/api/blockchain';
const labels: Record<string, string> = {
  registrationProof: 'Company registration',
  businessProof: 'Business proof',
  authorisationProof: 'Authorisation proof',
  certifications: 'Certifications',
};
interface DocumentInfo {
  kind: string;
  fileName: string;
  mimeType: string;
  size: number;
  index: number;
}
async function request(path: string, init?: RequestInit) {
  const response = await fetch(base + path, { ...init, credentials: 'include' });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      readableError(error.error?.message, 'Documents could not be loaded. Please retry.'),
    );
  }
  return response;
}
export function ApplicationDocumentsPanel({
  applicationId,
  readOnly = false,
}: {
  applicationId?: string;
  readOnly?: boolean;
}) {
  const loadVersion = useRef(0);
  const [applications, setApplications] = useState<{ id: string; status: string }[]>([]);
  const [selected, setSelected] = useState(applicationId ?? '');
  const [files, setFiles] = useState<DocumentInfo[]>([]);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [uploads, setUploads] = useState<Record<string, File>>({});
  const [preview, setPreview] = useState<{ url: string; file: DocumentInfo }>();
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview.url);
    },
    [preview],
  );
  const load = async (id: string) => {
    const version = ++loadVersion.current;
    setLoading(true);
    setError('');
    setFiles([]);
    setPreview(undefined);
    try {
      const result = await (await request(`/applications/${id}/documents`)).json();
      if (version === loadVersion.current) setFiles(result.documents);
    } catch (cause) {
      if (version === loadVersion.current)
        setError(readableError(cause, 'Documents are unavailable.'));
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  };
  useEffect(() => {
    let active = true;
    if (applicationId) {
      setSelected(applicationId);
      void load(applicationId);
      return;
    }
    void request('/applications/documents/me')
      .then((r) => r.json())
      .then((result) => {
        if (!active) return;
        setApplications(result.applications);
        const id = result.applications.at(-1)?.id ?? '';
        setSelected(id);
        if (id) void load(id);
        else setLoading(false);
      })
      .catch((cause) => {
        if (active) {
          setError(readableError(cause, 'Documents are unavailable.'));
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [applicationId]);
  const open = async (file: DocumentInfo, download: boolean) => {
    setBusy(true);
    setError('');
    try {
      const response = await request(`/applications/${selected}/documents/${file.index}`);
      const url = URL.createObjectURL(await response.blob());
      if (download) {
        const link = document.createElement('a');
        link.href = url;
        link.download = file.fileName;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        notify('Document downloaded.', 'success');
      } else setPreview({ url, file });
    } catch (cause) {
      setError(readableError(cause, 'The document could not be opened.'));
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const documents = await Promise.all(
        Object.entries(uploads).map(async ([kind, file]) => ({
          kind,
          fileName: file.name,
          mimeType: file.type,
          data: await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result).split(',')[1]!);
            reader.onerror = () => reject(new Error('Document reading failed.'));
            reader.readAsDataURL(file);
          }),
        })),
      );
      await request(`/applications/${selected}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documents }),
      });
      setUploads({});
      await load(selected);
      notify('Supporting documents saved securely.', 'success');
    } catch (cause) {
      setError(readableError(cause, 'Documents could not be saved.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <SectionTitle
        title="Registration documents"
        sub="Private applicant-provided files. Available only to this company and the current Administrator; uploading is not document certification."
      />
      {!applicationId && applications.length > 1 && (
        <label>
          Application
          <select
            value={selected}
            onChange={(e) => {
              setSelected(e.target.value);
              void load(e.target.value);
            }}
            style={{ maxWidth: '100%', width: '100%' }}
          >
            {applications.map((a) => (
              <option key={a.id} value={a.id}>
                {a.id.slice(0, 12)}… · {a.status}
              </option>
            ))}
          </select>
        </label>
      )}
      {error && <Alert type="error" message={error} />}
      {loading ? (
        <LoadingIndicator label="Loading documents…" />
      ) : error ? (
        selected ? (
          <Btn variant="outline" onClick={() => void load(selected)}>
            Retry loading documents
          </Btn>
        ) : null
      ) : !selected ? (
        <p>No submitted application was found for this wallet.</p>
      ) : (
        <>
          {files.map((file) => (
            <div
              key={file.kind}
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 12,
                padding: '12px 0',
                borderBottom: '1px solid var(--border, #24364a)',
              }}
            >
              <FileText size={20} />
              <div style={{ flex: '1 1 180px', minWidth: 0, overflowWrap: 'anywhere' }}>
                <strong>{labels[file.kind]}</strong>
                <div>
                  {file.fileName} · {(file.size / 1024).toFixed(1)} KB
                </div>
              </div>
              <Btn variant="outline" disabled={busy} onClick={() => void open(file, false)}>
                <Eye size={16} /> View document
              </Btn>
              <Btn variant="outline" disabled={busy} onClick={() => void open(file, true)}>
                <Download size={16} /> Download
              </Btn>
            </div>
          ))}
          {!files.length && (
            <>
              <p>
                No document contents were saved for this application. Earlier registration versions
                recorded filenames only.
              </p>
              {!readOnly ? (
                <>
                  <p>
                    Attach the original documents again for Admin review. This adds supporting files
                    without changing the on-chain application or its original hash.
                  </p>
                  {Object.entries(labels).map(([kind, label]) => (
                    <label key={kind} style={{ display: 'block', margin: '12px 0' }}>
                      {label}
                      {kind !== 'certifications' ? ' *' : ' (optional)'}
                      <input
                        style={{ display: 'block', maxWidth: '100%' }}
                        type="file"
                        accept=".pdf,.png,.jpg,.jpeg"
                        disabled={busy}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (
                            file &&
                            (file.size > 10 * 1024 * 1024 ||
                              !['application/pdf', 'image/png', 'image/jpeg'].includes(file.type))
                          ) {
                            setError('Choose a PDF, PNG or JPEG up to 10 MB.');
                            e.target.value = '';
                            return;
                          }
                          setUploads((current) => {
                            const next = { ...current };
                            if (file) next[kind] = file;
                            else delete next[kind];
                            return next;
                          });
                        }}
                      />
                    </label>
                  ))}
                  <Btn
                    disabled={
                      busy ||
                      !['registrationProof', 'businessProof', 'authorisationProof'].every(
                        (k) => uploads[k],
                      )
                    }
                    onClick={() => void save()}
                  >
                    {busy ? 'Saving…' : 'Save supporting documents'}
                  </Btn>
                </>
              ) : (
                <p>
                  The applicant can attach these documents from Company profile or the signed-in
                  application status screen.
                </p>
              )}
            </>
          )}
        </>
      )}
      {preview && (
        <Modal title={preview.file.fileName} onClose={() => setPreview(undefined)} width={900}>
          {preview.file.mimeType.startsWith('image/') ? (
            <img
              src={preview.url}
              alt={labels[preview.file.kind]}
              style={{ maxWidth: '100%', maxHeight: '65vh', objectFit: 'contain' }}
            />
          ) : (
            <>
              <iframe
                sandbox=""
                src={preview.url}
                title="Document preview"
                style={{ width: '100%', height: '60vh', border: 0 }}
              />
              <p>If your browser blocks PDF preview, use Download to review the file.</p>
            </>
          )}
          <Btn disabled={busy} onClick={() => void open(preview.file, true)}>
            Download document
          </Btn>
        </Modal>
      )}
    </Card>
  );
}
