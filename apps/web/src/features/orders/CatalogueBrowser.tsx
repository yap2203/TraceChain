import { FilterX, PackageSearch, Search, ShieldCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { WorkspaceRole } from '../workspaces/workspace-navigation';
import {
  Alert,
  Badge,
  Btn,
  EmptyState,
  Input,
  Modal,
  SelectField,
  TechnicalDetails,
} from '../workspaces/shared/ui';
import { CatalogueImage, CompanyAvatar } from './CatalogueMedia';
import type { OrderRecord } from './orders.api';

export interface QuantityRequestInput {
  deadline: string;
  note: string;
  quantity: string;
}

export interface EvidenceRequestInput {
  batchId: string;
  claims: string[];
  deadline: string;
  reason: string;
  requiredClaims: string[];
}

export function CatalogueBrowser({
  actor,
  busy,
  items,
  role,
  onEvidenceRequest,
  onOpenEvidence,
  onQuantityRequest,
}: {
  actor: string;
  busy: boolean;
  items: OrderRecord[];
  role: WorkspaceRole;
  onEvidenceRequest: (item: OrderRecord, input: EvidenceRequestInput) => Promise<void>;
  onOpenEvidence: () => void;
  onQuantityRequest: (item: OrderRecord, input: QuantityRequestInput) => Promise<void>;
}) {
  const eligible = useMemo(
    () =>
      items.filter(
        (entry) =>
          !entry.archived &&
          (role !== 'manufacturer' || Number(entry.kind) === 1 || same(entry.seller, actor)) &&
          (role !== 'retailer' || Number(entry.kind) === 2),
      ),
    [actor, items, role],
  );
  const [selected, setSelected] = useState<OrderRecord>();
  const [mode, setMode] = useState<'details' | 'quantity' | 'evidence'>('details');
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('all');
  const [category, setCategory] = useState('all');
  const [country, setCountry] = useState('all');
  const [availableOnly, setAvailableOnly] = useState(false);
  const [credential, setCredential] = useState('all');
  const [sort, setSort] = useState('name');
  const categories = unique(eligible.map((entry) => entry.category));
  const countries = unique(eligible.map((entry) => entry.countryOfOrigin));
  const kinds = unique(eligible.map((entry) => String(entry.kind)));
  const shown = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return eligible
      .filter((entry) => {
        const batch = entry.batchDetails?.[0];
        const matchesSearch = [entry.name, entry.category, entry.sellerName]
          .filter(Boolean)
          .some((value) => String(value).toLocaleLowerCase().includes(query));
        return (
          (!query || matchesSearch) &&
          (kind === 'all' || String(entry.kind) === kind) &&
          (category === 'all' || entry.category === category) &&
          (country === 'all' || entry.countryOfOrigin === country) &&
          (!availableOnly || (entry.active && Number(batch?.supplierAvailable ?? 0) > 0)) &&
          (credential === 'all' ||
            (credential === 'active'
              ? Number(entry.credentialStatus) === 1
              : Number(entry.credentialStatus) !== 1))
        );
      })
      .sort((left, right) => {
        if (sort === 'newest')
          return Number(right.registeredBlock ?? 0) - Number(left.registeredBlock ?? 0);
        if (sort === 'price') {
          const leftPrice =
            left.price === undefined ? Number.POSITIVE_INFINITY : Number(left.price);
          const rightPrice =
            right.price === undefined ? Number.POSITIVE_INFINITY : Number(right.price);
          return leftPrice - rightPrice;
        }
        return String(left.name).localeCompare(String(right.name));
      });
  }, [availableOnly, category, country, credential, eligible, kind, search, sort]);
  const clear = () => {
    setSearch('');
    setKind('all');
    setCategory('all');
    setCountry('all');
    setAvailableOnly(false);
    setCredential('all');
    setSort('name');
  };
  const open = (item: OrderRecord, nextMode: typeof mode) => {
    setSelected(item);
    setMode(nextMode);
  };
  return (
    <section className="catalogue-browser" aria-labelledby="catalogue-title">
      <div className="catalogue-heading">
        <div>
          <h3 id="catalogue-title">Registered ingredients & products</h3>
          <p>
            Browse verified company listings and send requests. Prices are indicative; requests are
            not purchases and do not reserve stock.
          </p>
        </div>
        <strong aria-live="polite">{shown.length} results</strong>
      </div>
      <div className="catalogue-toolbar" aria-label="Catalogue filters">
        <Input
          label="Search catalogue"
          type="search"
          icon={<Search size={17} />}
          value={search}
          onChange={setSearch}
          placeholder="Ingredient, category or Supplier"
        />
        <SelectField
          label="Category"
          value={category}
          onChange={setCategory}
          options={[{ value: 'all', label: 'All categories' }, ...options(categories)]}
        />
        <SelectField
          label="Country of origin"
          value={country}
          onChange={setCountry}
          options={[{ value: 'all', label: 'All disclosed origins' }, ...options(countries)]}
        />
        <SelectField
          label="Credential status"
          value={credential}
          onChange={setCredential}
          options={[
            { value: 'all', label: 'All credential states' },
            { value: 'active', label: 'Active credential' },
            { value: 'inactive', label: 'Unavailable credential' },
          ]}
        />
        <SelectField
          label="Sort"
          value={sort}
          onChange={setSort}
          options={[
            { value: 'name', label: 'Name A–Z' },
            { value: 'newest', label: 'Newest registration' },
            { value: 'price', label: 'Indicative price' },
          ]}
        />
        <label className="catalogue-check">
          <input
            type="checkbox"
            checked={availableOnly}
            onChange={(event) => setAvailableOnly(event.target.checked)}
          />
          Active and available only
        </label>
        <Btn variant="ghost" size="sm" icon={<FilterX size={15} />} onClick={clear}>
          Clear filters
        </Btn>
      </div>
      {kinds.length > 1 && (
        <div className="catalogue-type-tabs" role="group" aria-label="Item type">
          {[
            { value: 'all', label: 'All items' },
            { value: '1', label: 'Ingredients' },
            { value: '2', label: 'Products' },
          ].map((entry) => (
            <button
              key={entry.value}
              type="button"
              aria-pressed={kind === entry.value}
              onClick={() => setKind(entry.value)}
            >
              {entry.label}
            </button>
          ))}
        </div>
      )}
      {!eligible.length ? (
        <EmptyState
          icon={<PackageSearch size={44} />}
          title="No registered items"
          sub="Registered items appear here automatically when they become available to your role."
        />
      ) : !shown.length ? (
        <EmptyState
          icon={<Search size={44} />}
          title="No items match these filters"
          sub="Clear or adjust the catalogue filters to see more items."
          action={<Btn onClick={clear}>Clear filters</Btn>}
        />
      ) : (
        <div className="catalogue-grid">
          {shown.map((item) => (
            <CatalogueCard
              key={item.itemId}
              item={item}
              onDetails={() => open(item, 'details')}
              onRequest={() => open(item, 'quantity')}
            />
          ))}
        </div>
      )}
      {selected && (
        <CatalogueDetail
          item={selected}
          mode={mode}
          busy={busy}
          onClose={() => setSelected(undefined)}
          onMode={setMode}
          onEvidenceRequest={onEvidenceRequest}
          onOpenEvidence={onOpenEvidence}
          onQuantityRequest={onQuantityRequest}
        />
      )}
    </section>
  );
}

