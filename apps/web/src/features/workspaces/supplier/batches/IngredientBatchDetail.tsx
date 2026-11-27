import { useEffect, useState, type ReactNode } from 'react';
import { Download, Eye, FileText } from 'lucide-react';
import type { CertificationDocument, IngredientCertification } from '@tracechain/shared';
import { getCertificationDocument } from './ingredient-batch.api';
import { BackNavigation } from '../../../../components/ui/BackNavigation';
import { readableError, reportError } from '../../../../components/ui/feedback';
import { LoadingIndicator } from '../../../../components/ui/LoadingIndicator';
import { Alert, Badge, Btn, Card, EmptyState, Modal, TechnicalDetails } from '../../shared/ui';
import { getIngredientBatches, type RegisteredIngredientBatch } from './ingredient-batch.api';
import { getOrders, type OrderRecord } from '../../../orders/orders.api';
import './batch-detail.css';

const ALLERGEN_LABEL = {
  contains: 'Contains',
  mayContain: 'May contain',
  declaresNone: 'Supplier declares none',
} as const;

export function IngredientBatchDetail({
  batchId,
  onBack,
}: {
  batchId: string;
  onBack: () => void;
}) {
  const [batch, setBatch] = useState<RegisteredIngredientBatch | null>();
  const [error, setError] = useState('');
  const [listing, setListing] = useState<OrderRecord>();
  const [listingError, setListingError] = useState('');

  useEffect(() => {
    let active = true;
    void getOrders('supplier-inventory')
      .then((data) => {
        const entry = data.catalogue.find(
          (item) =>
            item.batches.includes(batchId) &&
            item.seller.toLowerCase() === data.actor.toLowerCase(),
        );
        if (active && entry) setListing(entry.batchSummaries?.[batchId] ?? entry);
      })
      .catch(() => {
        if (active)
          setListingError(
            'The current listing summary is unavailable. The signed batch details are shown below.',
          );
      });
    getIngredientBatches()
      .then(({ batches }) => {
        if (active) setBatch(batches.find((candidate) => candidate.batchId === batchId) ?? null);
      })
      .catch((caught: unknown) => {
        if (active) setError(reportError(caught, 'The batch could not be loaded.'));
      });
    return () => {
      active = false;
    };
  }, [batchId]);

  const back = <BackNavigation onClick={onBack}>My ingredients</BackNavigation>;
  if (error)
    return (
      <div className="batch-detail">
        {back}
        <Alert type="error" message={error} />
      </div>
    );
  if (batch === undefined)
    return (
      <Card>
        <LoadingIndicator page label="Loading ingredient batch" />
      </Card>
    );
  if (!batch)
    return (
      <div className="batch-detail">
        {back}
        <EmptyState
          icon={<span />}
          title="Batch not found on chain"
          sub="This authenticated Supplier does not own the requested ingredient batch."
        />
      </div>
    );

  const origin = batch.originDetails;
  const allergen = batch.allergen;
  const certifications = batch.certificationEntries ?? [];
  return (
    <div className="batch-detail">
      {back}
      <header className="batch-detail__header">
        <div>
          <h2>{listing?.name ?? batch.ingredientName}</h2>
          <p>
            Batch {batch.batchReference}
            {batch.category ? ` · ${batch.category}` : ''}
          </p>
        </div>
        <Badge
          label={
            listing?.archived ? 'Archived listing' : batch.status === 1 ? 'Active' : 'Unavailable'
          }
          variant={batch.status === 1 ? 'active' : 'pending'}
        />
      </header>
      {listingError && <Alert type="warning" message={listingError} />}

      <div className="batch-detail__layout">
        <div className="batch-detail__main">
          <Section
            title="Batch details"
            note="Signed when the batch was registered; never changes."
          >
            <Facts
              rows={[
                ['Ingredient', batch.ingredientName],
                ['Batch reference', batch.batchReference],
                ['Registered quantity', amount(batch.quantity, batch.unit)],
                ['Available quantity', amount(batch.availableQuantity, batch.unit)],
                ['Production date', formatDate(batch.producedAt)],
                ['Expiry date', formatDate(batch.expiresAt)],
              ]}
            />
          </Section>

          <Section title="Origin">
            {origin ? (
              <Facts
                rows={[
                  ['Country', origin.countryName],
                  ['State / region', origin.region],
                  ['City / district', origin.city],
                  ['Source facility', origin.facility],
                  [
                    <>
                      Source address <span className="batch-detail__private">Private</span>
                    </>,
                    origin.privateAddress,
                  ],
                ]}
              />
            ) : (
              <Facts rows={[['Origin', batch.origin || 'Not recorded']]} />
            )}
          </Section>

          <Section title="Allergen declaration">
            {allergen && allergen.kind !== 'unknown' ? (
              <Facts
                rows={[
                  ['Declaration', ALLERGEN_LABEL[allergen.kind]],
                  ['Details', allergen.details],
                ]}
              />
            ) : allergen ? (
              <Badge label="Unknown" variant="pending" />
            ) : (
              <Facts rows={[['Declaration', batch.allergenInformation || 'Not recorded']]} />
            )}
          </Section>

          <Section
            title={`Certifications (${certifications.length || batch.certifications.length})`}
            note="Supplier-provided. The stated authority has not independently verified these through TraceChain."
          >
            {certifications.length ? (
              <div className="batch-detail__certs">
                {certifications.map((entry) => (
                  <CertificationCard key={entry.id} entry={entry} batchId={batchId} />
                ))}
              </div>
            ) : batch.certifications.length ? (
              <p className="batch-detail__text">{batch.certifications.join(', ')}</p>
            ) : (
              <p className="batch-detail__muted">No certifications supplied.</p>
            )}
          </Section>
        </div>

        <aside className="batch-detail__aside">
          <Section
            title="Your listing"
            note="Listing information you can edit from My ingredients. It is not part of the signed credential."
          >
            <Facts
              rows={[
                ['Name', listing?.name],
                ['Category', listing?.category],
                [
                  'Indicative price',
                  listing?.price !== undefined
                    ? `${listing.currency} ${listing.price} per ${listing.priceBasis || batch.unit}`
                    : 'Not provided',
                ],
                ['Description', listing?.description || 'No description provided'],
              ]}
            />
          </Section>
          <Section title="Privacy">
            <p className="batch-detail__muted">
              The full Ingredient Credential and private details stay encrypted off-chain and are
              returned only to you, the authorized Supplier.
            </p>
            <TechnicalDetails
              fields={[
                { label: 'Batch ID', value: batch.batchId },
                { label: 'Supplier wallet', value: batch.supplier },
                { label: 'Credential ID', value: batch.credentialId },
                { label: 'Metadata hash', value: batch.metadataHash },
                { label: 'Encrypted CID', value: batch.encryptedCid },
              ]}
            />
          </Section>
        </aside>
      </div>
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="batch-detail__section" aria-label={title}>
      <h3>{title}</h3>
      {note && <p className="batch-detail__muted">{note}</p>}
      {children}
    </section>
  );
}

