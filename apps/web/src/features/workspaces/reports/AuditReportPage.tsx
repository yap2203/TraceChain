import { LoadingIndicator } from '../../../components/ui/LoadingIndicator';
import { FileSearch, RefreshCw, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { type OperationalData } from '../../blockchain/blockchain.api';
import { useOperationalData } from '../../blockchain/useOperationalData';
import {
  Alert,
  Badge,
  Btn,
  Card,
  EmptyState,
  HashChip,
  Input,
  SectionTitle,
  SelectField,
  StatusTabs,
  T,
  Table,
  TD,
  TR,
  TechnicalDetails,
  WorkflowHelp,
} from '../shared/ui';

interface AuditRow {
  category: string;
  id: string;
  party: string;
  quantity: string;
  reference: string;
  status: string;
}

export default function AuditReport() {
  const { data, error, loading, reload } = useOperationalData();
  const rows = useMemo(() => auditRows(data), [data]);
  const [category, setCategory] = useState<'All' | AuditRow['category']>('All');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const filteredRows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return rows.filter(
      (row) =>
        (category === 'All' || row.category === category) &&
        (status === 'all' || row.status === status) &&
        (!query ||
          [row.category, row.party, row.status, row.quantity]
            .join(' ')
            .toLocaleLowerCase()
            .includes(query)),
    );
  }, [category, rows, search, status]);
  const generatedAt = useMemo(() => new Date(), [data]);
  const exportCsv = () =>
    download(
      'tracechain-on-chain-audit.csv',
      [
        ['Category', 'Record ID', 'Party', 'Status', 'Quantity', 'Integrity reference'],
        ...rows.map((row) => [
          row.category,
          row.id,
          row.party,
          row.status,
          row.quantity,
          row.reference,
        ]),
      ]
        .map((row) => row.map(csvValue).join(','))
        .join('\n'),
      'text/csv',
    );

  if (loading) return <LoadingIndicator page label="Loading records…" />;
  return (
    <div>
      <SectionTitle
        title="On-chain Audit Report"
        sub={
          loading
            ? 'Reading records from the configured TraceChain contracts...'
            : `Current authorized-wallet snapshot generated ${generatedAt.toLocaleString()}`
        }
        action={
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Btn
              size="sm"
              variant="outline"
              disabled={loading || rows.length === 0}
              onClick={exportCsv}
            >
              Export CSV
            </Btn>
            <Btn
              size="sm"
              variant="outline"
              disabled={loading || rows.length === 0}
              onClick={() => window.print()}
            >
              Print
            </Btn>
            <Btn size="sm" variant="outline" disabled={loading} onClick={() => void reload()}>
              <RefreshCw size={14} /> Refresh chain data
            </Btn>
          </div>
        }
      />
      <div className="workspace-report-note">
        <p>
          Current records for your wallet. This snapshot is not a complete historical event index.
        </p>
        <WorkflowHelp title="About this report’s data">
          Contract state and hashes are authoritative. Readable company names come from existing
          issuance metadata. The report covers records available to your authenticated wallet.
        </WorkflowHelp>
      </div>
      {error && (
        <div style={{ marginBottom: 16 }}>
          <Alert type="error" message={`Blockchain audit data is unavailable: ${error}`} />
        </div>
      )}
      {!loading && !error && rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FileSearch size={44} />}
            title="No on-chain records found"
            sub="Records associated with this authenticated wallet will appear here."
          />
        </Card>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          <Summary data={data} loading={loading} />
          <StatusTabs
            label="Filter audit records by type"
            value={category}
            onChange={setCategory}
            variant="connected"
            tabs={[
              { value: 'All', label: 'All records', count: rows.length },
              {
                value: 'Ingredient',
                label: 'Ingredients',
                count: rows.filter((row) => row.category === 'Ingredient').length,
              },
              {
                value: 'Product',
                label: 'Products',
                count: rows.filter((row) => row.category === 'Product').length,
              },
              {
                value: 'Transfer',
                label: 'Transfers',
                count: rows.filter((row) => row.category === 'Transfer').length,
              },
              {
                value: 'Evidence',
                label: 'Evidence',
                count: rows.filter((row) => row.category === 'Evidence').length,
              },
            ]}
          />
          <div className="audit-filter-toolbar">
            <Input
              label="Search audit records"
              type="search"
              icon={<Search size={16} />}
              value={search}
              onChange={setSearch}
              placeholder="Record type, company, status or quantity"
            />
            <SelectField
              label="Status"
              value={status}
              onChange={setStatus}
              options={[
                { value: 'all', label: 'All statuses' },
                ...Array.from(new Set(rows.map((row) => row.status))).map((value) => ({
                  value,
                  label: value,
                })),
              ]}
            />
          </div>
          {!filteredRows.length ? (
            <EmptyState
              icon={<Search size={36} />}
              title="No audit records match these filters"
              sub="Change the record type, status or search text."
              action={
                <Btn
                  onClick={() => {
                    setCategory('All');
                    setSearch('');
                    setStatus('all');
                  }}
                >
                  Clear filters
                </Btn>
              }
            />
          ) : (
            <div className="audit-record-list">
              {filteredRows.map((row) => (
                <article className="audit-record-card" key={`${row.category}-${row.id}`}>
                  <div className="audit-record-card__heading">
                    <div>
                      <span>{row.category}</span>
                      <h3>{row.party}</h3>
                    </div>
                    <Status value={row.status} />
                  </div>
                  <dl>
                    <div>
                      <dt>Quantity</dt>
                      <dd>{row.quantity || 'Not applicable'}</dd>
                    </div>
                    <div>
                      <dt>Current state</dt>
                      <dd>{row.status}</dd>
                    </div>
                  </dl>
                  <TechnicalDetails
                    fields={[
                      { label: 'Record ID', value: row.id },
                      { label: 'Integrity reference', value: row.reference },
                    ]}
                  />
                </article>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Summary({ data, loading }: { data: OperationalData; loading: boolean }) {
  const values = [
    ['Ingredient batches', data.ingredientBatches.length],
    ['Product batches', data.productBatches.length],
    ['Custody transfers', data.transfers.length],
    ['Evidence requests', data.evidenceRequests.length],
  ] as const;
  return (
    <Card>
      <Heading number={1} title="Registry snapshot" />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))',
          gap: 12,
        }}
      >
        {values.map(([label, value]) => (
          <div
            key={label}
            style={{ background: T.surface2, borderRadius: 8, padding: '12px 14px' }}
          >
            <div style={{ color: T.text2, fontSize: 11 }}>{label}</div>
            <div style={{ color: T.navy, fontSize: 22, fontWeight: 700, marginTop: 3 }}>
              {loading ? '...' : value}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Products({ data }: { data: OperationalData }) {
  return (
    <ReportTable
      number={2}
      title="Product registry records"
      headers={['Batch ID', 'Manufacturer', 'Produced', 'Quantity', 'Status', 'Metadata hash']}
      empty={data.productBatches.length === 0}
    >
      {data.productBatches.map((item) => (
        <TR key={item.batchId}>
          <TD mono>{short(item.batchId)}</TD>
          <TD>{item.manufacturerName || short(item.manufacturer)}</TD>
          <TD muted>{date(item.producedAt)}</TD>
          <TD>
            {item.totalQuantity} {unit(item.unit)}
          </TD>
          <TD>
            <Status value={productStatus(item.status, item.expiresAt)} />
          </TD>
          <TD>
            <HashChip value={item.metadataHash} />
          </TD>
        </TR>
      ))}
    </ReportTable>
  );
}

function Ingredients({ data }: { data: OperationalData }) {
  return (
    <ReportTable
      number={3}
      title="Ingredient registry records"
      headers={[
        'Batch ID',
        'Supplier',
        'Available / total',
        'Credential ID',
        'Status',
        'Metadata hash',
      ]}
      empty={data.ingredientBatches.length === 0}
    >
      {data.ingredientBatches.map((item) => (
        <TR key={item.batchId}>
          <TD mono>{short(item.batchId)}</TD>
          <TD>{item.supplierName || short(item.supplier)}</TD>
          <TD>
            {item.availableQuantity} / {item.totalQuantity} {unit(item.unit)}
          </TD>
          <TD mono muted>
            {short(item.credentialId)}
          </TD>
          <TD>
            <Status value={ingredientStatus(item.status, item.expiresAt)} />
          </TD>
          <TD>
            <HashChip value={item.metadataHash} />
          </TD>
        </TR>
      ))}
    </ReportTable>
  );
}

function Transfers({ data }: { data: OperationalData }) {
  return (
    <ReportTable
      number={4}
      title="Custody transfer records"
      headers={[
        'Transfer ID',
        'Product batch',
        'From',
        'To',
        'Quantity',
        'Status',
        'Shipment hash',
      ]}
      empty={data.transfers.length === 0}
    >
      {data.transfers.map((item) => (
        <TR key={item.transferId}>
          <TD mono>{short(item.transferId)}</TD>
          <TD mono muted>
            {short(item.productBatchId)}
          </TD>
          <TD>{item.senderName || short(item.sender)}</TD>
          <TD>{item.recipientName || short(item.recipient)}</TD>
          <TD>{item.quantity}</TD>
          <TD>
            <Status value={transferStatus(item.status)} />
          </TD>
          <TD>
            <HashChip value={item.shipmentHash} />
          </TD>
        </TR>
      ))}
    </ReportTable>
  );
}

function Evidence({ data }: { data: OperationalData }) {
  return (
    <ReportTable
      number={5}
      title="Evidence request records"
      headers={[
        'Request ID',
        'Ingredient batch',
        'Requester',
        'Supplier',
        'Updated',
        'Status',
        'Reference',
      ]}
      empty={data.evidenceRequests.length === 0}
    >
      {data.evidenceRequests.map((item) => (
        <TR key={item.requestId}>
          <TD mono>{short(item.requestId)}</TD>
          <TD mono muted>
            {short(item.ingredientBatchId)}
          </TD>
          <TD>{item.manufacturerName || short(item.requester)}</TD>
          <TD>{item.supplierName || short(item.supplier)}</TD>
          <TD muted>{dateTime(item.updatedAt)}</TD>
          <TD>
            <Status value={evidenceStatus(item.status)} />
          </TD>
          <TD>
            <HashChip
              value={zero(item.presentationHash) ? item.claimsHash : item.presentationHash}
            />
          </TD>
        </TR>
      ))}
    </ReportTable>
  );
}

function References({ rows }: { rows: AuditRow[] }) {
  return (
    <ReportTable
      number={6}
      title="On-chain integrity references"
      headers={['Record type', 'Record ID', 'Current state', 'Integrity reference']}
      empty={rows.length === 0}
    >
      {rows.map((row) => (
        <TR key={`${row.category}-${row.id}`}>
          <TD bold>{row.category}</TD>
          <TD mono muted>
            {short(row.id)}
          </TD>
          <TD>
            <Status value={row.status} />
          </TD>
          <TD>
            <HashChip value={row.reference} />
          </TD>
        </TR>
      ))}
    </ReportTable>
  );
}

function ReportTable({
  number,
  title,
  headers,
  empty,
  children,
}: {
  number: number;
  title: string;
  headers: string[];
  empty: boolean;
  children: ReactNode;
}) {
  return (
    <Card padding="0">
      <div style={{ padding: '16px 18px 4px' }}>
        <Heading number={number} title={title} />
      </div>
      <Table headers={headers}>{children}</Table>
      {empty && (
        <div style={{ padding: '14px 18px', color: T.text3, fontSize: 12 }}>
          No associated on-chain records.
        </div>
      )}
    </Card>
  );
}

function Heading({ number, title }: { number: number; title: string }) {
  return (
    <div style={{ fontWeight: 700, fontSize: 15, color: T.navy, marginBottom: 14 }}>
      {number}. {title}
    </div>
  );
}
function Status({ value }: { value: string }) {
  const state = value.toLowerCase();
  const variant = ['active', 'received', 'accepted'].includes(state)
    ? 'verified'
    : ['awaiting receipt', 'requested', 'responded'].includes(state)
      ? 'pending'
      : ['suspended', 'discrepancy reported'].includes(state)
        ? 'suspended'
        : 'rejected';
  return <Badge label={value} variant={variant} />;
}

function auditRows(data: OperationalData): AuditRow[] {
  return [
    ...data.ingredientBatches.map((r) => ({
      category: 'Ingredient',
      id: r.batchId,
      party: r.supplierName || r.supplier,
      status: ingredientStatus(r.status, r.expiresAt),
      quantity: `${r.availableQuantity}/${r.totalQuantity} ${unit(r.unit)}`,
      reference: r.metadataHash,
    })),
    ...data.productBatches.map((r) => ({
      category: 'Product',
      id: r.batchId,
      party: r.manufacturerName || r.manufacturer,
      status: productStatus(r.status, r.expiresAt),
      quantity: `${r.totalQuantity} ${unit(r.unit)}`,
      reference: r.metadataHash,
    })),
    ...data.transfers.map((r) => ({
      category: 'Transfer',
      id: r.transferId,
      party: `${r.senderName || r.sender} -> ${r.recipientName || r.recipient}`,
      status: transferStatus(r.status),
      quantity: r.quantity,
      reference: r.shipmentHash,
    })),
    ...data.evidenceRequests.map((r) => ({
      category: 'Evidence',
      id: r.requestId,
      party: r.supplierName || r.supplier,
      status: evidenceStatus(r.status),
      quantity: '',
      reference: zero(r.presentationHash) ? r.claimsHash : r.presentationHash,
    })),
  ];
}
function productStatus(status: number, expiry: number) {
  return status === 1 && expiry * 1_000 <= Date.now()
    ? 'Expired'
    : (({ 1: 'Active', 2: 'Suspended', 3: 'Recalled' } as Record<number, string>)[status] ??
        'Unknown');
}
function ingredientStatus(status: number, expiry: number) {
  return status === 1 && expiry * 1_000 <= Date.now()
    ? 'Expired'
    : (({ 1: 'Active', 2: 'Consumed', 3: 'Expired', 4: 'Recalled' } as Record<number, string>)[
        status
      ] ?? 'Unknown');
}
function transferStatus(status: number) {
  return (
    (
      {
        1: 'Awaiting receipt',
        2: 'Received',
        3: 'Rejected',
        4: 'Cancelled',
        5: 'Discrepancy reported',
      } as Record<number, string>
    )[status] ?? 'Unknown'
  );
}
function evidenceStatus(status: number) {
  return (
    (
      { 1: 'Requested', 2: 'Responded', 3: 'Accepted', 4: 'Rejected', 5: 'Expired' } as Record<
        number,
        string
      >
    )[status] ?? 'Unknown'
  );
}
function date(value: number) {
  return value ? new Date(value * 1_000).toLocaleDateString() : 'Unavailable';
}
function dateTime(value: number) {
  return value ? new Date(value * 1_000).toLocaleString() : 'Unavailable';
}
function short(value: string) {
  return value.length > 23 ? `${value.slice(0, 10)}...${value.slice(-7)}` : value;
}
function zero(value: string) {
  return !value || /^0x0{64}$/i.test(value);
}
function unit(value: string) {
  if (!/^0x[0-9a-f]{64}$/i.test(value)) return value || 'units';
  return (
    value
      .slice(2)
      .match(/.{2}/g)
      ?.map((pair) => Number.parseInt(pair, 16))
      .filter(Boolean)
      .map((code) => String.fromCharCode(code))
      .join('') || 'units'
  );
}
function csvValue(value: unknown) {
  return `"${String(value).replaceAll('"', '""')}"`;
}
function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
