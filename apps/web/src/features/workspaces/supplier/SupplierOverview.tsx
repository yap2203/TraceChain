import { reportError } from '../../../components/ui/feedback';
import { LoadingIndicator } from '../../../components/ui/LoadingIndicator';
import { Boxes, ClipboardList, PackageCheck, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useOperationalData } from '../../blockchain/useOperationalData';
import { formatOperationalQuantity } from '../shared/operational-format';
import {
  StakeholderOverviewLayout,
  type OverviewRecord,
} from '../shared/StakeholderOverviewLayout';
import {
  getIngredientBatches,
  type RegisteredIngredientBatch,
} from './batches/ingredient-batch.api';

export function SupplierOverview({ onNav }: { onNav: (tab: string) => void }) {
  const { data, error: operationalError, loading: operationalLoading } = useOperationalData();
  const [batches, setBatches] = useState<RegisteredIngredientBatch[]>([]);
  const [batchError, setBatchError] = useState('');
  const [batchesLoading, setBatchesLoading] = useState(true);

  useEffect(() => {
    let active = true;
    getIngredientBatches()
      .then(({ batches: result }) => {
        if (active) setBatches(result);
      })
      .catch((caught: unknown) => {
        if (active) setBatchError(reportError(caught, 'Batches could not be loaded.'));
      })
      .finally(() => {
        if (active) setBatchesLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  if (batchesLoading || operationalLoading)
    return <LoadingIndicator page label="Loading Supplier overview" />;

  const activeBatches = batches.filter((batch) => batch.status === 1);
  const availableBatches = activeBatches.filter((batch) => BigInt(batch.availableQuantity) > 0n);
  const pendingRequests = data.evidenceRequests.filter((request) => request.status === 1);
  const attention: OverviewRecord[] = pendingRequests.map((request) => {
    const batch = batches.find((entry) => entry.batchId === request.ingredientBatchId);
    return {
      name: batch?.ingredientName ?? 'Ingredient evidence request',
      reference: batch?.batchReference ?? 'Registered ingredient batch',
      companyName: request.manufacturerName ?? 'Requesting Manufacturer',
      description: `Evidence response due ${new Date(request.dueAt * 1_000).toLocaleString()}.`,
      badge: { label: 'Awaiting response', variant: 'pending' },
      actionLabel: 'Review request',
      onAction: () => onNav('requests'),
      technical: [
        { label: 'Request ID', value: request.requestId },
        { label: 'Ingredient batch ID', value: request.ingredientBatchId },
      ],
    };
  });
  const recent: OverviewRecord[] = batches.slice(0, 5).map((batch) => ({
    name: batch.ingredientName,
    reference: batch.batchReference,
    itemCategory: batch.category,
    description: `${formatOperationalQuantity(batch.availableQuantity, batch.unit)} available; ${batch.origin || 'Origin not provided'}`,
    badge: {
      label: batch.status === 1 ? 'Active' : 'Unavailable',
      variant: batch.status === 1 ? 'active' : 'pending',
    },
    actionLabel: 'View ingredients',
    onAction: () => onNav('batches'),
    technical: [
      { label: 'Batch ID', value: batch.batchId },
      { label: 'Credential ID', value: batch.credentialId },
    ],
  }));

  return (
    <>
      <StakeholderOverviewLayout
        errors={[batchError, operationalError]}
        title="Supplier overview"
        description="Monitor ingredient availability, evidence requests and recent registered batches."
        metrics={[
          { label: 'Ingredient batches', value: batches.length, icon: <Boxes size={21} /> },
          {
            label: 'Available batches',
            value: availableBatches.length,
            icon: <PackageCheck size={21} />,
          },
          {
            label: 'Evidence requests',
            value: data.evidenceRequests.length,
            icon: <ClipboardList size={21} />,
          },
          {
            label: 'Awaiting response',
            value: pendingRequests.length,
            icon: <ShieldCheck size={21} />,
          },
        ]}
        attention={attention}
        recent={recent}
        emptyAttention="No evidence requests need a response"
        emptyRecent="No ingredient batches registered"
      />
    </>
  );
}
