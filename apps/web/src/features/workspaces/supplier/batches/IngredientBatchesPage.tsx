import { useCallback, useEffect, useState } from 'react';
import { Boxes, Plus, Pencil, Archive, RotateCcw, RefreshCw, Search } from 'lucide-react';
import { Alert, Badge, Btn, Card, EmptyState, Input, SectionTitle } from '../../shared/ui';
import {
  getOrders,
  prepareOrder,
  type OrdersState,
  type OrderRecord,
} from '../../../orders/orders.api';
import { submitProductionTransaction } from '../../../production-flow/production-flow.transaction';

export function IngredientBatches({
  onNew,
  onDetail,
}: {
  onNew: () => void;
  onDetail: (id: string) => void;
}) {
  const [data, setData] = useState<OrdersState>();
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [archived, setArchived] = useState(false),
    [search, setSearch] = useState('');
  const [editing, setEditing] = useState<OrderRecord>(),
    [deleting, setDeleting] = useState<OrderRecord>();
  const [form, setForm] = useState({
    name: '',
    category: '',
    description: '',
    price: '',
    currency: 'MYR',
  });
  const load = useCallback(async () => {
    setData(await getOrders());
  }, []);
  useEffect(() => {
    void load()
      .catch((cause) => setError(cause.message))
      .finally(() => setLoading(false));
  }, [load]);
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
      setDeleting(undefined);
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
          : cause instanceof Error
            ? cause.message
            : 'Ingredient could not be updated.',
      );
    } finally {
      setBusy(false);
    }
  };
  const items = (data?.catalogue ?? [])
    .flatMap((item) =>
      item.batches.map((batchId: string) => {
        const summary = item.batchSummaries?.[batchId] ?? item;
        const batch = item.batchDetails?.find((entry: OrderRecord) => entry.batchId === batchId);
        return {
          ...item,
          ...summary,
          itemId: item.itemId + ':' + batchId,
          batches: [batchId],
          batchDetails: batch ? [batch] : [],
          active:
            !!batch &&
            Number(batch.status) === 1 &&
            Number(batch.expiresAt) > Date.now() / 1000 &&
            !summary.archived,
        };
      }),
    )
    .filter(
      (item) => Number(item.kind) === 1 && item.seller.toLowerCase() === data?.actor.toLowerCase(),
    );
  const shown = items.filter(
    (item) =>
      Boolean(item.archived) === archived &&
      (item.name + ' ' + (item.batchReference ?? '')).toLowerCase().includes(search.toLowerCase()),
  );
  const edit = (item: OrderRecord) => {
    setEditing(item);
    setDeleting(undefined);
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
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <SectionTitle
        title="Ingredient batches"
        sub="Manage your ingredients, listing details and prices. Registered ingredients are visible to Manufacturers automatically."
        action={
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <Btn
              variant="outline"
              icon={<RefreshCw size={16} />}
              disabled={busy}
              onClick={() => void load().catch((cause) => setError(cause.message))}
            >
              Refresh
            </Btn>
            <Btn icon={<Plus size={16} />} onClick={onNew}>
              Register Ingredient Batch
            </Btn>
          </div>
        }
      />
      {error && <Alert type="error" message={error} />}
      {notice && (
        <div role="status">
          <Alert type="success" message={notice} />
        </div>
      )}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ flex: '1 1 280px', maxWidth: 640, minWidth: 0 }}>
          <Input
            label="Search ingredients"
            type="search"
            icon={<Search size={18} />}
            placeholder="Search by ingredient name or batch reference…"
            hint="Start typing to filter your ingredients. Use Show archived ingredients to search archived listings."
            value={search}
            onChange={setSearch}
          />
        </div>
        <label>
          <input
            type="checkbox"
            checked={archived}
            onChange={(event) => setArchived(event.target.checked)}
          />
          Show archived ingredients
        </label>
      </div>
      {loading && <p role="status">Loading ingredient batches...</p>}
      {editing && (
        <Card>
          <h3>Edit ingredient listing</h3>
          <p>
            Listing fields are Supplier-provided business information. Signed ingredient claims,
            quantity, unit, origin and credential dates are preserved. Register a new batch to
            revise signed credential claims.
          </p>
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
              onChange={(category) => setForm((current) => ({ ...current, category }))}
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
              label={'Price per ' + editing.unit}
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
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            <Btn
              disabled={busy || !valid}
              onClick={() =>
                void save('ingredient-update', {
                  batchId: editing.batches[0],
                  expectedHash: editing.listingHash,
                  name: form.name.trim(),
                  category: form.category.trim(),
                  description: form.description.trim(),
                  ...(form.price ? { price: form.price } : {}),
                  currency: form.currency,
                })
              }
            >
              Save listing
            </Btn>
            <Btn variant="outline" disabled={busy} onClick={() => setEditing(undefined)}>
              Cancel
            </Btn>
          </div>
        </Card>
      )}
      {deleting && (
        <Card>
          <h3>Delete ingredient from active listings?</h3>
          <p>
            {deleting.name} will be archived and unavailable for new requests. Its credential,
            previous requests and traceability history remain. You can restore the listing later.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Btn
              variant="danger"
              disabled={busy}
              onClick={() =>
                void save('ingredient-archive', { batchId: deleting.batches[0], archived: true })
              }
            >
              Confirm archive
            </Btn>
            <Btn variant="outline" disabled={busy} onClick={() => setDeleting(undefined)}>
              Cancel
            </Btn>
          </div>
        </Card>
      )}
      {!loading && !error && !shown.length && (
        <EmptyState
          icon={<Boxes size={44} />}
          title={archived ? 'No archived ingredients' : 'No on-chain ingredient batches'}
          sub="Register an ingredient or change your filters."
          action={!archived ? <Btn onClick={onNew}>Register Ingredient Batch</Btn> : undefined}
        />
      )}
      <div className="request-item-grid">
        {shown.map((item) => (
          <Card key={item.itemId}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Boxes size={22} />
              <h3>{item.name}</h3>
            </div>
            <Badge
              label={item.archived ? 'Archived' : item.active ? 'Active' : 'Unavailable'}
              variant={item.archived || !item.active ? 'pending' : 'active'}
            />
            <p>Reference: {item.batchReference ?? item.batches[0]}</p>
            <p>{item.category ?? 'Category unavailable'}</p>
            <p>
              {item.price !== undefined
                ? item.currency + ' ' + item.price + ' / ' + item.unit
                : 'Price unavailable'}
            </p>
            <p>
              Available: {item.batchDetails?.[0]?.supplierAvailable ?? 'Unavailable'} {item.unit}
            </p>
            {item.nameSource && (
              <p>
                Listing name is Supplier metadata; signed credential claims are in the batch
                details.
              </p>
            )}
            {item.listingSupported === false && (
              <p>Deploy the updated registry to enable edit and archive controls.</p>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <Btn variant="outline" size="sm" onClick={() => onDetail(item.batches[0])}>
                View details
              </Btn>
              <Btn
                icon={<Pencil size={14} />}
                variant="outline"
                size="sm"
                disabled={busy || !item.listingSupported}
                onClick={() => edit(item)}
              >
                Edit listing
              </Btn>
              {item.archived ? (
                <Btn
                  icon={<RotateCcw size={14} />}
                  variant="outline"
                  size="sm"
                  disabled={busy || !item.listingSupported}
                  onClick={() =>
                    void save('ingredient-archive', { batchId: item.batches[0], archived: false })
                  }
                >
                  Restore
                </Btn>
              ) : (
                <Btn
                  icon={<Archive size={14} />}
                  variant="outline"
                  size="sm"
                  disabled={busy || !item.listingSupported}
                  onClick={() => {
                    setDeleting(item);
                    setEditing(undefined);
                  }}
                >
                  Delete
                </Btn>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
