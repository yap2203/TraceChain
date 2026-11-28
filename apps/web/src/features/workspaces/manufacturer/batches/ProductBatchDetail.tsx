import { BackNavigation } from '../../../../components/ui/BackNavigation';
import { LoadingIndicator } from '../../../../components/ui/LoadingIndicator';
import { useEffect, useState } from 'react';
import { getOrders, type OrderRecord } from '../../../orders/orders.api';
import { CatalogueImage, CompanyAvatar } from '../../../orders/CatalogueMedia';

import { useOperationalData } from '../../../blockchain/useOperationalData';
import {
  createProductQrPayload,
  ProductQrDisplay,
  resolveProductTraceability,
  type ProductTraceabilityResponse,
} from '../../../product-traceability';
import {
  Alert,
  Badge,
  Btn,
  Card,
  EmptyState,
  Table,
  TD,
  TechnicalDetails,
  TR,
} from '../../shared/ui';
import {
  chainDate,
  formatOperationalPrice,
  formatOperationalQuantity,
  hasPresentationValue,
  operationalUnit,
  recordStatuses,
  shortChainId,
} from '../../shared/operational-format';
export function ProductBatchDetail({
  batchId,
  onBack,
  onTransfer,
  onIngredientDetail,
}: {
  batchId: string;
  onBack: () => void;
  onTransfer: () => void;
  onIngredientDetail: (batchId: string) => void;
}) {
  const { data, error, loading } = useOperationalData();
  const p = data.productBatches.find(
    (x) =>
      x.batchId === batchId &&
      data.actorWallet &&
      x.manufacturer.toLowerCase() === data.actorWallet.toLowerCase(),
  );
  const productBatchId = p?.batchId;
  const [traceability, setTraceability] = useState<ProductTraceabilityResponse>();
  const [ingredients, setIngredients] = useState<OrderRecord[]>([]);
  const [storage, setStorage] = useState<OrderRecord[]>([]);
  const [locations, setLocations] = useState<OrderRecord[]>([]);
  const [listingError, setListingError] = useState('');
  const [listingLoading, setListingLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setListingLoading(true);
    setListingError('');
    void getOrders()
      .then((result) => {
        if (active) {
          setIngredients(result.catalogue);
          setLocations(result.locations ?? []);
          setStorage(
            result.catalogue.find((entry) => entry.batches?.includes(batchId))?.storageLocations ??
              [],
          );
        }
      })
      .catch(() => {
        if (active) setListingError('Product listing unavailable. Refresh to retry.');
      })
      .finally(() => {
        if (active) setListingLoading(false);
      });
    return () => {
      active = false;
    };
  }, [batchId]);

  useEffect(() => {
    let active = true;
    setTraceability(undefined);
    if (!productBatchId) return () => undefined;
    void Promise.resolve()
      .then(() => resolveProductTraceability(createProductQrPayload(productBatchId)))
      .then((result) => {
        if (active) setTraceability(result);
      })
      .catch(() => {
        // The contract record remains usable when optional readable metadata is unavailable.
      });
    return () => {
      active = false;
    };
  }, [productBatchId]);

  if (error) return <Alert type="error" message={error} />;
  if (loading) return <LoadingIndicator page layout="detail" label="Reading ProductRegistry…" />;
  if (!p)
    return (
      <EmptyState
        icon={<span />}
        title="Product not found"
        sub="This product is not available to the authenticated wallet."
      />
    );
  const productName = traceability?.product.name ?? 'Registered product';
  const batchReference = traceability?.product.reference ?? 'Batch reference unavailable';
  const catalogueItem = ingredients.find((entry) => entry.batches?.includes(p.batchId));
  const catalogueBatch = catalogueItem?.batchDetails?.find(
    (entry: OrderRecord) => String(entry.batchId).toLowerCase() === p.batchId.toLowerCase(),
  );
  const productionLocationId =
    catalogueItem?.productionLocation ?? catalogueBatch?.productionLocation;
  const productionLocation =
    catalogueItem?.productionLocationName ??
    locations.find(
      (location) =>
        String(location.location).toLowerCase() ===
        String(productionLocationId ?? '').toLowerCase(),
    )?.label ??
    (productionLocationId ? shortChainId(String(productionLocationId)) : 'Not recorded');
  const unit = operationalUnit(p.unit);
  const authoritativeStorage = storage.filter((entry) => entry.available !== undefined);
  return (
    <div className="workspace-flow-page">
      <BackNavigation onClick={onBack}>Back</BackNavigation>
      {listingError && <Alert type="warning" message={listingError} />}
      <div className="workspace-record-heading">
        <div className="workspace-record-heading__identity">
          <span className="workspace-record-heading__eyebrow">Finished product</span>
          <h2>{productName}</h2>
          <p>{batchReference}</p>
        </div>
        <Badge
          label={recordStatuses[p.status] ?? 'Unknown'}
          variant={p.status === 1 ? 'active' : 'pending'}
        />
        <Btn onClick={onTransfer}>Transfer Product</Btn>
      </div>
      <Card>
        <h3>Product batch summary</h3>
        <div className="ingredient-detail__hero mb-[16px]">
          <CatalogueImage
            path={catalogueItem?.imagePath}
            category={catalogueItem?.category ?? 'Product'}
            alt={`${productName} product image`}
            large
          />
          <div className="ingredient-detail__summary">
            <div>
              <span className="workspace-record-heading__eyebrow">Product presentation</span>
              <h3>{productName}</h3>
              {hasPresentationValue(catalogueItem?.description) && (
                <p>{catalogueItem?.description}</p>
              )}
            </div>
          </div>
        </div>
        <div className="workspace-company-cell mb-[16px]">
          <CompanyAvatar
            name={p.manufacturerName ?? 'Verified Manufacturer'}
            logoPath={catalogueItem?.sellerLogoPath}
            size="lg"
          />
          <strong>{p.manufacturerName ?? 'Verified Manufacturer'}</strong>
        </div>
        <div className="workspace-record-facts">
          {[
            ['Batch reference', batchReference],
            ['Status', recordStatuses[p.status] ?? 'Unknown'],
            ['Category', catalogueItem?.category || 'Not provided'],
            ['Quantity produced', formatOperationalQuantity(p.totalQuantity, p.unit)],
            ['Production location', productionLocation],
            ['Produced', chainDate(p.producedAt)],
            ['Expires', chainDate(p.expiresAt)],
            [
              'Indicative unit price',
              listingLoading && !hasPresentationValue(catalogueItem?.price)
                ? 'Loading...'
                : formatOperationalPrice(catalogueItem?.currency, catalogueItem?.price, p.unit),
            ],
          ]
            .filter(
              ([label]) =>
                label !== 'Indicative unit price' ||
                listingLoading ||
                listingError ||
                hasPresentationValue(catalogueItem?.price),
            )
            .map(([l, v]) => (
              <div key={l}>
                <dt>{l}</dt>
                <dd>{v}</dd>
              </div>
            ))}
        </div>
        {authoritativeStorage.length > 0 && (
          <section className="workspace-authoritative-stock" aria-label="Authoritative stock">
            <h4>Available custody stock</h4>
            {authoritativeStorage.map((entry) => (
              <p key={`${entry.location ?? ''}:${entry.distributor ?? ''}`}>
                {entry.warehouseName ?? 'Recorded Distributor location'}:{' '}
                <strong>{formatOperationalQuantity(entry.available, p.unit)}</strong>
              </p>
            ))}
          </section>
        )}
        <TechnicalDetails
          fields={[
            { label: 'Product batch ID', value: p.batchId },
            { label: 'Manufacturer wallet', value: p.manufacturer },
            { label: 'Metadata hash', value: p.metadataHash },
            { label: 'Public CID', value: p.publicCid },
            {
              label: 'Raw on-chain unit',
              value: unit.raw || 'Not recorded',
            },
          ]}
        />
      </Card>
      <Card>
        <ProductQrDisplay
          batchId={p.batchId}
          batchReference={batchReference}
          productName={productName}
        />
      </Card>
      <Card>
        <b>Linked ingredients</b>
        <Table headers={['Ingredient', 'Supplier', 'Quantity', '']}>
          {p.ingredients.map((i) => (
            <TR key={i.batchId}>
              <TD>
                {ingredients.find((item) => item.batches?.includes(i.batchId))?.name ??
                  shortChainId(i.batchId)}
              </TD>
              <TD>
                <span className="workspace-company-cell">
                  <CompanyAvatar
                    name={
                      ingredients.find((item) => item.batches?.includes(i.batchId))?.sellerName ??
                      'Unavailable'
                    }
                    logoPath={
                      ingredients.find((item) => item.batches?.includes(i.batchId))?.sellerLogoPath
                    }
                    size="sm"
                  />
                  {ingredients.find((item) => item.batches?.includes(i.batchId))?.sellerName ??
                    'Unavailable'}
                </span>
              </TD>
              <TD>
                {formatOperationalQuantity(
                  i.quantity,
                  ingredients.find((item) => item.batches?.includes(i.batchId))?.unit,
                )}
              </TD>
              <TD>
                <Btn size="sm" variant="outline" onClick={() => onIngredientDetail(i.batchId)}>
                  View ingredient & request
                </Btn>
              </TD>
            </TR>
          ))}
        </Table>
      </Card>
    </div>
  );
}
