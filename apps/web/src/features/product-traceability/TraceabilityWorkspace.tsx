import { LoadingIndicator } from '../../components/ui/LoadingIndicator';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FileSearch, RefreshCw, Route } from 'lucide-react';
import {
  CURRENT_INGREDIENT_REQUEST_CLAIMS,
  INGREDIENT_EVIDENCE_CLAIMS,
  type IngredientRequestPolicy,
} from '@tracechain/shared';
import {
  getBusinessTraceability,
  type BusinessTraceability,
  type OrderRecord,
} from '../orders/orders.api';
import {
  Alert,
  Badge,
  Btn,
  Card,
  EmptyState,
  SectionTitle,
  SelectField,
  TechnicalDetails,
} from '../workspaces/shared/ui';
import type { WorkspaceRole } from '../workspaces/workspace-navigation';
import { recordStatuses, shortChainId } from '../workspaces/shared/operational-format';
import { CatalogueImage, CompanyAvatar } from '../orders/CatalogueMedia';
import { EvidenceRequestModal } from '../orders/EvidenceRequestModal';
import { IngredientRequestPolicyFields } from '../production-flow/IngredientRequestPolicyFields';
import {
  classifyEvidenceClaims,
  evidenceClaimLists,
  type ClaimClassification,
} from '../production-flow/EvidenceClaimSelector';
import { prepareEvidenceRequest } from '../production-flow/production-flow.api';
import { completePreparedWorkflow } from '../production-flow/production-flow.transaction';
import { reportError } from '../../components/ui/feedback';

