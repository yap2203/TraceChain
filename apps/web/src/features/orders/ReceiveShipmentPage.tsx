import { LoadingIndicator } from '../../components/ui/LoadingIndicator';
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { CompanyRole, decodeShipmentQr } from '@tracechain/shared';
import { useWalletAuthentication } from '../auth/useWalletAuthentication';
import { ShipmentsWorkspace } from './ShipmentsWorkspace';
import { getOrders } from './orders.api';
import { Alert, Btn, Card } from '../workspaces/shared/ui';
import { Brand } from '../../components/brand/Brand';
import { parseShipmentReceiptLink } from './shipment-receipt-link';
import '../workspaces/workspace.css';

export function ReceiveShipmentPage() {
  const auth = useWalletAuthentication();
  const location = useLocation();
  const validation = useMemo(() => {
    try {
      return {
        link: parseShipmentReceiptLink(
          `${window.location.origin}${location.pathname}${location.search}${location.hash}`,
        ),
      };
    } catch (cause) {
      return {
        error:
          cause instanceof Error
            ? cause.message
            : 'This shipment receipt link is invalid or incomplete.',
      };
    }
  }, [location.pathname, location.search, location.hash]);
  const [record, setRecord] = useState<{
    actor: string;
    shipmentId: string;
    productOrderId?: string;
    kind: 'ingredient' | 'product';
  }>();
  const [error, setError] = useState('');
  const [wrongAccount, setWrongAccount] = useState(false);
  const role = (
    {
      [CompanyRole.SUPPLIER]: 'supplier',
      [CompanyRole.MANUFACTURER]: 'manufacturer',
      [CompanyRole.DISTRIBUTOR]: 'distributor',
      [CompanyRole.RETAILER]: 'retailer',
    } as const
  )[
    auth.state.role as
      | CompanyRole.SUPPLIER
      | CompanyRole.MANUFACTURER
      | CompanyRole.DISTRIBUTOR
      | CompanyRole.RETAILER
  ];
  const allowed = auth.state.phase === 'authenticated' && auth.state.authorizationReady && !!role;
  useEffect(() => {
    let active = true;
    setRecord(undefined);
    setError('');
    setWrongAccount(false);
    if (allowed && validation.link)
      void getOrders()
        .then((data) => {
          if (!Number.isSafeInteger(data.chainId) || typeof data.ordersAddress !== 'string')
            throw new Error(
              'The receipt service deployment configuration is unavailable. Please retry.',
            );
          if (data.actor.toLowerCase() !== auth.state.address?.toLowerCase())
            throw new Error('Your wallet session changed. Sign in again to open this shipment.');
          const decoded = decodeShipmentQr(validation.link.href, {
            chainId: data.chainId!,
            ordersAddress: data.ordersAddress!,
            publicAppUrl: validation.link.publicAppUrl,
          });
          const pickup = data.orders.find(
            (entry) =>
              decoded.kind === 'product' &&
              entry.orderId.toLowerCase() === decoded.shipmentId.toLowerCase() &&
              entry.productDelivery?.distributor?.toLowerCase() === data.actor.toLowerCase() &&
              Number(entry.productDelivery.stage) === 3,
          );
          const shipment = data.logistics?.shipments.find(
            (entry) => entry.shipmentId.toLowerCase() === decoded.shipmentId.toLowerCase(),
          );
          // Preserve the existing rejected ingredient return receipt for the original Supplier.
          const returning =
            shipment?.kind === 'ingredient' &&
            Number(shipment.leg) === 1 &&
            Number(shipment.status) === 4 &&
            shipment.sender?.toLowerCase() === data.actor.toLowerCase();
          if (
            !pickup &&
            !returning &&
            (!shipment || shipment.recipient?.toLowerCase() !== data.actor.toLowerCase())
          ) {
            if (active) setWrongAccount(true);
            throw new Error(
              'Wrong account or unavailable shipment. Sign in with the intended receiving company wallet.',
            );
          }
          if (!pickup && shipment?.kind !== decoded.kind)
            throw new Error('This QR is for a different shipment kind.');
          if (active)
            setRecord({
              actor: data.actor,
              shipmentId: pickup ? '' : decoded.shipmentId,
              productOrderId: pickup?.orderId,
              kind: decoded.kind,
            });
        })
        .catch((cause) => {
          if (active) setError(cause.message);
        });
    return () => {
      active = false;
    };
  }, [allowed, auth.state.address, validation]);
  return (
    <main className="workspace-ui min-h-screen p-[20px]">
      <div className="grid w-full gap-[20px]">
        <Brand />
        {validation.error && <Alert type="error" message={validation.error} />}
        {!allowed && validation.link && (
          <Card>
            <h1>Shipment receipt</h1>
            <p>{auth.state.message}</p>
            <Btn onClick={() => void auth.connect()}>Connect MetaMask & sign in</Btn>
            <Btn variant="outline" onClick={() => void auth.connectMobile()}>
              Use MetaMask Mobile
            </Btn>
            <Link to={`/login?returnTo=${encodeURIComponent(validation.link.returnTo)}`}>
              Continue on sign-in page
            </Link>
            {auth.state.phase === 'switch_required' && (
              <Btn onClick={() => void auth.switchToTargetNetwork()}>Switch network</Btn>
            )}
          </Card>
        )}
        {error && <Alert type="error" message={error} />}
        {wrongAccount && (
          <Btn variant="outline" onClick={() => void auth.logout()}>
            Switch wallet
          </Btn>
        )}
        {allowed && validation.link && !record && !error && (
          <LoadingIndicator page label="Checking the shipment and your company authorization…" />
        )}
        {allowed &&
          validation.link &&
          record &&
          record.actor.toLowerCase() === auth.state.address?.toLowerCase() && (
            <ShipmentsWorkspace
              key={record.actor}
              role={role}
              initialKind={record.kind}
              section={role === 'distributor' && !record.productOrderId ? 'intake' : 'tracking'}
              initialShipmentId={record.shipmentId}
              initialOrderId={record.productOrderId}
              initialQr={validation.link.href}
            />
          )}
      </div>
    </main>
  );
}
