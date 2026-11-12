import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Archive,
  Boxes,
  CalendarClock,
  FilterX,
  PackageCheck,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Upload,
} from 'lucide-react';

import { SupplierStockSummary } from '../../../orders/SupplierStockSummary';
import type { SupplierStock } from '../../../orders/orders.api';
import { CatalogueImage } from '../../../orders/CatalogueMedia';
import {
  getOrders,
  imageFilePayload,
  prepareOrder,
  uploadIngredientCatalogueImage,
  type OrderRecord,
  type OrdersState,
} from '../../../orders/orders.api';
import { submitProductionTransaction } from '../../../production-flow/production-flow.transaction';
import {
  Alert,
  Badge,
  Btn,
  EmptyState,
  Input,
  Modal,
  SectionTitle,
  SelectField,
  TechnicalDetails,
} from '../../shared/ui';

type BatchStatus = 'active' | 'suspended' | 'recalled' | 'expired' | 'archived';
type InventoryItem = OrderRecord & {
  active: boolean;
  batch: OrderRecord;
  batchId: string;
  inventoryStatus: BatchStatus;
  itemId: string;
};

export function IngredientBatches({ onNew }: { onNew: () => void }) {
  const [data, setData] = useState<OrdersState>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [imageError, setImageError] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [status, setStatus] = useState<'all' | BatchStatus>('all');
  const [sort, setSort] = useState('newest');
  const [showArchived, setShowArchived] = useState(false);
  const [selected, setSelected] = useState<InventoryItem>();
  const [editing, setEditing] = useState<InventoryItem>();
  const [archiving, setArchiving] = useState<InventoryItem>();
  const [imageFile, setImageFile] = useState<File>();
  const [form, setForm] = useState({
    name: '',
    category: '',
    description: '',
    price: '',
    currency: 'MYR',
  });

  const load = useCallback(async (withLoading = false) => {
    if (withLoading) setLoading(true);
    setError('');
    try {
      setData(await getOrders());
    } catch (cause) {
      setError(message(cause, 'The ingredient batch service is unavailable.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const items = useMemo(
    () =>
      (data?.catalogue ?? [])
        .flatMap((item) =>
          item.batches.map((batchId: string) => {
            const summary = item.batchSummaries?.[batchId] ?? item;
            const batch =
              item.batchDetails?.find((entry: OrderRecord) => entry.batchId === batchId) ?? {};
            const merged = {
              ...item,
              ...summary,
              itemId: `${item.itemId}:${batchId}`,
              batchId,
              batches: [batchId],
              batchDetails: Object.keys(batch).length ? [batch] : [],
              batch,
            } as InventoryItem;
            merged.inventoryStatus = inventoryStatus(merged);
            merged.active = merged.inventoryStatus === 'active';
            return merged;
          }),
        )
        .filter(
          (item) =>
            Number(item.kind) === 1 && item.seller?.toLowerCase() === data?.actor.toLowerCase(),
        ),
    [data],
  );

  const categories = useMemo(
    () =>
      [...new Set(items.map((item) => item.category).filter(Boolean) as string[])].sort((a, b) =>
        a.localeCompare(b),
      ),
    [items],
  );

  const shown = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return items
      .filter((item) => {
        const matchesSearch = [item.name, item.batchReference]
          .filter(Boolean)
          .some((value) => String(value).toLocaleLowerCase().includes(query));
        const archivedVisible =
          item.inventoryStatus !== 'archived' || showArchived || status === 'archived';
        return (
          archivedVisible &&
          (!query || matchesSearch) &&
          (category === 'all' || item.category === category) &&
          (status === 'all' || item.inventoryStatus === status)
        );
      })
      .sort((left, right) => compareItems(left, right, sort));
  }, [category, items, search, showArchived, sort, status]);

  const summary = useMemo(() => inventorySummary(items), [items]);
  const filtersActive =
    Boolean(search.trim()) ||
    category !== 'all' ||
    status !== 'all' ||
    sort !== 'newest' ||
    showArchived;

  const clearFilters = () => {
    setSearch('');
    setCategory('all');
    setStatus('all');
    setSort('newest');
    setShowArchived(false);
  };

  const openEdit = (item: InventoryItem) => {
    setEditing(item);
    setSelected(undefined);
    setArchiving(undefined);
    setImageFile(undefined);
    setImageError('');
    setForm({
      name: item.name,
      category: item.category ?? '',
      description: item.description ?? '',
      price: item.price ?? '',
      currency: item.currency ?? 'MYR',
    });
  };

  const valid =
    form.name.trim() &&
    form.category.trim() &&
    /^[A-Z]{3}$/.test(form.currency) &&
    (!form.price || /^(0|[1-9]\d{0,11})(\.\d{1,2})?$/.test(form.price));

  const save = async (action: string, values: Record<string, unknown>) => {
    if (!data) return;
    setBusy(true);
    setError('');
    setNotice('');
    let confirmed = false;
    try {
      const prepared = await prepareOrder({ action, operationId: crypto.randomUUID(), ...values });
      await submitProductionTransaction(prepared.transaction, data.actor);
      confirmed = true;
      setEditing(undefined);
      setArchiving(undefined);
      setNotice(
        action === 'ingredient-update'
          ? 'Listing updated successfully. Signed credential claims are unchanged.'
          : values.archived
            ? 'Ingredient archived successfully. Traceability history is preserved.'
            : 'Ingredient restored successfully.',
      );
      await load();
    } catch (cause) {
      setError(
        confirmed
          ? 'Transaction confirmed but refresh failed. Refresh the list; do not submit it again.'
          : message(cause, 'The ingredient listing could not be updated.'),
      );
    } finally {
      setBusy(false);
    }
  };

  const uploadImage = async (item: InventoryItem) => {
    if (!imageFile) return;
    setBusy(true);
    setImageError('');
    setNotice('');
    try {
      await uploadIngredientCatalogueImage(item.batchId, await imageFilePayload(imageFile));
      setImageFile(undefined);
      setNotice(
        'Supplier-provided ingredient image updated. Credential claims and batch history are unchanged.',
      );
      setSelected(undefined);
      setEditing(undefined);
      await load();
    } catch (cause) {
      setImageError(
        message(
          cause,
          'The ingredient image could not be saved. The current image remains unchanged.',
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="ingredient-inventory" aria-label="Ingredient batches">
      <SectionTitle
        title="Ingredient batches"
        sub="Register and manage the ingredients supplied by your company."
        action={
          <div className="ingredient-page-actions">
            <Btn
              variant="outline"
              icon={<RefreshCw size={16} />}
              disabled={busy || loading}
              onClick={() => void load(true)}
            >
              Refresh
            </Btn>
            <Btn icon={<Plus size={16} />} onClick={onNew}>
              Register ingredient batch
            </Btn>
          </div>
        }
      />

      {error && (
        <div className="ingredient-page-alert">
          <Alert type="error" message={serviceError(error)} />
          {!data && (
            <Btn variant="outline" size="sm" onClick={() => void load(true)}>
              Try again
            </Btn>
          )}
        </div>
      )}
      {notice && (
        <div role="status">
          <Alert type="success" message={notice} />
        </div>
      )}

      {!loading && data && (
        <>
          <div className="ingredient-summary-grid" aria-label="Ingredient inventory summary">
            <InventorySummaryCard
              label="Active batches"
              value={summary.active}
              icon={<PackageCheck size={21} />}
            />
            <InventorySummaryCard
              label="Available quantity"
              value={summary.available.value}
              note={summary.available.note}
              icon={<Boxes size={21} />}
            />
            <InventorySummaryCard
              label="Expiring soon"
              value={summary.expiring}
              note="Within 30 days"
              icon={<CalendarClock size={21} />}
            />
            <InventorySummaryCard
              label="Archived batches"
              value={summary.archived}
              icon={<Archive size={21} />}
            />
          </div>

          <div className="ingredient-toolbar" aria-label="Ingredient batch filters">
            <Input
              label="Search batches"
              type="search"
              icon={<Search size={17} />}
              placeholder="Ingredient name or batch reference"
              value={search}
              onChange={setSearch}
            />
            <SelectField
              label="Category"
              value={category}
              onChange={setCategory}
              options={[
                { value: 'all', label: 'All categories' },
                ...categories.map((value) => ({ value, label: value })),
              ]}
            />
            <SelectField
              label="Status"
              value={status}
              onChange={(value) => setStatus(value as typeof status)}
              options={[
                { value: 'all', label: 'All statuses' },
                { value: 'active', label: 'Active' },
                { value: 'suspended', label: 'Suspended' },
                { value: 'recalled', label: 'Recalled' },
                { value: 'expired', label: 'Expired' },
                { value: 'archived', label: 'Archived' },
              ]}
            />
            <SelectField
              label="Sort"
              value={sort}
              onChange={setSort}
              options={[
                { value: 'newest', label: 'Newest' },
                { value: 'name', label: 'Name A–Z' },
                { value: 'expiry', label: 'Expiry soonest' },
                { value: 'stock', label: 'Lowest stock' },
              ]}
            />
            <label className="ingredient-archive-toggle">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(event) => setShowArchived(event.target.checked)}
              />
              Show archived
            </label>
            <Btn
              variant="ghost"
              size="sm"
              icon={<FilterX size={15} />}
              disabled={!filtersActive}
              onClick={clearFilters}
            >
              Clear filters
            </Btn>
          </div>

          <div className="ingredient-results-heading">
            <strong aria-live="polite">
              {shown.length} {shown.length === 1 ? 'batch' : 'batches'}
            </strong>
            <span>Supplier images and descriptions are presentation information.</span>
          </div>
        </>
      )}

      {loading ? (
        <IngredientLoading />
      ) : !data ? null : !items.length ? (
        <EmptyState
          icon={<Boxes size={44} />}
          title="No registered ingredients"
          sub="Register your first on-chain ingredient batch to begin managing inventory."
          action={<Btn onClick={onNew}>Register ingredient batch</Btn>}
        />
      ) : !shown.length ? (
        <EmptyState
          icon={<Search size={44} />}
          title="No batches match these filters"
          sub="Clear or adjust the filters to see more ingredient batches."
          action={<Btn onClick={clearFilters}>Clear filters</Btn>}
        />
      ) : (
        <div className="ingredient-grid">
          {shown.map((item) => (
            <IngredientCard
              key={item.itemId}
              item={item}
              stock={data.supplierStock?.find(
                (stock) => stock.batchId.toLowerCase() === item.batchId.toLowerCase(),
              )}
              busy={busy}
              onDetails={() => setSelected(item)}
              onEdit={() => openEdit(item)}
              onArchive={() => setArchiving(item)}
              onRestore={() =>
                void save('ingredient-archive', { batchId: item.batchId, archived: false })
              }
            />
          ))}
        </div>
      )}

      {selected && (
        <IngredientDetailModal
          item={selected}
          busy={busy}
          imageFile={imageFile}
          imageError={imageError}
          onArchive={() => {
            setArchiving(selected);
            setSelected(undefined);
          }}
          onClose={() => {
            setSelected(undefined);
            setImageFile(undefined);
            setImageError('');
          }}
          onEdit={() => openEdit(selected)}
          onImageFile={(file) => {
            setImageFile(file);
            setImageError('');
          }}
          onRestore={() => {
            const batchId = selected.batchId;
            setSelected(undefined);
            void save('ingredient-archive', { batchId, archived: false });
          }}
          onUpload={() => void uploadImage(selected)}
        />
      )}

      {editing && (
        <Modal
          title={`Edit listing — ${editing.name}`}
          onClose={() => setEditing(undefined)}
          width={720}
        >
          <div className="ingredient-edit-form">
            <Alert
              type="info"
              message="Only Supplier-provided listing information can be edited. Signed ingredient claims, quantity, unit, origin, dates and credential data remain immutable."
            />
            <div className="workspace-form-grid">
              <Input
                label="Listing name"
                value={form.name}
                onChange={(name) => setForm((current) => ({ ...current, name }))}
                required
                maxLength={160}
              />
              <Input
                label="Listing category"
                value={form.category}
                onChange={(nextCategory) =>
                  setForm((current) => ({ ...current, category: nextCategory }))
                }
                required
                maxLength={80}
              />
              <Input
                label="Listing description"
                value={form.description}
                onChange={(description) => setForm((current) => ({ ...current, description }))}
                maxLength={1000}
              />
              <Input
                label={`Price per ${editing.unit}`}
                value={form.price}
                onChange={(price) => setForm((current) => ({ ...current, price }))}
                type="number"
                min="0"
                step="0.01"
              />
              <Input
                label="Currency code"
                value={form.currency}
                onChange={(currency) =>
                  setForm((current) => ({ ...current, currency: currency.toUpperCase() }))
                }
                maxLength={3}
              />
            </div>
            <div className="ingredient-modal-actions">
              <Btn
                disabled={busy || !valid}
                onClick={() =>
                  void save('ingredient-update', {
                    batchId: editing.batchId,
                    expectedHash: editing.listingHash,
                    name: form.name.trim(),
                    category: form.category.trim(),
                    description: form.description.trim(),
                    ...(form.price ? { price: form.price } : {}),
                    currency: form.currency,
                  })
                }
              >
                {busy ? 'Saving…' : 'Save listing'}
              </Btn>
              <Btn variant="outline" disabled={busy} onClick={() => setEditing(undefined)}>
                Cancel
              </Btn>
            </div>
          </div>
        </Modal>
      )}

      {archiving && (
        <Modal title="Archive ingredient listing?" onClose={() => setArchiving(undefined)}>
          <div className="ingredient-confirmation">
            <p>
              <strong>{archiving.name}</strong> will no longer accept new requests. Its credential,
              previous requests and traceability history remain, and the listing can be restored.
            </p>
            <div className="ingredient-modal-actions">
              <Btn
                variant="danger"
                disabled={busy}
                onClick={() =>
                  void save('ingredient-archive', {
                    batchId: archiving.batchId,
                    archived: true,
                  })
                }
              >
                {busy ? 'Archiving…' : 'Confirm archive'}
              </Btn>
              <Btn variant="outline" disabled={busy} onClick={() => setArchiving(undefined)}>
                Cancel
              </Btn>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}

function IngredientCard({
  item,
  stock,
  busy,
  onDetails,
  onEdit,
  onArchive,
  onRestore,
}: {
  item: InventoryItem;
  stock?: SupplierStock;
  busy: boolean;
  onDetails: () => void;
  onEdit: () => void;
  onArchive: () => void;
  onRestore: () => void;
}) {
  return (
    <article className="ingredient-card">
      <div className="ingredient-card__media">
        <CatalogueImage
          path={item.imagePath}
          category={item.category}
          alt={`Supplier-provided image of ${item.name}`}
        />
        <div className="ingredient-card__status">
          <Badge {...statusBadge(item.inventoryStatus)} />
        </div>
      </div>
      <div className="ingredient-card__body">
        <div className="ingredient-card__identity">
          <h3 title={item.name}>{item.name}</h3>
          <p>{item.batchReference || 'Batch reference unavailable'}</p>
        </div>
        <div className="ingredient-card__meta">
          <span>{item.category || 'Category unavailable'}</span>
          {item.countryOfOrigin && <span>{item.countryOfOrigin}</span>}
        </div>
        <dl className="ingredient-card__highlights">
          <Fact
            label="Available"
            value={quantity(item.batch.supplierAvailable, item.unit, 'Unavailable')}
          />
          <Fact label="Indicative price" value={price(item)} />
        </dl>
        {stock && <SupplierStockSummary stock={stock} />}
        <dl className="ingredient-card__dates">
          <Fact label="Produced" value={date(item.batch.producedAt)} />
          <Fact label="Expires" value={date(item.batch.expiresAt)} />
        </dl>
        {expiryWarning(item.batch.expiresAt) && (
          <p className="catalogue-warning">{expiryWarning(item.batch.expiresAt)}</p>
        )}
        <div className="ingredient-card__credential">
          <span>Credential</span>
          <Badge
            label={Number(item.credentialStatus) === 1 ? 'Active' : 'Status unavailable'}
            variant={Number(item.credentialStatus) === 1 ? 'verified' : 'pending'}
            size="xs"
          />
        </div>
        {item.listingSupported === false && (
          <p className="ingredient-card__notice">
            Listing controls require the current registry deployment.
          </p>
        )}
        <div className="ingredient-card__actions">
          <Btn onClick={onDetails}>View details</Btn>
          <Btn
            icon={<Pencil size={14} />}
            variant="outline"
            size="sm"
            disabled={busy || !item.listingSupported || item.inventoryStatus === 'archived'}
            onClick={onEdit}
          >
            Edit listing
          </Btn>
          {item.inventoryStatus === 'archived' ? (
            <Btn
              icon={<RotateCcw size={14} />}
              variant="outline"
              size="sm"
              disabled={busy || !item.listingSupported}
              onClick={onRestore}
            >
              Restore
            </Btn>
          ) : (
            <Btn
              icon={<Archive size={14} />}
              variant="ghost"
              size="sm"
              disabled={busy || !item.listingSupported}
              onClick={onArchive}
            >
              Archive
            </Btn>
          )}
        </div>
      </div>
    </article>
  );
}

function IngredientDetailModal({
  item,
  busy,
  imageFile,
  imageError,
  onArchive,
  onClose,
  onEdit,
  onImageFile,
  onRestore,
  onUpload,
}: {
  item: InventoryItem;
  busy: boolean;
  imageFile?: File;
  imageError: string;
  onArchive: () => void;
  onClose: () => void;
  onEdit: () => void;
  onImageFile: (file?: File) => void;
  onRestore: () => void;
  onUpload: () => void;
}) {
  const company = item.sellerName ?? 'Authenticated Supplier';
  return (
    <Modal title={item.name} onClose={onClose} width={840}>
      <div className="ingredient-detail">
        <div className="ingredient-detail__hero">
          <CatalogueImage
            path={item.imagePath}
            category={item.category}
            alt={`Supplier-provided image of ${item.name}`}
            large
          />
          <div className="ingredient-detail__summary">
            <div className="ingredient-card__meta">
              <Badge {...statusBadge(item.inventoryStatus)} />
              <Badge
                label={
                  Number(item.credentialStatus) === 1
                    ? 'Credential active'
                    : 'Credential unavailable'
                }
                variant={Number(item.credentialStatus) === 1 ? 'verified' : 'pending'}
              />
            </div>
            <div>
              <h3>{item.name}</h3>
              <p>{item.batchReference || 'Batch reference unavailable'}</p>
            </div>
            <dl className="ingredient-detail__summary-facts">
              <Fact label="Category" value={item.category || 'Unavailable'} />
              <Fact label="Supplier" value={company} />
            </dl>
          </div>
        </div>

        <Alert
          type="info"
          message="The image, description and indicative price are Supplier-provided presentation information. They are not signed credential claims or laboratory evidence."
        />

        <div className="ingredient-detail__facts">
          <section>
            <h4>Inventory</h4>
            <dl>
              <Fact
                label="Registered quantity"
                value={quantity(item.batch.totalQuantity, item.unit, 'Unavailable')}
              />
              <Fact
                label="Available quantity"
                value={quantity(item.batch.supplierAvailable, item.unit, 'Unavailable')}
              />
            </dl>
          </section>
          <section>
            <h4>Dates and origin</h4>
            <dl>
              <Fact label="Production date" value={date(item.batch.producedAt)} />
              <Fact label="Expiry date" value={date(item.batch.expiresAt)} />
              <Fact label="Country of origin" value={item.countryOfOrigin || 'Not recorded'} />
            </dl>
          </section>
          <section>
            <h4>Listing information</h4>
            <dl>
              <Fact label="Indicative price" value={price(item)} />
              <Fact label="Description" value={item.description || 'No description provided'} />
              <Fact
                label="Credential lifecycle"
                value={item.evidenceAvailability || 'Status unavailable'}
              />
            </dl>
          </section>
        </div>

        <section className="ingredient-image-manager" aria-labelledby="ingredient-image-title">
          <div>
            <h4 id="ingredient-image-title">Ingredient image</h4>
            <p>
              Optional PNG, JPEG or WebP presentation image, maximum 2 MB. This does not change the
              credential or verify the physical ingredient.
            </p>
          </div>
          <input
            aria-label="Choose ingredient image"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={busy}
            onChange={(event) => onImageFile(event.target.files?.[0])}
          />
          <Btn
            variant="outline"
            icon={<Upload size={15} />}
            disabled={busy || !imageFile}
            onClick={onUpload}
          >
            {item.imagePath ? 'Change image' : 'Upload image'}
          </Btn>
        </section>
        {imageError && <Alert type="error" message={imageError} />}

        <div className="ingredient-modal-actions">
          {item.inventoryStatus !== 'archived' && (
            <Btn
              variant="outline"
              icon={<Pencil size={14} />}
              disabled={busy || !item.listingSupported}
              onClick={onEdit}
            >
              Edit listing
            </Btn>
          )}
          {item.inventoryStatus === 'archived' ? (
            <Btn
              variant="outline"
              icon={<RotateCcw size={14} />}
              disabled={busy || !item.listingSupported}
              onClick={onRestore}
            >
              Restore listing
            </Btn>
          ) : (
            <Btn
              variant="ghost"
              icon={<Archive size={14} />}
              disabled={busy || !item.listingSupported}
              onClick={onArchive}
            >
              Archive listing
            </Btn>
          )}
        </div>

        <TechnicalDetails
          fields={[
            { label: 'Ingredient batch ID', value: item.batchId },
            { label: 'Supplier wallet', value: item.seller },
            { label: 'Listing metadata hash', value: item.listingHash ?? '' },
          ]}
        />
      </div>
    </Modal>
  );
}

function IngredientLoading() {
  return (
    <div className="ingredient-grid" role="status" aria-label="Loading ingredient batches">
      {[0, 1, 2].map((entry) => (
        <div key={entry} className="ingredient-card ingredient-card--loading" />
      ))}
      <span className="sr-only">Loading ingredient batches</span>
    </div>
  );
}

function InventorySummaryCard({
  label,
  value,
  note,
  icon,
}: {
  label: string;
  value: string | number;
  note?: string;
  icon: ReactNode;
}) {
  return (
    <article className="ingredient-summary-card">
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        {note && <small>{note}</small>}
      </div>
      <span aria-hidden="true">{icon}</span>
    </article>
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

function inventoryStatus(item: OrderRecord): BatchStatus {
  if (item.archived) return 'archived';
  const batch = item.batch ?? item.batchDetails?.[0] ?? {};
  if (Number(batch.expiresAt) <= Date.now() / 1000) return 'expired';
  if (Number(batch.status) === 2) return 'suspended';
  if (Number(batch.status) === 3) return 'recalled';
  return 'active';
}

function statusBadge(status: BatchStatus) {
  if (status === 'active') return { label: 'Active', variant: 'active' as const };
  if (status === 'suspended') return { label: 'Suspended', variant: 'suspended' as const };
  if (status === 'recalled') return { label: 'Recalled', variant: 'revoked' as const };
  if (status === 'expired') return { label: 'Expired', variant: 'expired' as const };
  return { label: 'Archived', variant: 'pending' as const };
}

function compareItems(left: InventoryItem, right: InventoryItem, sort: string) {
  if (sort === 'name') return String(left.name).localeCompare(String(right.name));
  if (sort === 'expiry')
    return (
      numeric(left.batch.expiresAt, Number.MAX_SAFE_INTEGER) -
      numeric(right.batch.expiresAt, Number.MAX_SAFE_INTEGER)
    );
  if (sort === 'stock')
    return (
      numeric(left.batch.supplierAvailable, Number.MAX_SAFE_INTEGER) -
      numeric(right.batch.supplierAvailable, Number.MAX_SAFE_INTEGER)
    );
  return numeric(right.registeredBlock) - numeric(left.registeredBlock);
}

function inventorySummary(items: InventoryItem[]) {
  const active = items.filter((item) => item.inventoryStatus === 'active');
  const available = active.filter((item) =>
    /^\d+$/.test(String(item.batch.supplierAvailable ?? '')),
  );
  const units = [...new Set(available.map((item) => String(item.unit)))];
  const availableSummary =
    available.length === 0
      ? { value: 'Unavailable', note: 'No comparable quantities' }
      : units.length === 1
        ? {
            value: available
              .reduce((sum, item) => sum + BigInt(String(item.batch.supplierAvailable)), 0n)
              .toLocaleString(),
            note: units[0],
          }
        : { value: `Across ${available.length} batches`, note: 'Multiple units are not combined' };
  return {
    active: active.length,
    available: availableSummary,
    expiring: active.filter((item) => {
      const days = expiryDays(item.batch.expiresAt);
      return days >= 0 && days <= 30;
    }).length,
    archived: items.filter((item) => item.inventoryStatus === 'archived').length,
  };
}

function price(item: OrderRecord) {
  return item.price !== undefined
    ? `${item.currency ?? 'MYR'} ${item.price} / ${item.unit}`
    : 'Not provided';
}

function quantity(value: unknown, unit: string, fallback: string) {
  return value !== undefined && value !== null ? `${String(value)} ${unit}` : fallback;
}

function date(value: unknown) {
  return Number(value)
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(Number(value) * 1_000)
    : 'Not recorded';
}

function expiryDays(value: unknown) {
  return Number(value)
    ? Math.ceil((Number(value) * 1_000 - Date.now()) / 86_400_000)
    : Number.POSITIVE_INFINITY;
}

function expiryWarning(value: unknown) {
  const days = expiryDays(value);
  if (!Number.isFinite(days)) return '';
  if (days < 0) return 'Expired';
  return days <= 30 ? `Expires in ${days} days` : '';
}

function numeric(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function message(cause: unknown, fallback: string) {
  return cause instanceof Error ? cause.message : fallback;
}

function serviceError(error: string) {
  if (/rpc|blockchain|network|provider/i.test(error)) return `Blockchain/RPC unavailable. ${error}`;
  return error;
}
