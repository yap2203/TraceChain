import { reportError } from '../../components/ui/feedback';
import { useEffect, useRef, useState } from 'react';
import { deliveryIdentity, type OrderRecord, type OrdersState } from './orders.api';
import { Alert, Btn, Input } from '../workspaces/shared/ui';
import {
  getActiveMessagingAgent,
  createCompanyIdentityPresentation,
  createSelectiveCompanyIdentityPresentation,
} from '../didcomm/didcomm-agent';
import { PresentationSigningSettingsLink } from '../didcomm/HolderSigningKeyPanel';
import { submitProductionTransaction } from '../production-flow/production-flow.transaction';

export function DeliveryIdentityPanel({
  order,
  data,
  onChanged,
}: {
  order: OrderRecord;
  data: OrdersState;
  onChanged: () => Promise<void>;
}) {
  const sellerLabel = order.productDelivery ? 'Manufacturer' : 'Supplier';
  const supplier = data.actor.toLowerCase() === order.seller.toLowerCase();
  const [status, setStatus] = useState<any>(),
    [material, setMaterial] = useState<any>();
  const [purpose, setPurpose] = useState(
    'Verify seller company identity before collecting or dispatching these goods',
  );
  const [claims, setClaims] = useState<string[]>(['companyName']);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const pending = useRef(false);
  const refresh = async () =>
    setStatus(await deliveryIdentity(order.orderId, { action: 'status' }));
  useEffect(() => {
    let active = true;
    void deliveryIdentity(order.orderId, { action: 'status' })
      .then((result) => {
        if (active) {
          setStatus(result);
          if (result.purpose) setPurpose(result.purpose);
          if (result.optionalClaims) setClaims(result.optionalClaims);
        }
      })
      .catch((cause) => {
        if (
          active &&
          !/not found|not requested|request company identity first/i.test(cause.message)
        )
          setError(cause.message);
      });
    return () => {
      active = false;
    };
  }, [order.orderId, order.delivery.identityChallenge, order.delivery.identityCredentialHash]);
  const run = async (operation: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await operation();
      await refresh();
      await onChanged();
    } catch (cause) {
      setError(reportError(cause, 'Company proof could not be processed.'));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  const submit = async (result: any) => {
    if (result.transaction) await submitProductionTransaction(result.transaction, data.actor);
  };
  return (
    <section
      className="grid gap-[12px] rounded-lg border border-[var(--c-border)] p-[12px]"
      aria-label={`${sellerLabel} company evidence`}
    >
      <h4 className="m-0">{sellerLabel} company evidence · Optional delivery check</h4>
      <p className="m-0">
        Proof status: {status?.status ?? 'Not requested'}. This is separate from approval, pickup
        and receipt.
      </p>
      {error && <Alert type="error" message={error} />}
      {notice && <Alert type="success" message={notice} />}
      {!supplier && (
        <>
          <Input
            label={`Why is ${sellerLabel} company evidence needed?`}
            value={purpose}
            onChange={setPurpose}
            maxLength={500}
          />
          <fieldset>
            <legend>Additional claims to request</legend>
            {['companyName', 'companyRegistrationNumber', 'id'].map((claim) => (
              <label key={claim} className="mr-[12px] inline-flex items-center gap-[6px]">
                <input
                  type="checkbox"
                  checked={claims.includes(claim)}
                  onChange={(event) =>
                    setClaims((current) =>
                      event.target.checked
                        ? [...current, claim]
                        : current.filter((value) => value !== claim),
                    )
                  }
                />
                {claim}
              </label>
            ))}
          </fieldset>
          <Btn
            disabled={
              busy ||
              !purpose.trim() ||
              ['PRESENTED', 'VERIFIED'].includes(status?.status) ||
              (status?.status === 'REQUESTED' &&
                !!order.delivery.identityChallenge &&
                !/^0x0+$/.test(order.delivery.identityChallenge))
            }
            onClick={() =>
              void run(async () => {
                const expiresAt = Math.min(
                  Math.floor(Date.now() / 1000) + 1800,
                  Number(order.expiresAt),
                );
                await submit(
                  await deliveryIdentity(order.orderId, {
                    action: 'request',
                    purpose: purpose.trim(),
                    expiresAt,
                    required: true,
                    requiredClaims: ['companyId', 'role', 'walletAddress'],
                    optionalClaims: claims,
                  }),
                );
                setNotice(
                  `${sellerLabel} evidence requested through encrypted company messaging. If requested, verification is required before pickup or dispatch.`,
                );
              })
            }
          >
            {status?.status === 'REQUESTED'
              ? 'Complete company evidence request'
              : `Request ${sellerLabel} Company Role VP`}
          </Btn>
          {status?.status === 'PRESENTED' && (
            <Btn
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const result = await deliveryIdentity(order.orderId, { action: 'verify' });
                  await submit(result);
                  setStatus(result);
                  setNotice(`Proof checked: ${result.checks?.join(', ') ?? 'Verified'}`);
                })
              }
            >
              Verify {sellerLabel} proof & record result
            </Btn>
          )}
        </>
      )}
      {supplier && status?.status === 'REQUESTED' && (
        <div className="flex flex-wrap gap-[8px]">
          <Btn
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const value = await deliveryIdentity(order.orderId, { action: 'material' });
                setMaterial(value);
                setSelected(value.requiredClaims ?? []);
              })
            }
          >
            Preview requested company evidence
          </Btn>
          <Btn
            variant="outline"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await deliveryIdentity(order.orderId, { action: 'decline' });
                setMaterial(undefined);
              })
            }
          >
            Decline company evidence
          </Btn>
        </div>
      )}
      {supplier && material && (
        <>
          <Alert
            type="warning"
            message={
              material.format === 'COMPANY_IDENTITY_SD_JWT'
                ? 'Review the claims and choose optional fields to share. The proof is bound to this Distributor, request, purpose, challenge and expiry.'
                : 'Full disclosure: this presentation includes your entire signed Company Role Credential. Individual fields cannot be hidden in this format.'
            }
          />
          <p>
            Purpose: {material.purpose} · Expires:{' '}
            {new Date(material.expiresAt * 1000).toLocaleString()}
          </p>
          <dl>
            {Object.entries(material.claims ?? material.credential.credentialSubject).map(
              ([key, value]) => (
                <div key={key} className="min-w-0 break-words">
                  <dt>
                    {material.format === 'COMPANY_IDENTITY_SD_JWT' && (
                      <input
                        aria-label={`Share ${key}`}
                        type="checkbox"
                        checked={selected.includes(key)}
                        disabled={material.requiredClaims.includes(key)}
                        onChange={(event) =>
                          setSelected((current) =>
                            event.target.checked
                              ? [...current, key]
                              : current.filter((claim) => claim !== key),
                          )
                        }
                      />
                    )}
                    {key}
                  </dt>
                  <dd>{String(value)}</dd>
                </div>
              ),
            )}
          </dl>
          <PresentationSigningSettingsLink
            role={order.productDelivery ? 'manufacturer' : 'supplier'}
          />
          <Btn
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const holder = getActiveMessagingAgent();
                if (!holder || holder.did !== material.holderDid)
                  throw new Error(
                    'Create or restore the presentation signing key bound to this company in Profile before presenting.',
                  );
                const presentation =
                  material.format === 'COMPANY_IDENTITY_SD_JWT'
                    ? await createSelectiveCompanyIdentityPresentation(holder, material.sdJwt, {
                        audience: material.audience,
                        nonce: material.challenge,
                        claims: selected,
                      })
                    : await createCompanyIdentityPresentation(holder, material);
                await deliveryIdentity(order.orderId, { action: 'present', presentation });
                setMaterial(undefined);
                setNotice('Company proof sent securely to the assigned Distributor.');
              })
            }
          >
            Approve & sign {sellerLabel} company proof
          </Btn>
        </>
      )}
      <Btn variant="outline" disabled={busy} onClick={() => void run(refresh)}>
        Refresh proof status
      </Btn>
      {status?.checks && <p>Checks: {status.checks.join(', ')}</p>}
      {status?.credential && (
        <details>
          <summary>Verified shared company claims</summary>
          <dl>
            {Object.entries(status.credential).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd className="break-words">
                  {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </section>
  );
}