function CatalogueCard({
  item,
  onDetails,
  onRequest,
}: {
  item: OrderRecord;
  onDetails: () => void;
  onRequest: () => void;
}) {
  const state = itemState(item);
  const batch = item.batchDetails?.[0];
  const company = item.sellerName ?? 'Verified company name unavailable';
  return (
    <article className="catalogue-card">
      <CatalogueImage
        path={item.imagePath}
        category={item.category}
        alt={`Supplier-provided image of ${item.name}`}
      />
      <div className="catalogue-card__body">
        <div className="catalogue-card__badges">
          <Badge label={Number(item.kind) === 1 ? 'Ingredient' : 'Product'} variant="default" />
          <Badge label={state.label} variant={state.variant} />
        </div>
        <h4 title={item.name}>{item.name}</h4>
        <div className="catalogue-company">
          <CompanyAvatar name={company} logoPath={item.sellerLogoPath} size="sm" />
          <span title={company}>{company}</span>
        </div>
        <dl className="catalogue-card__facts">
          <div>
            <dt>Origin</dt>
            <dd>{item.countryOfOrigin || 'Not disclosed'}</dd>
          </div>
          <div>
            <dt>Available</dt>
            <dd>
              {batch?.supplierAvailable !== undefined
                ? `${batch.supplierAvailable} ${item.unit}`
                : 'Not published'}
            </dd>
          </div>
          <div>
            <dt>Indicative price</dt>
            <dd>{price(item)}</dd>
          </div>
          <div>
            <dt>Credential</dt>
            <dd>{Number(item.credentialStatus) === 1 ? 'Active' : 'Status unavailable'}</dd>
          </div>
        </dl>
        {expiryWarning(batch?.expiresAt) && (
          <p className="catalogue-warning">{expiryWarning(batch.expiresAt)}</p>
        )}
        <div className="catalogue-card__actions">
          <Btn variant="outline" size="sm" onClick={onDetails}>
            View details
          </Btn>
          <Btn size="sm" disabled={!item.active} onClick={onRequest}>
            Request quantity
          </Btn>
        </div>
      </div>
    </article>
  );
}

