import { ApplicationDocumentsPanel } from '../registration/ApplicationDocumentsPanel';
import { reportError } from '../../components/ui/feedback';
import { LoadingIndicator } from '../../components/ui/LoadingIndicator';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MapPin, Pencil, Plus, Warehouse } from 'lucide-react';
import {
  getCompanyProfile,
  prepareOrder,
  prepareLogistics,
  updateLocationLabel,
  type CompanyProfile,
} from './orders.api';
import { submitProductionTransaction } from '../production-flow/production-flow.transaction';
import {
  Alert,
  Btn,
  Card,
  EmptyState,
  Input,
  Modal,
  SectionTitle,
  TechnicalDetails,
} from '../workspaces/shared/ui';
import type { WorkspaceRole } from '../workspaces/workspace-navigation';

export function CompanyProfilePage({ role }: { role: WorkspaceRole }) {
  const [data, setData] = useState<CompanyProfile>(),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [name, setName] = useState(''),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState<string>(),
    [editName, setEditName] = useState('');
  const lock = useRef(false);
  const load = useCallback(async () => {
    setError('');
    try {
      const result = await getCompanyProfile();
      setData(result);
      setName(
        (current) =>
          current || (!result.locations.length ? (result.initialLocationName ?? '') : ''),
      );
    } catch (cause) {
      setError(reportError(cause, 'Company profile is unavailable.'));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const run = async (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      await load();
    } catch (cause) {
      setError(reportError(cause, 'The change could not be completed.'));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const publishWarehouse = async (location: string, label: string) => {
    if (!data) return;
    const prepared = await prepareLogistics({
      action: 'warehouse',
      operationId: crypto.randomUUID(),
      location,
      name: label,
    });
    await submitProductionTransaction(prepared.transaction, data.wallet);
  };
  if (!data && !error) return <LoadingIndicator page label="Loading records…" />;
  return (
    <div className="workspace-flow-page">
      <SectionTitle
        title="Company profile"
        sub={
          role === 'distributor'
            ? 'Manage your registered warehouses and company locations.'
            : 'Manage the locations your company uses for orders and deliveries.'
        }
      />
      <ApplicationDocumentsPanel />
      {error && <Alert type="error" message={error} />}
      {notice && <Alert type="success" message={notice} />}
      {!data ? (
        <Btn variant="outline" onClick={() => void load()}>
          Reload profile
        </Btn>
      ) : (
        <>
          <Card>
            <SectionTitle title={role === 'distributor' ? 'Add a warehouse' : 'Add a location'} />
            <div className="workspace-profile-form">
              <Input
                label={role === 'distributor' ? 'Warehouse name' : 'Location name'}
                value={name}
                onChange={setName}
                maxLength={160}
                required
                placeholder="A name your company can recognize"
              />
              <Btn
                icon={<Plus size={16} />}
                disabled={busy || !name.trim()}
                onClick={() =>
                  void run(async () => {
                    const prepared = await prepareOrder({
                      action: 'location',
                      operationId: crypto.randomUUID(),
                      label: name.trim(),
                    });
                    await submitProductionTransaction(prepared.transaction, data.wallet);
                    if (role === 'distributor') {
                      try {
                        await publishWarehouse(prepared.resultId, name.trim());
                      } catch {
                        setNotice(
                          'Location registered. Complete warehouse registration using the button on its card.',
                        );
                        return;
                      }
                    }
                    setName('');
                    setNotice('Location registered successfully.');
                  })
                }
              >
                {busy
                  ? 'Waiting for confirmation…'
                  : role === 'distributor'
                    ? 'Register warehouse'
                    : 'Register location'}
              </Btn>
            </div>
            {role === 'distributor' && (
              <p className="workspace-list-guidance">
                A new warehouse requires two MetaMask confirmations: location registration, then
                warehouse registration.
              </p>
            )}
          </Card>
          <section className="workspace-profile-locations" aria-label="Your registered locations">
            {!data.locations.length && (
              <EmptyState
                icon={<MapPin size={38} />}
                title="No registered locations"
                sub="Register your first location to use it on orders and deliveries."
              />
            )}
            {data.locations.map((location) => (
              <Card key={location.location}>
                <div className="workspace-location-heading">
                  {location.warehouse ? <Warehouse size={20} /> : <MapPin size={20} />}
                  <h3>{location.label}</h3>
                </div>
                <div className="workspace-location-actions">
                  <Btn
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    icon={<Pencil size={14} />}
                    onClick={() => {
                      setEditing(location.location);
                      setEditName(location.label);
                    }}
                  >
                    Edit display name
                  </Btn>
                  {role === 'distributor' && !location.warehouse && (
                    <Btn
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await publishWarehouse(location.location, location.label);
                          setNotice('Warehouse registration completed.');
                        })
                      }
                    >
                      Complete warehouse registration
                    </Btn>
                  )}
                </div>
                <TechnicalDetails
                  fields={[
                    { label: 'Location ID', value: location.location },
                    { label: 'Original registered name', value: location.registeredLabel },
                  ]}
                />
              </Card>
            ))}
          </section>
        </>
      )}
      {editing && (
        <Modal
          title="Edit location display name"
          onClose={() => {
            if (!busy) setEditing(undefined);
          }}
        >
          <div className="workspace-flow-page">
            <Input
              label="Display name"
              value={editName}
              onChange={setEditName}
              required
              maxLength={160}
            />
            <p className="workspace-list-guidance">
              This changes the displayed name. Existing on-chain identifiers and historical records
              stay fixed.
            </p>
            <Btn
              disabled={busy || !editName.trim()}
              onClick={() =>
                void run(async () => {
                  await updateLocationLabel(editing, editName.trim());
                  setEditing(undefined);
                  setNotice('Location display name updated.');
                })
              }
            >
              Save name
            </Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}
