import { ApplicationDocumentsPanel } from '../registration/ApplicationDocumentsPanel';
import { reportError } from '../../components/ui/feedback';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  MapPin,
  PackageCheck,
  Pencil,
  Plus,
  Send,
  Warehouse,
} from 'lucide-react';
import {
  getCompanyProfile,
  prepareOrder,
  prepareLogistics,
  updateLocationLabel,
  type CompanyLocation,
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
    [adding, setAdding] = useState(false),
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
  if (!data && !error) return <CompanyProfileSkeleton />;
  const incompleteLocations = data?.locations.filter((location) =>
    locationIncomplete(role, location),
  );
  return (
    <div className="workspace-flow-page">
      <SectionTitle
        title="Company profile & locations"
        sub="Manage your company details and locations used for orders and deliveries."
        action={
          data ? (
            <Btn icon={<Plus size={16} />} onClick={() => setAdding(true)}>
              Add location
            </Btn>
          ) : undefined
        }
      />
      {error && <Alert type="error" message={error} />}
      {notice && <Alert type="success" message={notice} />}
      {!data ? (
        <Card className="workspace-profile-error">
          <AlertTriangle size={22} aria-hidden="true" />
          <div>
            <strong>Locations could not be loaded</strong>
            <span>Check the connection and try again. Existing records are unchanged.</span>
          </div>
          <Btn variant="outline" onClick={() => void load()}>
            Retry
          </Btn>
        </Card>
      ) : (
        <>
          <div className="profile-summary-grid" aria-label="Location summary">
            <InventorySummaryCard
              label="Total locations"
              value={data.locations.length}
              icon={<MapPin size={20} />}
            />
            <InventorySummaryCard
              label="Active locations"
              value={data.locations.length - (incompleteLocations?.length ?? 0)}
              icon={<CheckCircle2 size={20} />}
            />
            <InventorySummaryCard
              label="Incomplete setup"
              value={incompleteLocations?.length ?? 0}
              note="Missing address or required warehouse setup"
              icon={<AlertTriangle size={20} />}
            />
          </div>
          <header className="workspace-profile-section-heading">
            <div>
              <h3>Registered locations</h3>
              <p>Locations available to your company for operational workflows.</p>
            </div>
            <span>
              {data.locations.length} {data.locations.length === 1 ? 'location' : 'locations'}
            </span>
          </header>
          <section
            className={`workspace-profile-locations${data.locations.length ? '' : ' workspace-profile-locations--empty'}`}
            aria-label="Your registered locations"
          >
            {!data.locations.length && (
              <div className="workspace-profile-empty">
                <EmptyState
                  icon={<MapPin size={30} />}
                  title="No registered locations"
                  sub="Add a location before arranging orders, dispatches or deliveries."
                  action={
                    <Btn icon={<Plus size={16} />} onClick={() => setAdding(true)}>
                      Add your first location
                    </Btn>
                  }
                />
              </div>
            )}
            {data.locations.map((location) => {
              const capabilities = locationCapabilities(role, location.warehouse);
              const incomplete = locationIncomplete(role, location);
              return (
                <Card key={location.location} className="workspace-location-card">
                  <div className="workspace-location-heading">
                    <span className="workspace-location-heading__icon">
                      {location.warehouse ? <Warehouse size={20} /> : <Building2 size={20} />}
                    </span>
                    <div>
                      <span>{capabilities.type}</span>
                      <h3>{location.label}</h3>
                    </div>
                    <Badge
                      label={incomplete ? 'Setup incomplete' : 'Active'}
                      variant={incomplete ? 'pending' : 'active'}
                    />
                  </div>
                  <div className="workspace-location-address">
                    <MapPin size={16} aria-hidden="true" />
                    <span>{location.address || 'Address not provided'}</span>
                  </div>
                  <dl className="workspace-location-usage">
                    <div>
                      <dt>Supported activities</dt>
                      <dd>{capabilities.activities}</dd>
                    </div>
                  </dl>
                  <div
                    className="workspace-location-capabilities"
                    aria-label="Location capabilities"
                  >
                    <LocationCapability
                      icon={<Send size={15} />}
                      label="Dispatch"
                      enabled={capabilities.dispatch}
                    />
                    <LocationCapability
                      icon={<PackageCheck size={15} />}
                      label="Receiving"
                      enabled={capabilities.receiving}
                    />
                  </div>
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
                        Complete warehouse setup
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
              );
            })}
          </section>
          <ApplicationDocumentsPanel collapsible />
        </>
      )}
      {adding && data && (
        <Modal
          title={role === 'distributor' ? 'Add warehouse location' : 'Add location'}
          width={720}
          onClose={() => {
            if (!busy) setAdding(false);
          }}
        >
          <div className="company-location-form">
            <section>
              <span>1. Location name</span>
              <Input
                label={role === 'distributor' ? 'Warehouse name' : 'Location name'}
                value={name}
                onChange={setName}
                maxLength={160}
                required
                placeholder="A name your company can recognize"
              />
            </section>
            <section>
              <span>2. Full address</span>
              <Textarea
                label="Dispatch / receiving address"
                value={address}
                onChange={setAddress}
                required
                maxLength={1000}
                placeholder="Street address, building or unit, city, postcode and country"
              />
            </section>
            <section>
              <span>3. Location capabilities</span>
              <p>{locationCapabilities(role, role === 'distributor').activities}</p>
              {role === 'distributor' && (
                <p className="workspace-list-guidance">
                  Saving requires two MetaMask confirmations: location registration, then warehouse
                  registration.
                </p>
              )}
            </section>
            <section className="company-location-form__review">
              <span>4. Review and save</span>
              <strong>{name.trim() || 'Location name required'}</strong>
              <p>{address.trim() || 'Full address required'}</p>
            </section>
            <div className="company-location-form__actions action-row">
              <Btn variant="ghost" disabled={busy} onClick={() => setAdding(false)}>
                Cancel
              </Btn>
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
                        setAdding(false);
                        setNotice(
                          'Location registered. Complete warehouse setup using the button on its card.',
                        );
                        return;
                      }
                    }
                    setName('');
                    setAddress('');
                    setAdding(false);
                    setNotice('Location registered successfully.');
                  })
                }
              >
                {busy ? 'Waiting for confirmationâ€¦' : 'Save location'}
              </Btn>
            </div>
          </div>
        </Modal>
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

