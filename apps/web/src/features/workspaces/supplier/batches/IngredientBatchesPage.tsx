import { LoadingIndicator } from '../../../../components/ui/LoadingIndicator';
import { PaginationBar, usePagination } from '../../../../components/ui/PaginatedTable';
import './ingredients.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  ArrowRightLeft,
  Boxes,
  CalendarClock,
  FileText,
  FilterX,
  ImagePlus,
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
  InventoryFact as Fact,
  InventorySummaryCard,
  InventoryViewToggle,
  openCardOnClick,
  Modal,
  SectionTitle,
  SelectField,
  TechnicalDetails,
} from '../../shared/ui';

type BatchStatus = 'active' | 'suspended' | 'recalled' | 'expired' | 'archived';
type IngredientView = 'list' | 'grid';

const INGREDIENT_VIEW_STORAGE_KEY = 'tracechain:supplier-ingredient-view';

type InventoryItem = OrderRecord & {
  active: boolean;
  batch: OrderRecord;
  batchId: string;
  inventoryStatus: BatchStatus;
  itemId: string;
};

export function IngredientBatches({
  onNew,
  openBatchId,
  onOpened,
}: {
  onNew: () => void;
  /** Batch to open once it appears, e.g. right after registration. */
  openBatchId?: string;
  onOpened?: () => void;
}) {
  const [view, setView] = useState<IngredientView>(readIngredientView);
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
  const [selected, setSelected] = useState<InventoryItem>();
  const [editing, setEditing] = useState<InventoryItem>();
  const [archiving, setArchiving] = useState<InventoryItem>();
  const [imageFile, setImageFile] = useState<File>();
  const [form, setForm] = useState({
    name: '',
    category: '',
    description: '',
    price: '',
    priceBasis: '',
    currency: 'MYR',
  });

  const load = useCallback(async (withLoading = false) => {
    if (withLoading) setLoading(true);
    setError('');
    try {
      setData(await getOrders('supplier-inventory'));
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

  useEffect(() => {
    if (!openBatchId) return;
    const created = items.find((item) => item.batchId.toLowerCase() === openBatchId.toLowerCase());
    if (!created) return;
    setSelected(created);
    onOpened?.();
  }, [items, openBatchId, onOpened]);

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
        const archivedVisible = item.inventoryStatus !== 'archived' || status === 'archived';
        return (
          archivedVisible &&
          (!query || matchesSearch) &&
          (category === 'all' || item.category === category) &&
          (status === 'all' || item.inventoryStatus === status)
        );
      })
      .sort((left, right) => compareItems(left, right, sort));
  }, [category, items, search, sort, status]);
  const pagination = usePagination(shown.map((item) => item.itemId));

  const summary = useMemo(() => inventorySummary(items), [items]);
  const filtersActive =
    Boolean(search.trim()) || category !== 'all' || status !== 'all' || sort !== 'newest';

  const clearFilters = () => {
    setSearch('');
    setCategory('all');
    setStatus('all');
    setSort('newest');
  };

  const changeView = (nextView: IngredientView) => {
    setView(nextView);
    try {
      window.localStorage.setItem(INGREDIENT_VIEW_STORAGE_KEY, nextView);
    } catch {
      // Storage can be unavailable in privacy-restricted browsers; the in-memory choice still works.
    }
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
      priceBasis: item.priceBasis ?? item.unit,
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
        title="My ingredients"
        sub="Your registered ingredient batches, their stock and listing status."
        action={
          <div className="ingredient-page-actions action-row">
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
                { value: 'all', label: 'All except archived' },
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
            <div className="ingredient-results-copy">
              <strong aria-live="polite">
                {shown.length} {shown.length === 1 ? 'batch' : 'batches'}
              </strong>
            </div>
            <InventoryViewToggle value={view} onChange={changeView} label="Ingredient view" />
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
        <>
          <div className={`ingredient-grid ingredient-grid--${view}`}>
            {shown.slice(pagination.start, pagination.end).map((item) => (
              <IngredientCard
                key={item.itemId}
                item={item}
                view={view}
                onDetails={() => setSelected(item)}
              />
            ))}
          </div>
          <PaginationBar pagination={pagination} label="Ingredient pages" />
        </>
      )}

      {selected && (
        <IngredientDetailModal
          item={selected}
          stock={data?.supplierStock?.find(
            (stock) => stock.batchId.toLowerCase() === selected.batchId.toLowerCase(),
          )}
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
                label={`Price per ${form.priceBasis || editing.unit}`}
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
            <div className="ingredient-modal-actions action-row">
              <Btn variant="outline" disabled={busy} onClick={() => setEditing(undefined)}>
                Cancel
              </Btn>
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
                    priceBasis: form.priceBasis,
                  })
                }
              >
                {busy ? 'Saving…' : 'Save listing'}
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
            <div className="ingredient-modal-actions action-row">
              <Btn variant="outline" disabled={busy} onClick={() => setArchiving(undefined)}>
                Cancel
              </Btn>
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
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}

