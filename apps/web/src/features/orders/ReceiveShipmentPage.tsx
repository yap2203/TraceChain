import { useEffect, useState } from 'react';
import { CompanyRole, decodeShipmentQr } from '@tracechain/shared';
import { useWalletAuthentication } from '../auth/useWalletAuthentication';
import { ShipmentsWorkspace } from './ShipmentsWorkspace';
import { getOrders } from './orders.api';
import { Alert, Btn, Card } from '../workspaces/shared/ui';
import { Brand } from '../../components/brand/Brand';
import '../workspaces/workspace.css';

export function ReceiveShipmentPage() {
  const auth = useWalletAuthentication();
  const [record, setRecord] = useState<{ actor: string; shipmentId: string }>();
  const [error, setError] = useState('');
  const role = (
    {
      [CompanyRole.SUPPLIER]: 'supplier',
      [CompanyRole.MANUFACTURER]: 'manufacturer',
      [CompanyRole.DISTRIBUTOR]: 'distributor',
      [CompanyRole.RETAILER]: 'retailer',
    } as const
  )[auth.state.role as CompanyRole.SUPPLIER];
  const allowed = auth.state.phase === 'authenticated' && auth.state.authorizationReady && !!role;
  useEffect(() => {
    let active = true;
    setRecord(undefined);
    setError('');
    if (allowed)
      void getOrders()
        .then((data) => {
          const decoded = decodeShipmentQr(window.location.href, {
            chainId: data.chainId!,
            ordersAddress: data.ordersAddress!,
            publicAppUrl: import.meta.env.VITE_PUBLIC_APP_URL,
          });
          if (
            !data.logistics?.shipments.some(
              (entry) => entry.shipmentId.toLowerCase() === decoded.shipmentId.toLowerCase(),
            )
          )
            throw new Error('This shipment is unavailable to your company.');
          if (active) setRecord({ actor: data.actor, shipmentId: decoded.shipmentId });
        })
        .catch((cause) => {
          if (active) setError(cause.message);
        });
    return () => {
      active = false;
    };
  }, [allowed, auth.state.address]);
  return (
    <main className="workspace-ui min-h-screen p-[20px]">
      <div className="mx-auto grid max-w-[1200px] gap-[20px]">
        <Brand />
        {!allowed && (
          <Card>
            <h1>Shipment receipt</h1>
            <p>{auth.state.message}</p>
            <Btn onClick={() => void auth.connect()}>Connect MetaMask & sign in</Btn>
            <Btn variant="outline" onClick={() => void auth.connectMobile()}>
              Use MetaMask Mobile
            </Btn>
            {auth.state.phase === 'switch_required' && (
              <Btn onClick={() => void auth.switchToTargetNetwork()}>Switch network</Btn>
            )}
          </Card>
        )}
        {error && <Alert type="error" message={error} />}
        {allowed && !record && !error && (
          <p role="status">Checking the shipment and your company authorization…</p>
        )}
        {allowed && record && record.actor.toLowerCase() === auth.state.address?.toLowerCase() && (
          <ShipmentsWorkspace
            key={record.actor}
            role={role}
            initialShipmentId={record.shipmentId}
            initialQr={window.location.href}
          />
        )}
      </div>
    </main>
  );
}
