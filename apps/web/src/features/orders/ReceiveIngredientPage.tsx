import { LoadingIndicator } from '../../components/ui/LoadingIndicator';
import { useCallback, useEffect, useState } from 'react';
import { CompanyRole, decodeIngredientDeliveryQr } from '@tracechain/shared';
import { useWalletAuthentication } from '../auth/useWalletAuthentication';
import { getOrders, type OrdersState } from './orders.api';
import { IngredientDeliveryPanel } from './IngredientDeliveryPanel';
import { Alert, Btn, Card } from '../workspaces/shared/ui';
import { Brand } from '../../components/brand/Brand';
import '../workspaces/workspace.css';

/** A locator may be opened publicly; all records and actions require current SIWE authorization. */
export function ReceiveIngredientPage() {
  const auth = useWalletAuthentication();
  const [data, setData] = useState<OrdersState>(),
    [orderId, setOrderId] = useState(''),
    [error, setError] = useState('');
  const allowed =
    auth.state.phase === 'authenticated' &&
    auth.state.authorizationReady &&
    [CompanyRole.SUPPLIER, CompanyRole.DISTRIBUTOR, CompanyRole.MANUFACTURER].includes(
      auth.state.role as CompanyRole,
    );
  const load = useCallback(async () => {
    const result = await getOrders();
    if (!result.ingredientDeliverySupported)
      throw new Error(
        'This deployment does not support ingredient delivery labels. Deploy the updated suite.',
      );
    const decoded = decodeIngredientDeliveryQr(window.location.href, {
      chainId: result.chainId!,
      ordersAddress: result.ordersAddress!,
      publicAppUrl: import.meta.env.VITE_PUBLIC_APP_URL,
    });
    if (
      !result.orders.some(
        (entry) => entry.orderId.toLowerCase() === decoded.orderId.toLowerCase() && entry.delivery,
      )
    )
      throw new Error('This delivery was not found or does not belong to your company.');
    setData(result);
    setOrderId(decoded.orderId);
    setError('');
  }, []);
  useEffect(() => {
    if (!allowed) {
      setData(undefined);
      return;
    }
    void load().catch((cause) => setError(cause.message));
  }, [allowed, auth.state.address, load]);
  const order = data?.orders.find((entry) => entry.orderId.toLowerCase() === orderId.toLowerCase());
  return (
    <main className="workspace-ui min-h-screen w-full p-[20px]">
      <div className="grid w-full gap-[20px]">
        <header>
          <Brand />
        </header>
        <Card>
          <h1>Ingredient delivery receipt</h1>
          <p>
            Supplier → Distributor → Manufacturer. Sign in with the company wallet responsible for
            this handoff.
          </p>
          {!allowed && (
            <>
              <p>{auth.state.message}</p>
              <Btn
                disabled={['restoring', 'connecting', 'signing', 'verifying'].includes(
                  auth.state.phase,
                )}
                onClick={() => void auth.connect()}
              >
                Connect MetaMask & sign in
              </Btn>
              <Btn variant="outline" onClick={() => void auth.connectMobile()}>
                Use MetaMask Mobile
              </Btn>
              {auth.state.phase === 'switch_required' && (
                <Btn onClick={() => void auth.switchToTargetNetwork()}>Switch network</Btn>
              )}
            </>
          )}
          {error && <Alert type="error" message={error} />}
          {allowed && !data && !error && (
            <LoadingIndicator
              page
              label="Checking the delivery against the configured blockchain…"
            />
          )}
          {allowed &&
            data &&
            order &&
            data.actor.toLowerCase() === auth.state.address?.toLowerCase() && (
              <IngredientDeliveryPanel
                key={order.orderId}
                data={data}
                order={order}
                item={data.catalogue.find((entry) => entry.itemId === order.itemId)}
                onChanged={load}
                initialQr={window.location.href}
              />
            )}
        </Card>
      </div>
    </main>
  );
}