function IngredientCard({
  item,
  view,
  onDetails,
}: {
  item: InventoryItem;
  view: IngredientView;
  onDetails: () => void;
}) {
  const credentialActive = Number(item.credentialStatus) === 1;
  const listingStatus = statusBadge(item.inventoryStatus);

  const primaryActions = (
    <div className="ingredient-card__primary-actions">
      <Btn variant="outline" onClick={onDetails}>
        View details
      </Btn>
    </div>
  );

  return (
    <article
      className={`ingredient-card ingredient-card--${view} is-clickable`}
      onClick={openCardOnClick(onDetails)}
    >
      <div className="ingredient-card__media">
        <CatalogueImage
          path={item.imagePath}
          category={item.category}
          alt={`Supplier-provided image of ${item.name}`}
        />
        {view === 'grid' && (
          <div className="ingredient-card__status">
            <Badge {...listingStatus} />
          </div>
        )}
      </div>
      {view === 'grid' ? (
        <div className="ingredient-card__body">
          <IngredientIdentity item={item} />
          <dl className="ingredient-card__highlights">
            <Fact
              label="Available"
              value={quantity(item.batch.supplierAvailable, item.unit, 'Unavailable')}
            />
            <Fact label="Indicative price" value={price(item)} />
          </dl>
          <dl className="ingredient-card__dates ingredient-card__dates--collapsed">
            <Fact label="Expires" value={date(item.batch.expiresAt)} />
          </dl>
          <div className="ingredient-card__credential">
            <span>Credential</span>
            <CredentialStatus active={credentialActive} />
          </div>
          {primaryActions}
        </div>
      ) : (
        <>
          <div className="ingredient-card__list-content">
            <div className="ingredient-card__list-heading">
              <IngredientIdentity item={item} />
              <div className="ingredient-card__list-status" aria-label="Listing status">
                <span>Listing status</span>
                <Badge {...listingStatus} />
              </div>
            </div>
            <dl className="ingredient-card__list-metrics">
              <Fact
                label="Available quantity"
                value={quantity(item.batch.supplierAvailable, item.unit, 'Unavailable')}
              />
              <Fact label="Indicative price" value={price(item)} />
              <Fact label="Expires" value={expiryInformation(item.batch.expiresAt)} />
              <Fact
                label="Credential status"
                value={<CredentialStatus active={credentialActive} />}
              />
            </dl>
          </div>
          {primaryActions}
        </>
      )}
    </article>
  );
}

function IngredientIdentity({ item }: { item: InventoryItem }) {
  return (
    <div className="ingredient-card__identity">
      <h3 title={item.name}>{item.name}</h3>
      <p title={item.batchReference || 'Batch reference unavailable'}>
        {item.batchReference || 'Batch reference unavailable'}
      </p>
    </div>
  );
}

function CredentialStatus({ active }: { active: boolean }) {
  return (
    <Badge
      label={active ? 'Active' : 'Status unavailable'}
      variant={active ? 'verified' : 'pending'}
      size="xs"
    />
  );
}

