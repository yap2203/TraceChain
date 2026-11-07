import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';

import { useOperationalData } from '../../../blockchain/useOperationalData';
import {
  createProductQrPayload,
  resolveProductTraceability,
  type ProductTraceabilityResponse,
} from '../../../product-traceability';
import { Alert, Badge, Btn, Card, EmptyState, T, Table, TD, TR } from '../../shared/ui';

interface HistoryRecord {
  batchId: string;
  trace: ProductTraceabilityResponse;
}

export function ProductHistory({ onView }: { onView: (batch: string) => void }) {
  const { data, error: operationalError, loading: operationalLoading } = useOperationalData();
  const [records, setRecords] = useState<HistoryRecord[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let active = true;
    const batchIds = [...new Set(data.productBatches.map((product) => product.batchId))];
    if (operationalLoading) return;
    if (!batchIds.length) {
      setRecords([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    void Promise.all(
      batchIds.map(async (batchId) => ({
        batchId,
        trace: await resolveProductTraceability(createProductQrPayload(batchId)),
      })),
    )
      .then((resolved) => {
        if (active) setRecords(resolved);
      })
      .catch((cause) => {
        if (active)
          setError(cause instanceof Error ? cause.message : 'Product history could not be loaded.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [data.productBatches, operationalLoading]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return records.filter(
      ({ trace }) =>
        !query ||
        trace.product.name.toLowerCase().includes(query) ||
        trace.product.reference.toLowerCase().includes(query) ||
        trace.product.manufacturerName.toLowerCase().includes(query),
    );
  }, [records, search]);

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 14 }}>
        <div>
          <h1 style={{ fontSize: 20, color: T.navy, margin: '0 0 4px' }}>Product History</h1>
          <p style={{ fontSize: 13, color: T.text2, margin: 0 }}>
            Blockchain traceability records for products linked to this Retailer.
          </p>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Search size={15} />
          <input
            aria-label="Search product history"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search product, reference, company…"
            style={{ padding: 9, minWidth: 260 }}
          />
        </label>
      </div>
      {(error || operationalError) && <Alert type="error" message={error || operationalError} />}
      {loading ? (
        <Card>Resolving blockchain custody history…</Card>
      ) : !filtered.length ? (
        <EmptyState
          icon={<Search size={22} />}
          title="No traceable products found"
          sub="Received product records will appear after their on-chain transfer is available."
        />
      ) : (
        <Card padding="0">
          <Table
            headers={['Product', 'Manufacturer', 'Current custody', 'Ingredients', 'Status', '']}
          >
            {filtered.map(({ batchId, trace }) => (
              <TR key={batchId} onClick={() => onView(batchId)}>
                <TD>
                  <b>{trace.product.name}</b>
                  <div style={{ color: T.text2, fontSize: 11 }}>{trace.product.reference}</div>
                </TD>
                <TD muted>{trace.product.manufacturerName}</TD>
                <TD muted>{trace.currentCustodianName}</TD>
                <TD>
                  {trace.credentialSummary.active}/{trace.credentialSummary.total} active
                </TD>
                <TD>
                  <Badge
                    label={trace.product.status}
                    variant={trace.product.status === 'ACTIVE' ? 'active' : 'pending'}
                  />
                </TD>
                <TD>
                  <Btn size="xs" variant="outline" onClick={() => onView(batchId)}>
                    View history
                  </Btn>
                </TD>
              </TR>
            ))}
          </Table>
        </Card>
      )}
    </div>
  );
}