function locationCapabilities(role: WorkspaceRole, warehouse: boolean) {
  if (role === 'distributor')
    return warehouse
      ? {
          type: 'Distributor warehouse',
          activities: 'Custody intake, inventory, dispatch and receipt',
          dispatch: true,
          receiving: true,
        }
      : {
          type: 'Company location',
          activities: 'Warehouse setup must be completed before custody workflows',
          dispatch: false,
          receiving: false,
        };
  if (role === 'manufacturer')
    return {
      type: 'Production location',
      activities: 'Ingredient receipt, production and product dispatch',
      dispatch: true,
      receiving: true,
    };
  if (role === 'supplier')
    return {
      type: 'Supplier location',
      activities: 'Ingredient stock pickup and custody dispatch',
      dispatch: true,
      receiving: false,
    };
  return {
    type: 'Retail location',
    activities: 'Product receipt and retail custody',
    dispatch: false,
    receiving: true,
  };
}

function locationIncomplete(role: WorkspaceRole, location: CompanyLocation) {
  return !location.address?.trim() || (role === 'distributor' && !location.warehouse);
}

function LocationCapability({
  icon,
  label,
  enabled,
}: {
  icon: ReactNode;
  label: string;
  enabled: boolean;
}) {
  return (
    <span className={enabled ? 'is-enabled' : 'is-disabled'}>
      {icon}
      <span>{label}</span>
      <strong>{enabled ? 'Enabled' : 'Disabled'}</strong>
    </span>
  );
}

function CompanyProfileSkeleton() {
  return (
    <div
      className="workspace-flow-page workspace-profile-skeleton"
      aria-label="Loading company profile"
    >
      <div className="workspace-profile-skeleton__heading" />
      <div className="profile-summary-grid">
        {[0, 1, 2].map((item) => (
          <div className="workspace-profile-skeleton__summary" key={item} />
        ))}
      </div>
      <div className="workspace-profile-skeleton__cards">
        {[0, 1].map((item) => (
          <div className="workspace-profile-skeleton__card" key={item} />
        ))}
      </div>
    </div>
  );
}
