import { useEffect, useState } from 'react';
import { Package, Search } from 'lucide-react';
import { useOperationalData } from '../../../blockchain/useOperationalData';
import { OrdersPage } from '../../../orders/OrdersPage';
import { getOrders, type OrderRecord } from '../../../orders/orders.api';
import { Alert, Badge, Btn, Card, EmptyState, Input, SectionTitle } from '../../shared/ui';
import { chainDate, recordStatuses, shortChainId } from '../../shared/operational-format';

export function ProductBatches({
  onNew,
  onTransfer,
  onDetail,
  section = 'products',
  onSectionChange,
  ingredientBatchId,
}: {
  onNew: () => void;
  onTransfer: () => void;
  onDetail: (id: string) => void;
  section?: 'products' | 'ingredients';
  onSectionChange?: (section: 'products' | 'ingredients') => void;
  ingredientBatchId?: string;
}) {
  return (
    <div className="grid gap-[20px] min-w-0">
      <SectionTitle
        title="Products"
        sub="Manage your finished products and source ingredients from registered Suppliers."
        action={<Btn onClick={onNew}>Create product batch</Btn>}
      />
      <nav aria-label="Products and ingredients" className="flex flex-wrap gap-[8px]">
        <Btn
          variant={section === 'products' ? 'primary' : 'outline'}
          onClick={() => onSectionChange?.('products')}
        >
          My products
        </Btn>
        <Btn
          variant={section === 'ingredients' ? 'primary' : 'outline'}
          onClick={() => onSectionChange?.('ingredients')}
        >
          Supplier ingredients
        </Btn>
      </nav>
      {section === 'ingredients' ? (
        <OrdersPage
          key={ingredientBatchId ?? 'ingredients'}
          role="manufacturer"
          mode="browse"
          initialBatchId={ingredientBatchId}
        />
      ) : (
        <OwnedProducts onDetail={onDetail} onTransfer={onTransfer} />
      )}
    </div>
  );
}

function OwnedProducts({
  onDetail,
  onTransfer,
}: {
  onDetail: (id: string) => void;
  onTransfer: () => void;
}) {
  const { data, error, loading } = useOperationalData();
  const [catalogue, setCatalogue] = useState<OrderRecord[]>([]);
  const [metadataError, setMetadataError] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => {
    let active = true;
    void getOrders()
      .then((result) => {
        if (active) setCatalogue(result.catalogue);
      })
      .catch(() => {
        if (active)
          setMetadataError(
            'Readable product metadata is unavailable. Registered product records are still shown.',
          );
      });
    return () => {
      active = false;
    };
  }, []);
  const products = data.productBatches.filter((product) => {
    const item = catalogue.find((entry) => entry.batches?.includes(product.batchId));
    return [item?.name, item?.batchReference, product.batchId]
      .join(' ')
      .toLowerCase()
      .includes(search.toLowerCase());
  });
  return (
    <>
      <Input
        label="Search my products"
        type="search"
        icon={<Search size={18} />}
        placeholder="Search product name, reference or batch ID…"
        value={search}
        onChange={setSearch}
      />
      {error && <Alert type="error" message={error} />}
      {metadataError && <Alert type="warning" message={metadataError} />}
      {loading && <p role="status">Loading registered products…</p>}
      {!loading && !products.length && (
        <EmptyState
          icon={<Package size={44} />}
          title={search ? 'No matching products' : 'No on-chain product batches'}
          sub="Confirm ingredient receipt to create a product, or open Supplier ingredients to request stock. Ingredient evidence is optional."
        />
      )}
      <div className="request-item-grid">
        {products.map((product) => {
          const item = catalogue.find((entry) => entry.batches?.includes(product.batchId));
          return (
            <Card key={product.batchId}>
              <Package size={24} aria-hidden="true" className="text-ws-teal" />
              <h3>{item?.name ?? 'Registered product'}</h3>
              <p>{item?.batchReference ?? shortChainId(product.batchId)}</p>
              <Badge
                label={recordStatuses[product.status] ?? 'Unknown'}
                variant={product.status === 1 ? 'active' : 'pending'}
              />
              <p>
                {product.totalQuantity} {product.unit} · {product.ingredients.length} linked
                ingredients
              </p>
              <p>
                Produced: {chainDate(product.producedAt)} · Expires: {chainDate(product.expiresAt)}
              </p>
              <p>
                {item?.price !== undefined
                  ? `${item.currency} ${item.price} / ${product.unit}`
                  : 'Price unavailable'}
              </p>
              <div className="flex flex-wrap gap-[8px]">
                <Btn variant="outline" onClick={() => onDetail(product.batchId)}>
                  View product details
                </Btn>
                <Btn onClick={onTransfer}>Transfer</Btn>
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}