const fields: Record<string, string> = {
  name: 'Ingredient',
  reference: 'Reference',
  supplier: 'Supplier',
  company: 'Company',
  product: 'Product',
  sender: 'From',
  recipient: 'To',
  distributor: 'Distributor',
  quantity: 'Quantity',
  quantityUsed: 'Used in this product',
  unit: 'Unit',
  status: 'Status',
  producedAt: 'Reported production date',
  expiresAt: 'Expiry date',
  recordedAt: 'Blockchain recording time',
  dispatchedAt: 'Reported dispatch time',
  receivedAt: 'Reported receipt time',
  registryStatus: 'Current registry status',
};
function valueFor(key: string, value: unknown) {
  if (key.endsWith('At'))
    return Number(value) > 0 ? new Date(Number(value) * 1000).toLocaleString() : 'Unavailable';
  if (key === 'registryStatus') return recordStatuses[Number(value)] ?? 'Unavailable';
  return String(value);
}
export function TraceabilityWorkspace({ role }: { role: WorkspaceRole }) {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<BusinessTraceability>();
  const [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0);
  const backward = role === 'retailer';
  const [activeStage, setActiveStage] = useState(role === 'retailer' ? 'retail' : 'source');
  const [routeId, setRouteId] = useState('');
  const [evidenceTarget, setEvidenceTarget] = useState<OrderRecord>();
  const [evidencePurpose, setEvidencePurpose] = useState('Ingredient traceability verification');
  const [evidenceDeadline, setEvidenceDeadline] = useState('');
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const [policy, setPolicy] = useState<IngredientRequestPolicy>({
    policyVersion: 2,
    template: 'custom',
  });
  const claimIds = CURRENT_INGREDIENT_REQUEST_CLAIMS.map(([id]) => id);
  const [evidenceFields, setEvidenceFields] = useState<Record<string, ClaimClassification>>(() =>
    classifyEvidenceClaims(claimIds, ['countryOfOrigin', 'expiryDate'], ['productionDate']),
  );
  const kind = params.get('kind') ?? undefined,
    batchId = params.get('batchId') ?? undefined;
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void getBusinessTraceability(kind, batchId)
      .then((result) => {
        if (active) {
          setData(result);
          setRouteId('');
        }
      })
      .catch((cause) => {
        if (active) {
          setData(undefined);
          setError(cause.message);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [kind, batchId, revision]);
  const route = data?.routes.find((entry) => entry.id === routeId) ?? data?.routes[0];
  const stages = route ? (backward ? [...route.stages].reverse() : route.stages) : [];
  const stage = stages.find((entry) => entry.id === activeStage) ?? stages[0];
  const recordedFacts = stages.flatMap((entry) => entry.records);
  const latestFact = recordedFacts[recordedFacts.length - 1];
  const evidenceClaims = evidenceClaimLists(evidenceFields);
  return (
    <div className="workspace-flow-page">
      <SectionTitle
        title={role === 'supplier' ? 'Where my ingredients are used' : 'Supply-chain traceability'}
        sub="Select a batch, then open a stage to inspect its recorded activity."
        action={
          <Btn
            variant="outline"
            icon={<RefreshCw size={16} />}
            disabled={loading}
            onClick={() => setRevision((value) => value + 1)}
          >
            Refresh
          </Btn>
        }
      />
      {error && <Alert type="error" message={error} />}
      {loading ? (
        <LoadingIndicator page label="Loading recorded journeys…" />
      ) : data && !data.roots.length ? (
        <EmptyState
          icon={<Route size={40} />}
          title="No traceability records yet"
          sub="Your registered, ordered or assigned batches will appear here."
        />
      ) : (
        data && (
          <>
            <div className="grid min-w-0">
              <SelectField
                label="Batch to trace"
                value={data.root ? `${data.root.kind}:${data.root.batchId}` : ''}
                onChange={(value) => {
                  const [kind, batchId] = value.split(':');
                  setParams({ kind, batchId });
                }}
                options={data.roots.map((root) => ({
                  value: `${root.kind}:${root.batchId}`,
                  label: `${root.name} · ${root.reference}`,
                }))}
              />
            </div>
            {data.root && (
              <Card>
                <div className="traceability-item-summary">
                  <div className="traceability-item-summary__image">
                    <CatalogueImage
                      path={data.root.imagePath}
                      alt={`${data.root.name} image`}
                      category={data.root.category ?? data.root.kind}
                    />
                  </div>
                  <div className="traceability-item-summary__content">
                    <div className="workspace-record-heading !mb-0">
                      <Route size={24} aria-hidden="true" />
                      <div className="workspace-record-heading__identity">
                        <span className="workspace-record-heading__eyebrow">
                          {data.root.kind === 'product' ? 'Product journey' : 'Ingredient journey'}
                        </span>
                        <h2>{data.root.name}</h2>
                        <p>{data.root.reference}</p>
                      </div>
                      <Badge
                        label={
                          route?.stages.some((entry) => entry.state === 'in-progress')
                            ? 'In progress'
                            : 'Recorded'
                        }
                        variant={
                          route?.stages.some((entry) => entry.state === 'in-progress')
                            ? 'pending'
                            : 'active'
                        }
                      />
                    </div>
                    <dl className="traceability-item-summary__facts">
                      <div>
                        <dt>Current holder</dt>
                        <dd>
                          {latestFact?.recipient ??
                            latestFact?.company ??
                            latestFact?.distributor ??
                            'Not recorded'}
                        </dd>
                      </div>
                      <div>
                        <dt>Current location</dt>
                        <dd>
                          {latestFact?.location ??
                            latestFact?.destination ??
                            latestFact?.productionLocationName ??
                            'Not recorded'}
                        </dd>
                      </div>
                      <div>
                        <dt>Evidence status</dt>
                        <dd>
                          {route?.ingredients.length
                            ? `${route.ingredients.length} linked ingredient record${route.ingredients.length === 1 ? '' : 's'}`
                            : 'No linked evidence stage recorded'}
                        </dd>
                      </div>
                    </dl>
                  </div>
                </div>
              </Card>
            )}
            {data.routes.length > 1 && (
              <SelectField
                label="Product journey"
                value={route?.id ?? ''}
                onChange={setRouteId}
                options={data.routes.map((route) => ({ value: route.id, label: route.name }))}
              />
            )}
            {route && (
              <>
                <nav className="trace-stage-bar" aria-label="Recorded supply-chain stages">
                  {stages.map((entry, index) => (
                    <button
                      key={entry.id}
                      type="button"
                      aria-label={`Step ${index + 1}: ${entry.title}. ${entry.state === 'not-recorded' ? 'Not recorded' : entry.state === 'in-progress' ? 'In progress' : 'Records available'}`}
                      className={stage?.id === entry.id ? 'is-selected' : ''}
                      aria-current={stage?.id === entry.id ? 'step' : undefined}
                      onClick={() => setActiveStage(entry.id)}
                    >
                      <span className="trace-stage-number">{index + 1}</span>
                      <strong>{entry.title}</strong>
                      <span>
                        {entry.state === 'not-recorded'
                          ? 'Not recorded'
                          : entry.state === 'in-progress'
                            ? 'In progress'
                            : 'Records available'}
                      </span>
                    </button>
                  ))}
                </nav>
                <Card>
                  <SectionTitle
                    title={stage?.title ?? 'Stage details'}
                    sub={
                      stage?.state === 'not-recorded'
                        ? 'No activity has been recorded for this stage.'
                        : undefined
                    }
                  />
                  <div className="trace-record-grid">
                    {stage?.records.map((record, index) => (
                      <article className="trace-record" key={index}>
                        {record.registryStatus !== undefined && (
                          <Badge
                            label={
                              Number(record.expiresAt) > 0 &&
                              Number(record.expiresAt) <= Date.now() / 1000
                                ? 'Expired'
                                : (recordStatuses[Number(record.registryStatus)] ?? 'Unavailable')
                            }
                            variant={
                              Number(record.expiresAt) > 0 &&
                              Number(record.expiresAt) <= Date.now() / 1000
                                ? 'expired'
                                : Number(record.registryStatus) === 1
                                  ? 'active'
                                  : 'pending'
                            }
                          />
                        )}
                        <dl>
                          {Object.entries(record)
                            .filter(
                              ([key, value]) =>
                                fields[key] && value !== undefined && key !== 'registryStatus',
                            )
                            .map(([key, value]) => (
                              <div key={key}>
                                <dt>{fields[key]}</dt>
                                <dd>
                                  {[
                                    'supplier',
                                    'company',
                                    'sender',
                                    'recipient',
                                    'distributor',
                                  ].includes(key) ? (
                                    <span className="workspace-company-cell">
                                      <CompanyAvatar
                                        name={String(value)}
                                        logoPath={record[`${key}LogoPath`]}
                                        size="sm"
                                      />
                                      {String(value)}
                                    </span>
                                  ) : key === 'reference' && /^0x/.test(String(value)) ? (
                                    shortChainId(String(value))
                                  ) : (
                                    valueFor(key, value)
                                  )}
                                </dd>
                              </div>
                            ))}
                        </dl>
                        {stage.id === 'source' && ['manufacturer', 'retailer'].includes(role) && (
                          <Btn
                            variant="outline"
                            icon={<FileSearch size={16} />}
                            onClick={() => setEvidenceTarget(record)}
                          >
                            Request ingredient evidence
                          </Btn>
                        )}
                      </article>
                    ))}
                  </div>
                </Card>
                <p className="workspace-list-guidance">
                  These are blockchain records. Signed evidence is requested and verified
                  separately.
                </p>
                <TechnicalDetails
                  fields={[
                    { label: 'Selected batch', value: data.root?.batchId ?? 'Unavailable' },
                    { label: 'Product batch', value: route.productBatchId ?? 'Not produced yet' },
                  ]}
                />
              </>
            )}
          </>
        )
      )}
      {evidenceTarget && (
        <EvidenceRequestModal
          title="Request ingredient evidence"
          evidenceType="Ingredient evidence"
          credentialType="Supplier Ingredient Credential"
          requester="Your company"
          requesterRole={role}
          recipient={String(evidenceTarget.supplier ?? 'Original Supplier')}
          recipientRole="Supplier"
          reference={evidenceTarget.batchId}
          catalogue={INGREDIENT_EVIDENCE_CLAIMS.filter((claim) =>
            claimIds.some((id) => id === claim.id),
          )}
          required={evidenceClaims.required}
          optional={evidenceClaims.optional}
          purpose={evidencePurpose}
          deadline={evidenceDeadline}
          busy={evidenceBusy}
          configuration={
            <IngredientRequestPolicyFields
              policy={policy}
              onChange={setPolicy}
              onRequirements={(required) =>
                setEvidenceFields(classifyEvidenceClaims(claimIds, required, []))
              }
            />
          }
          separationNote="Requesting evidence does not change ownership, stock, or order status."
          onClose={() => setEvidenceTarget(undefined)}
          onChange={(value) => {
            setEvidenceFields(classifyEvidenceClaims(claimIds, value.required, value.optional));
            setEvidencePurpose(value.purpose);
            setEvidenceDeadline(value.deadline);
          }}
          onSubmit={() => {
            setEvidenceBusy(true);
            setError('');
            void completePreparedWorkflow(() =>
              prepareEvidenceRequest({
                batchId: evidenceTarget.batchId,
                claims: [...evidenceClaims.required, ...evidenceClaims.optional],
                requiredClaims: evidenceClaims.required,
                policy,
                dueAt: new Date(evidenceDeadline).toISOString(),
                operationId: crypto.randomUUID(),
                productBatchId: route?.productBatchId ?? undefined,
                reason: evidencePurpose.trim(),
              }),
            )
              .then(() => setEvidenceTarget(undefined))
              .catch((cause) => setError(reportError(cause, 'The evidence request failed.')))
              .finally(() => setEvidenceBusy(false));
          }}
        />
      )}
    </div>
  );
}