function CatalogueDetail({
  item,
  mode,
  busy,
  onClose,
  onMode,
  onEvidenceRequest,
  onOpenEvidence,
  onQuantityRequest,
}: {
  item: OrderRecord;
  mode: 'details' | 'quantity' | 'evidence';
  busy: boolean;
  onClose: () => void;
  onMode: (mode: 'details' | 'quantity' | 'evidence') => void;
  onEvidenceRequest: (item: OrderRecord, input: EvidenceRequestInput) => Promise<void>;
  onOpenEvidence: () => void;
  onQuantityRequest: (item: OrderRecord, input: QuantityRequestInput) => Promise<void>;
}) {
  const batch = item.batchDetails?.[0] ?? {};
  const company = item.sellerName ?? 'Verified company name unavailable';
  const [quantity, setQuantity] = useState('');
  const [deadline, setDeadline] = useState('');
  const [note, setNote] = useState('');
  const [evidenceReason, setEvidenceReason] = useState('');
  const [evidenceDeadline, setEvidenceDeadline] = useState('');
  const [evidenceBatch, setEvidenceBatch] = useState(
    Number(item.kind) === 1 ? item.batches[0] : '',
  );
  const [claims, setClaims] = useState<Record<string, string>>({
    countryOfOrigin: 'optional',
    expiryDate: 'required',
  });
  const validQuantity = /^[1-9]\d*$/.test(quantity) && Boolean(deadline);
  const requestedClaims = Object.keys(claims).filter((claim) => claims[claim] !== 'not-requested');
  return (
    <Modal
      title={`${item.name} — ${mode === 'details' ? 'details' : mode === 'quantity' ? 'request quantity' : 'request information'}`}
      onClose={onClose}
      width={760}
    >
      <div className="catalogue-dialog-content">
        <section className="catalogue-dialog-summary" aria-label="Item summary">
          <div className="catalogue-detail">
            <CatalogueImage
              path={item.imagePath}
              category={item.category}
              alt={`Supplier-provided image of ${item.name}`}
              large
            />
            <div className="catalogue-detail__summary">
              <div className="catalogue-company catalogue-company--large">
                <CompanyAvatar name={company} logoPath={item.sellerLogoPath} size="lg" />
                <div>
                  <strong>{company}</strong>
                  <span>
                    {item.sellerRole
                      ? String(item.sellerRole).replaceAll('_', ' ')
                      : 'Verified company'}
                  </span>
                </div>
              </div>
              <Badge label={itemState(item).label} variant={itemState(item).variant} />
              <dl className="catalogue-detail__facts">
                <Fact
                  label="Item type"
                  value={Number(item.kind) === 1 ? 'Ingredient' : 'Product'}
                />
                <Fact label="Category" value={item.category || 'Not disclosed'} />
                <Fact label="Country of origin" value={item.countryOfOrigin || 'Not disclosed'} />
                <Fact label="Batch reference" value={item.batchReference || 'Not disclosed'} />
                <Fact
                  label="Registered quantity"
                  value={
                    batch.totalQuantity !== undefined
                      ? `${batch.totalQuantity} ${item.unit}`
                      : 'Unavailable'
                  }
                />
                <Fact
                  label="Safe available quantity"
                  value={
                    batch.supplierAvailable !== undefined
                      ? `${batch.supplierAvailable} ${item.unit}`
                      : 'Not published'
                  }
                />
                <Fact label="Production date" value={date(batch.producedAt)} />
                <Fact label="Expiry date" value={date(batch.expiresAt)} />
                <Fact label="Indicative price" value={`${price(item)} — Indicative only`} />
                <Fact
                  label="Credential lifecycle"
                  value={item.evidenceAvailability || 'Status unavailable'}
                />
              </dl>
            </div>
          </div>
        </section>
        <div className="catalogue-dialog-alert catalogue-dialog-alert--warning">
          <Alert
            type="warning"
            message="Ingredient details and images are supplied by the Supplier. Credential verification confirms the signed digital record and current blockchain status; it does not independently prove physical quality or laboratory certification."
          />
        </div>
        {mode === 'details' && (
          <div className="catalogue-detail__actions">
            <Btn disabled={!item.active} onClick={() => onMode('quantity')}>
              Request quantity
            </Btn>
            <Btn variant="outline" onClick={() => onMode('evidence')}>
              Request evidence or information
            </Btn>
          </div>
        )}
        {mode === 'quantity' && (
          <form
            className="catalogue-request-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (validQuantity) void onQuantityRequest(item, { quantity, deadline, note });
            }}
          >
            <div className="catalogue-dialog-alert catalogue-dialog-alert--info">
              <Alert
                type="info"
                message={`This sends a request for ${item.unit}. It does not reserve stock, create a purchase, take payment or dispatch goods.`}
              />
            </div>
            <Input
              label={`Requested quantity (${item.unit})`}
              type="number"
              min="1"
              step="1"
              value={quantity}
              onChange={setQuantity}
              required
            />
            <Input
              label="Response deadline"
              type="datetime-local"
              value={deadline}
              onChange={setDeadline}
              required
            />
            <Input label="Private note" value={note} onChange={setNote} maxLength={500} />
            <div className="catalogue-detail__actions">
              <Btn type="submit" disabled={busy || !validQuantity}>
                {busy ? 'Submitting…' : 'Submit request'}
              </Btn>
              <Btn type="button" variant="ghost" disabled={busy} onClick={() => onMode('details')}>
                Back
              </Btn>
            </div>
          </form>
        )}
        {mode === 'evidence' && (
          <form
            className="catalogue-request-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (
                evidenceReason.trim() &&
                evidenceDeadline &&
                evidenceBatch &&
                requestedClaims.length
              )
                void onEvidenceRequest(item, {
                  batchId: evidenceBatch,
                  claims: requestedClaims,
                  deadline: evidenceDeadline,
                  reason: evidenceReason,
                  requiredClaims: requestedClaims.filter((claim) => claims[claim] === 'required'),
                });
            }}
          >
            <div className="catalogue-dialog-alert catalogue-dialog-alert--info">
              <Alert
                type="info"
                message="Evidence remains confidential until the existing Supplier consent and verification workflow authorizes disclosure."
              />
            </div>
            {Number(item.kind) === 2 && (
              <SelectField
                label="Ingredient in this product"
                value={evidenceBatch}
                onChange={setEvidenceBatch}
                required
                options={[
                  { value: '', label: 'Select ingredient' },
                  ...(
                    item.batchDetails?.flatMap(
                      (entry: OrderRecord) => entry.ingredientLinks ?? [],
                    ) ?? []
                  ).map((link: OrderRecord) => ({
                    value: link.batchId,
                    label: link.batchReference || short(link.batchId),
                  })),
                ]}
              />
            )}
            <Input
              label="Reason for requesting information"
              value={evidenceReason}
              onChange={setEvidenceReason}
              maxLength={500}
              required
            />
            <Input
              label="Response deadline"
              type="datetime-local"
              value={evidenceDeadline}
              onChange={setEvidenceDeadline}
              required
            />
            <div className="catalogue-claim-grid">
              {[
                'countryOfOrigin',
                'productionDate',
                'expiryDate',
                'allergenDeclaration',
                'certificationDetails',
                'qualityTestSummary',
              ].map((claim) => (
                <SelectField
                  key={claim}
                  label={`${claim} disclosure`}
                  value={claims[claim] ?? 'not-requested'}
                  onChange={(value) => setClaims((current) => ({ ...current, [claim]: value }))}
                  options={[
                    { value: 'not-requested', label: 'Do not request' },
                    { value: 'optional', label: 'Optional' },
                    { value: 'required', label: 'Necessary' },
                  ]}
                />
              ))}
            </div>
            <div className="catalogue-detail__actions">
              <Btn
                disabled={
                  busy ||
                  !evidenceReason.trim() ||
                  !evidenceDeadline ||
                  !evidenceBatch ||
                  !requestedClaims.length
                }
                type="submit"
              >
                {busy ? 'Submitting…' : 'Send information request'}
              </Btn>
              <Btn type="button" variant="outline" onClick={onOpenEvidence}>
                Open evidence responses
              </Btn>
              <Btn type="button" variant="ghost" disabled={busy} onClick={() => onMode('details')}>
                Back
              </Btn>
            </div>
          </form>
        )}
        <TechnicalDetails
          fields={[
            { label: 'Item ID', value: item.itemId },
            { label: 'Batch ID', value: item.batches?.[0] ?? '' },
            { label: 'Supplier wallet', value: item.seller },
            { label: 'Listing hash', value: item.listingHash ?? '' },
          ]}
        />
      </div>
    </Modal>
  );
}