function IngredientDetailModal({
  item,
  stock,
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
  stock?: SupplierStock;
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
  const credentialActive = Number(item.credentialStatus) === 1;
  const custody = (item.custodyPositions ?? []).filter(
    (position: OrderRecord) => BigInt(position.quantity) > 0n,
  );
  const picker = useRef<HTMLInputElement>(null);
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
                label={credentialActive ? 'Credential active' : 'Credential unavailable'}
                variant={credentialActive ? 'verified' : 'pending'}
              />
            </div>
            <div>
              <h3>{item.name}</h3>
              <p>
                {[item.batchReference || 'Batch reference unavailable', item.category]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              <p>
                Supplier: <span>{company}</span>
              </p>
            </div>
            <div className="ingredient-detail__actions">
              <a
                className="ingredient-detail__link"
                href={
                  '/supplier/ingredients?view=batch-detail&id=' + encodeURIComponent(item.batchId)
                }
              >
                <FileText size={15} aria-hidden="true" /> Signed details & certificates
              </a>
              {item.inventoryStatus !== 'archived' && (
                <a
                  className="ingredient-detail__link"
                  href={'/supplier/transfers?batchId=' + encodeURIComponent(item.batchId)}
                >
                  <ArrowRightLeft size={15} aria-hidden="true" /> Send to custody
                </a>
              )}
            </div>
          </div>
        </div>

        <div className="ingredient-detail__facts">
          <section>
            <h4>Stock</h4>
            <dl>
              {/* With a stock summary below, current stock is shown there instead. */}
              {!stock && (
                <Fact
                  label="Available"
                  value={quantity(item.batch.supplierAvailable, item.unit, 'Unavailable')}
                />
              )}
              <Fact
                label="Registered"
                value={quantity(item.batch.totalQuantity, item.unit, 'Unavailable')}
              />
            </dl>
          </section>
          <section>
            <h4>Dates and origin</h4>
            <dl>
              <Fact label="Production date" value={date(item.batch.producedAt)} />
              <Fact label="Expiry" value={expiryInformation(item.batch.expiresAt)} />
              <Fact label="Country of origin" value={item.countryOfOrigin || 'Not recorded'} />
            </dl>
          </section>
          <section>
            <h4>Listing</h4>
            <dl>
              <Fact label="Indicative price" value={price(item)} />
              <Fact label="Description" value={item.description || 'No description provided'} />
            </dl>
            <p className="ingredient-detail__note">
              Image, description and price are your listing information, not signed credential
              claims.
            </p>
          </section>
        </div>

        {stock && <SupplierStockSummary stock={stock} />}

        {custody.length > 0 && (
          <section className="ingredient-detail__custody" aria-label="Stock in Distributor custody">
            <h4>In Distributor custody</h4>
            <ul>
              {custody.map((position: OrderRecord) => (
                <li key={position.positionId}>
                  <span>
                    <strong>{position.distributorName ?? 'Distributor'}</strong>
                    <small>{position.warehouseName ?? 'Warehouse'}</small>
                  </span>
                  <span>
                    {quantity(position.quantity, item.unit, '0')}
                    <small>{quantity(position.available, item.unit, '0')} unreserved</small>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="ingredient-image-manager" aria-labelledby="ingredient-image-title">
          <div>
            <h4 id="ingredient-image-title">Ingredient image</h4>
            <p>{imageFile ? `Selected: ${imageFile.name}` : 'PNG, JPEG or WebP, up to 2 MB.'}</p>
          </div>
          <div className="ingredient-image-manager__actions">
            {/* Native picker stays for accessibility and tests; the button opens it. */}
            <input
              ref={picker}
              className="sr-only"
              tabIndex={-1}
              aria-label="Choose ingredient image"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={busy}
              onChange={(event) => onImageFile(event.target.files?.[0])}
            />
            <Btn
              size="sm"
              variant="outline"
              icon={<ImagePlus size={15} />}
              disabled={busy}
              onClick={() => picker.current?.click()}
            >
              {imageFile ? 'Choose another' : 'Choose image'}
            </Btn>
            <Btn
              size="sm"
              icon={<Upload size={15} />}
              disabled={busy || !imageFile}
              onClick={onUpload}
            >
              {item.imagePath ? 'Change image' : 'Upload image'}
            </Btn>
          </div>
        </section>
        {imageError && <Alert type="error" message={imageError} />}

        {item.listingSupported === false && (
          <p className="ingredient-detail__note">
            Listing controls require the current registry deployment.
          </p>
        )}
        <div className="ingredient-modal-actions">
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
            <>
              <Btn
                variant="ghost"
                icon={<Archive size={14} />}
                disabled={busy || !item.listingSupported}
                onClick={onArchive}
              >
                Archive listing
              </Btn>
              <Btn
                variant="outline"
                icon={<Pencil size={14} />}
                disabled={busy || !item.listingSupported}
                onClick={onEdit}
              >
                Edit listing
              </Btn>
            </>
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
  return <LoadingIndicator page label="Loading ingredient batches" />;
}

function readIngredientView(): IngredientView {
  try {
    const stored = window.localStorage.getItem(INGREDIENT_VIEW_STORAGE_KEY);
    return stored === 'grid' ? 'grid' : 'list';
  } catch {
    return 'list';
  }
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
    ? `${item.currency ?? 'MYR'} ${item.price} / ${item.priceBasis || item.unit}`
    : 'Not provided';
}

function quantity(value: unknown, unit: string, fallback: string) {
  if (value === undefined || value === null) return fallback;
  const amount = Number(value);
  // Thousands separators only; the on-chain amount and unit are shown unchanged.
  return `${Number.isFinite(amount) ? amount.toLocaleString() : String(value)} ${unit}`;
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

function expiryInformation(value: unknown) {
  const recordedDate = date(value);
  const warning = expiryWarning(value);
  return warning ? `${recordedDate} · ${warning}` : recordedDate;
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
