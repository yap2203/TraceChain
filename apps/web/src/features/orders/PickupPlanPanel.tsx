import { reportError } from '../../components/ui/feedback';
import { useEffect, useRef, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { getPickupPlan, savePickupPlan, type PickupPlan } from './orders.api';
import { Alert, Btn, Input } from '../workspaces/shared/ui';
const localDate = (timestamp: number) => {
  const date = new Date(timestamp);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
};
export function PickupPlanPanel({
  referenceId,
  canArrange,
  expiresAt,
  onReady,
}: {
  referenceId: string;
  canArrange: boolean;
  expiresAt: number;
  onReady?: (ready: boolean) => void;
}) {
  const [plan, setPlan] = useState<PickupPlan | null>(),
    [value, setValue] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const callback = useRef(onReady);
  callback.current = onReady;
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setPlan(undefined);
    setError('');
    callback.current?.(false);
    void getPickupPlan(referenceId)
      .then((result) => {
        if (active) {
          setPlan(result.plan);
          if (result.plan) setValue(localDate(result.plan.pickupAt * 1000));
          callback.current?.(!!result.plan);
        }
      })
      .catch((cause) => {
        if (active) setError(reportError(cause, 'Pickup arrangement is unavailable.'));
      });
    return () => {
      active = false;
    };
  }, [referenceId, attempt]);
  const timestamp = Math.floor(Date.parse(value) / 1000);
  return (
    <section className="workspace-pickup-plan" aria-label="Pickup arrangement">
      <h4>
        <CalendarClock size={18} aria-hidden="true" />
        Pickup arrangement
      </h4>
      {plan ? (
        <p role="status">
          Planned pickup: <strong>{new Date(plan.pickupAt * 1000).toLocaleString()}</strong>
        </p>
      ) : (
        <p>
          {error && plan === undefined
            ? 'Pickup arrangement is unavailable.'
            : plan === undefined
              ? 'Checking pickup arrangement…'
              : 'The accepted Distributor has not scheduled pickup yet.'}
        </p>
      )}
      {error && (
        <>
          <Alert type="error" message={error} />
          {plan === undefined && (
            <Btn onClick={() => setAttempt(attempt + 1)}>Retry pickup arrangement</Btn>
          )}
        </>
      )}
      {canArrange && plan !== undefined && (
        <div className="workspace-profile-form">
          <Input
            label="Planned pickup date and time"
            type="datetime-local"
            value={value}
            onChange={setValue}
            min={localDate(Date.now())}
            max={localDate(expiresAt * 1000)}
            required
          />
          <Btn
            disabled={busy || !(timestamp > Date.now() / 1000 && timestamp < expiresAt)}
            onClick={async () => {
              if (busy) return;
              setBusy(true);
              setError('');
              try {
                const result = await savePickupPlan(referenceId, timestamp);
                setPlan(result.plan);
                callback.current?.(true);
              } catch (cause) {
                setError(reportError(cause, 'Pickup could not be arranged.'));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Saving…' : plan ? 'Update pickup time' : 'Arrange pickup'}
          </Btn>
        </div>
      )}
    </section>
  );
}