export function CatalogueSkeleton() {
  return (
    <div className="catalogue-grid" role="status" aria-label="Loading catalogue">
      {[0, 1, 2, 3].map((entry) => (
        <div key={entry} className="catalogue-card catalogue-skeleton" />
      ))}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function itemState(item: OrderRecord) {
  const batch = item.batchDetails?.[0];
  if (Number(batch?.expiresAt) <= Date.now() / 1000)
    return { label: 'Expired', variant: 'expired' as const };
  if (Number(batch?.status) === 2) return { label: 'Suspended', variant: 'suspended' as const };
  if (Number(batch?.status) === 3) return { label: 'Recalled', variant: 'revoked' as const };
  return item.active
    ? { label: 'Active', variant: 'active' as const }
    : { label: 'Unavailable', variant: 'pending' as const };
}

function price(item: OrderRecord) {
  return item.price !== undefined
    ? `${item.currency} ${item.price} / ${item.unit}`
    : 'Not provided';
}

function date(value: string | number | undefined) {
  return Number(value) ? new Date(Number(value) * 1000).toLocaleDateString() : 'Not recorded';
}

function expiryWarning(value: string | number | undefined) {
  if (!Number(value)) return '';
  const days = Math.ceil((Number(value) * 1000 - Date.now()) / 86_400_000);
  if (days < 0) return 'Expired';
  return days <= 30 ? `Expires in ${days} days` : '';
}

function unique(values: unknown[]) {
  return [
    ...new Set(
      values.filter((value): value is string => typeof value === 'string' && Boolean(value.trim())),
    ),
  ].sort();
}

function options(values: string[]) {
  return values.map((value) => ({ value, label: value }));
}

function same(left: string, right: string) {
  return left?.toLowerCase() === right?.toLowerCase();
}

function short(value: string) {
  return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
}
