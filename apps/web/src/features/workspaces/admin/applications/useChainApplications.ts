import { JsonRpcProvider } from 'ethers';
import { useCallback, useEffect, useState } from 'react';

import { chainConfig } from '../../../../config/chain';
import { stakeholderRegistry } from '../../../../config/contracts';
import type { ApplicationStatus, ChainApplication } from './types';

const roles = ['', 'System Admin', 'Supplier', 'Manufacturer', 'Distributor', 'Retailer'] as const;
const statuses: ApplicationStatus[] = ['pending', 'pending', 'additional evidence required', 'approved', 'rejected', 'withdrawn'];

export function useChainApplications() {
  const [applications, setApplications] = useState<ChainApplication[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const provider = new JsonRpcProvider(chainConfig.rpcUrl, chainConfig.chainId, { staticNetwork: true });
      const registry = stakeholderRegistry(provider);
      const count = Number(await registry.applicationCount());
      const ids = await registry.getApplicationIds(0, count) as string[];
      const records = await Promise.all(ids.map(async (applicationId) => {
        const record = await registry.getApplication(applicationId);
        return {
          applicant: record.applicant as string,
          encryptedProfileCid: record.encryptedProfileCid as string,
          id: applicationId,
          previousApplicationId: record.previousApplicationId as string,
          profileHash: record.profileHash as string,
          requestedRole: roles[Number(record.requestedRole)] as ChainApplication['requestedRole'],
          status: statuses[Number(record.status)] ?? 'pending',
          submittedAt: Number(record.submittedAt),
          updatedAt: Number(record.updatedAt),
        };
      }));
      setApplications(records.reverse());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Local blockchain applications could not be loaded.');
      setApplications([]);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void reload(); }, [reload]);
  return { applications, error, loading, reload };
}
