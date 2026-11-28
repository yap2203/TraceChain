import { reportError } from '../../../../components/ui/feedback';
import { LoadingIndicator } from '../../../../components/ui/LoadingIndicator';
import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, PackageCheck, Search } from 'lucide-react';

import { useOperationalData } from '../../../blockchain/useOperationalData';
import {
  createProductQrPayload,
  resolveProductTraceability,
  type ProductTraceabilityResponse,
} from '../../../product-traceability';
import { CatalogueImage, CompanyAvatar } from '../../../orders/CatalogueMedia';
import { getOrders, type OrderRecord } from '../../../orders/orders.api';
import {
  Alert,
  Badge,
  Btn,
  EmptyState,
  Input,
  SectionTitle,
  SelectField,
  TechnicalDetails,
} from '../../shared/ui';
import { formatOperationalQuantity } from '../../shared/operational-format';

interface HistoryRecord {
  batchId: string;
  trace: ProductTraceabilityResponse;
}

export function ProductHistory({ onView }: { onView: (batch: string) => void }) {
  const { data, error: operationalError, loading: operationalLoading } = useOperationalData();
  const [records, setRecords] = useState<HistoryRecord[]>([]);
  const [catalogue, setCatalogue] = useState<OrderRecord[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'newest' | 'name' | 'manufacturer'>('newest');

  // A new array instance with unchanged records must not restart the history load.
  const transferRevision = JSON.stringify(data.transfers);
  useEffect(() => {
    let active = true;
    const batchIds = [
      ...new Set(
        data.transfers
          .filter(
            (transfer) =>
              Number(transfer.status) === 2 &&
              transfer.recipient.toLowerCase() === data.actorWallet?.toLowerCase(),
          )
          .map((transfer) => transfer.productBatchId),
      ),
    ];
    if (operationalLoading) return;
    if (!batchIds.length) {
      setRecords([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    void Promise.all([
      getOrders('catalogue'),
      Promise.all(
        batchIds.map(async (batchId) => ({
          batchId,
          trace: await resolveProductTraceability(createProductQrPayload(batchId)),
        })),
      ),
    ])
      .then(([orders, resolved]) => {
        if (active) {
          setCatalogue(orders.catalogue);
          setRecords(resolved);
        }
      })
      .catch((cause) => {
        if (active) setError(reportError(cause, 'Product history could not be loaded.'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [data.actorWallet, transferRevision, operationalLoading]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return records
      .filter(
        ({ trace }) =>
          !query ||
          trace.product.name.toLowerCase().includes(query) ||
          trace.product.reference.toLowerCase().includes(query) ||
          trace.product.manufacturerName.toLowerCase().includes(query),
      )
      .sort((left, right) => {
        if (sort === 'name') return left.trace.product.name.localeCompare(right.trace.product.name);
        if (sort === 'manufacturer')
          return left.trace.product.manufacturerName.localeCompare(
            right.trace.product.manufacturerName,
          );
        return receiptTime(right.trace) - receiptTime(left.trace);
      });
  }, [records, search, sort]);

  return (
    <div className="received-product-page">
      <SectionTitle
        title="Received products"
        sub="Products physically received by this Retailer with recorded blockchain traceability."
      />
      <div className="received-product-toolbar">
        <Input
          label="Search received products"
          type="search"
          icon={<Search size={16} />}
          value={search}
          onChange={setSearch}
          placeholder="Product, batch reference or company"
        />
        <SelectField
          label="Sort"
          value={sort}
          onChange={(value) => setSort(value as typeof sort)}
          options={[
            { value: 'newest', label: 'Newest receipt' },
            { value: 'name', label: 'Product name' },
            { value: 'manufacturer', label: 'Manufacturer' },
          ]}
        />
      </div>
      {(error || operationalError) && <Alert type="error" message={error || operationalError} />}
      {loading ? (
        <LoadingIndicator page layout="detail" label="Resolving blockchain custody history" />
      ) : !filtered.length ? (
        <EmptyState
          icon={<Search size={22} />}
          title={
            records.length
              ? 'No received products match this search'
              : 'No traceable products found'
          }
          sub="Received product records appear after their on-chain transfer is available."
          action={
            records.length ? <Btn onClick={() => setSearch('')}>Clear search</Btn> : undefined
          }
        />
      ) : (
        <div className="received-product-list">
          {filtered.map(({ batchId, trace }) => {
            const transfer = data.transfers.find(
              (entry) => entry.productBatchId === batchId && Number(entry.status) === 2,
            );
            const distributor =
              transfer?.distributorName ?? transfer?.senderName ?? 'Distributor name unavailable';
            const retailer = transfer?.recipientName ?? trace.currentCustodianName;
            const item = catalogue.find((entry) =>
              entry.batches?.some((id: string) => id.toLowerCase() === batchId.toLowerCase()),
            );
            return (
              <article className="received-product-card" key={batchId}>
                <div className="received-product-card__image">
                  <CatalogueImage
                    path={item?.imagePath}
                    alt={`${trace.product.name} image`}
                    category={trace.product.category}
                  />
                </div>
                <div className="received-product-card__body">
                  <div className="received-product-card__heading">
                    <div>
                      <h3>{trace.product.name}</h3>
                      <p>{trace.product.reference}</p>
                    </div>
                    <Badge
                      label={trace.product.status}
                      variant={trace.product.status === 'ACTIVE' ? 'active' : 'pending'}
                    />
                  </div>
                  <div className="received-product-card__route" aria-label="Product custody route">
                    <RouteCompany
                      role="Manufacturer"
                      name={trace.product.manufacturerName}
                      logoPath={item?.sellerLogoPath}
                    />
                    <ArrowRight aria-hidden="true" size={17} />
                    <RouteCompany role="Distributor" name={distributor} />
                    <ArrowRight aria-hidden="true" size={17} />
                    <RouteCompany role="Retailer" name={retailer} />
                  </div>
                  <dl className="received-product-card__facts">
                    <div>
                      <dt>Quantity received</dt>
                      <dd>
                        {transfer
                          ? formatOperationalQuantity(transfer.quantity, trace.product.unit)
                          : 'Unavailable'}
                      </dd>
                    </div>
                    <div>
                      <dt>Manufacturer</dt>
                      <dd className="workspace-company-cell">
                        <CompanyAvatar name={trace.product.manufacturerName} size="sm" />
                        {trace.product.manufacturerName}
                      </dd>
                    </div>
                    <div>
                      <dt>Distributor</dt>
                      <dd className="workspace-company-cell">
                        <CompanyAvatar name={distributor} size="sm" />
                        {distributor}
                      </dd>
                    </div>
                    <div>
                      <dt>Receiving location</dt>
                      <dd>{trace.currentCustodianName}</dd>
                    </div>
                    <div>
                      <dt>Receipt date</dt>
                      <dd>
                        {receiptTime(trace)
                          ? new Date(receiptTime(trace) * 1_000).toLocaleString()
                          : 'Not recorded'}
                      </dd>
                    </div>
                    <div>
                      <dt>Receipt status</dt>
                      <dd>
                        <Badge label="Received" variant="verified" />
                      </dd>
                    </div>
                  </dl>
                  <div className="received-product-card__actions">
                    <span>
                      <PackageCheck size={16} /> {trace.credentialSummary.active}/
                      {trace.credentialSummary.total} active ingredient credentials
                    </span>
                    <Btn variant="outline" onClick={() => onView(batchId)}>
                      View traceability
                    </Btn>
                  </div>
                  <TechnicalDetails
                    fields={[
                      { label: 'Product batch ID', value: batchId },
                      {
                        label: 'Current custodian wallet',
                        value: trace.technical?.currentCustodianWallet ?? 'Unavailable',
                      },
                      {
                        label: 'Product registry',
                        value: trace.technical?.productRegistryAddress ?? 'Unavailable',
                      },
                    ]}
                  />
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RouteCompany({ role, name, logoPath }: { role: string; name: string; logoPath?: string }) {
  return (
    <span className="received-product-card__company">
      <CompanyAvatar name={name} logoPath={logoPath} size="sm" />
      <span>
        <small>{role}</small>
        <strong>{name}</strong>
      </span>
    </span>
  );
}

function receiptTime(trace: ProductTraceabilityResponse) {
  return Math.max(
    0,
    ...trace.timeline
      .filter((entry) => /received|receipt/i.test(`${entry.type} ${entry.action} ${entry.status}`))
      .map((entry) => Number(entry.timestamp) || 0),
  );
}