/** Label/value pairs; empty values are left out. */
function Facts({ rows }: { rows: [ReactNode, string | undefined][] }) {
  return (
    <dl className="batch-detail__facts">
      {rows
        .filter(([, value]) => value)
        .map(([label, value], index) => (
          <div key={index}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
    </dl>
  );
}

function CertificationCard({
  entry,
  batchId,
}: {
  entry: IngredientCertification;
  batchId: string;
}) {
  return (
    <article className="batch-detail__cert">
      <header>
        <strong>{entry.name}</strong>
        <span>{entry.scope}</span>
        <span>{entry.noExpiry ? 'No expiry' : `Expires ${entry.expiryDate ?? '—'}`}</span>
      </header>
      <Facts
        rows={[
          ['Issuing organization', entry.issuer],
          ['Certificate reference', entry.reference],
          ['Issue date', entry.issueDate],
          ['Covered reference', entry.scope === 'This batch' ? undefined : entry.scopeReference],
        ]}
      />
      {entry.documents.map((document) => (
        <DocumentRow key={document.id} document={document} batchId={batchId} />
      ))}
    </article>
  );
}

function DocumentRow({ document, batchId }: { document: CertificationDocument; batchId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<{ url: string; mimeType: string }>();
  useEffect(() => () => preview && URL.revokeObjectURL(preview.url), [preview]);
  const open = async (download: boolean) => {
    setBusy(true);
    setError('');
    try {
      const file = await getCertificationDocument(batchId, document.id);
      if (!['application/pdf', 'image/png', 'image/jpeg'].includes(file.mimeType))
        throw new Error('Unsupported document type.');
      const bytes = Uint8Array.from(atob(file.data), (character) => character.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: file.mimeType }));
      if (download) {
        const link = window.document.createElement('a');
        link.href = url;
        link.download = file.fileName;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else setPreview({ url, mimeType: file.mimeType });
    } catch (cause) {
      setError(readableError(cause, 'The document could not be retrieved. Try again later.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="batch-detail__doc">
      <FileText size={18} aria-hidden="true" />
      <div>
        <strong>{document.fileName}</strong>
        <small>{(document.size / 1024).toFixed(1)} KB</small>
        {error && <span role="alert">{error}</span>}
      </div>
      <div className="action-row">
        <Btn
          size="sm"
          variant="ghost"
          icon={<Eye size={14} />}
          disabled={busy}
          onClick={() => void open(false)}
        >
          Preview
        </Btn>
        <Btn
          size="sm"
          variant="ghost"
          icon={<Download size={14} />}
          disabled={busy}
          onClick={() => void open(true)}
        >
          Download
        </Btn>
      </div>
      {preview && (
        <Modal title={document.fileName} onClose={() => setPreview(undefined)}>
          <div className="document-preview-media">
            {preview.mimeType === 'application/pdf' ? (
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

function amount(value: string, unit: string) {
  try {
    return `${BigInt(value).toLocaleString()} ${unit}`;
  } catch {
    return `${value} ${unit}`;
  }
}

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(timestamp * 1_000);
}
