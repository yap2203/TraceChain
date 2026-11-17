import { ApplicationDocumentsPanel } from '../registration/ApplicationDocumentsPanel';
import { reportError } from '../../components/ui/feedback';
import { LoadingIndicator } from '../../components/ui/LoadingIndicator';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, MapPin, Pencil, Plus, Warehouse } from 'lucide-react';
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
  Badge,
  Btn,
  Card,
  EmptyState,
  Input,
  InventorySummaryCard,
  Modal,
  SectionTitle,
  TechnicalDetails,
  Textarea,
} from '../workspaces/shared/ui';
import type { WorkspaceRole } from '../workspaces/workspace-navigation';

export function CompanyProfilePage({ role }: { role: WorkspaceRole }) {
  const [data, setData] = useState<CompanyProfile>(),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [address, setAddress] = useState(''),
    [editAddress, setEditAddress] = useState('');
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
      setAddress(
        (current) =>
          current || (!result.locations.length ? (result.initialLocationAddress ?? '') : ''),
      );
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
          <div className="profile-summary-grid" aria-label="Location summary">
            <InventorySummaryCard
              label="Total locations"
              value={data.locations.length}
              icon={<MapPin size={20} />}
            />
            <InventorySummaryCard
              label="Active warehouses"
              value={data.locations.filter((location) => location.warehouse).length}
              icon={<Warehouse size={20} />}
            />
            <InventorySummaryCard
              label="Setup incomplete"
              value={
                role === 'distributor'
                  ? data.locations.filter((location) => !location.warehouse).length
                  : 0
              }
              note={
                role === 'distributor'
                  ? 'Location registered, warehouse pending'
                  : 'No additional setup'
              }
              icon={<AlertTriangle size={20} />}
            />
          </div>
          <Card>
            <SectionTitle title={role === 'distributor' ? 'Add a warehouse' : 'Add a location'} />
            <div className="workspace-profile-form workspace-profile-form--location">
              <Input
                label={role === 'distributor' ? 'Warehouse name' : 'Location name'}
                value={name}
                onChange={setName}
                maxLength={160}
                required
                placeholder="A name your company can recognize"
              />
              <Textarea
                label="Dispatch / receiving address"
                value={address}
                onChange={setAddress}
                required
                maxLength={1000}
                placeholder="Street address, building or unit, city, postcode and country"
              />
              <div className="action-row">
                <Btn
                  icon={<Plus size={16} />}
                  disabled={busy || !name.trim() || !address.trim()}
                  onClick={() =>
                    void run(async () => {
                      const prepared = await prepareOrder({
                        action: 'location',
                        operationId: crypto.randomUUID(),
                        label: name.trim(),
                        address: address.trim(),
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
                      setAddress('');
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
            </div>
            {role === 'distributor' && (
              <p className="workspace-list-guidance">
                A new warehouse requires two MetaMask confirmations: location registration, then
                warehouse registration.
              </p>
            )}
          </Card>
          <section
            className={`workspace-profile-locations${data.locations.length ? '' : ' workspace-profile-locations--empty'}`}
            aria-label="Your registered locations"
          >
            {!data.locations.length && (
              <div className="workspace-profile-empty">
                <EmptyState
                  icon={<MapPin size={38} />}
                  title="No registered locations"
                  sub="Register your first location to use it on orders and deliveries."
                />
              </div>
            )}
            {data.locations.map((location) => (
              <Card key={location.location} className="workspace-location-card">
                <div className="workspace-location-heading">
                  {location.warehouse ? <Warehouse size={20} /> : <MapPin size={20} />}
                  <div>
                    <span>{location.warehouse ? 'Warehouse' : 'Company location'}</span>
                    <h3>{location.label}</h3>
                    <p style={{ whiteSpace: 'pre-line' }}>
                      {location.address || 'Address not provided'}
                    </p>
                  </div>
                  <Badge
                    label={
                      role === 'distributor' && !location.warehouse
                        ? 'Setup incomplete'
                        : 'Registered'
                    }
                    variant={role === 'distributor' && !location.warehouse ? 'pending' : 'active'}
                  />
                </div>
                <dl className="workspace-location-usage">
                  <div>
                    <dt>Used by</dt>
                    <dd>{locationWorkflows(role, location.warehouse)}</dd>
                  </div>
                  <div>
                    <dt>Registration</dt>
                    <dd>
                      {role === 'distributor' && !location.warehouse
                        ? 'Location complete; warehouse registration required'
                        : 'Ready for authorized workflows'}
                    </dd>
                  </div>
                </dl>
                <div className="workspace-location-actions action-row">
                  <Btn
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    icon={<Pencil size={14} />}
                    onClick={() => {
                      setEditing(location.location);
                      setEditName(location.label);
                      setEditAddress(location.address ?? '');
                    }}
                  >
                    Edit location
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
          title="Edit location details"
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
            <Textarea
              label="Dispatch / receiving address"
              value={editAddress}
              onChange={setEditAddress}
              required
              maxLength={1000}
            />
            <p className="workspace-list-guidance">
              Use a new location for a different physical site. Editing current profile details does
              not move stock or rewrite historical location identifiers.
            </p>
            <div className="action-row">
              <Btn
                disabled={busy || !editName.trim() || !editAddress.trim()}
                onClick={() =>
                  void run(async () => {
                    await updateLocationLabel(editing, editName.trim(), editAddress.trim());
                    setEditing(undefined);
                    setNotice('Location details updated.');
                  })
                }
              >
                Save location
              </Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function locationWorkflows(role: WorkspaceRole, warehouse: boolean) {
  if (role === 'distributor')
    return warehouse
      ? 'Custody intake, inventory, dispatch and receipt'
      : 'Profile only until warehouse setup is completed';
  if (role === 'manufacturer') return 'Ingredient receipt, production and product dispatch';
  if (role === 'supplier') return 'Ingredient stock pickup and custody dispatch';
  return 'Product receipt and retail custody';
}
