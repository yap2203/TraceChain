import { useCallback, useEffect, useState } from 'react';

import { getApplications } from '../../../blockchain/blockchain.api';
import type { ChainApplication } from './types';

export function useChainApplications() {
  const [applications, setApplications] = useState<ChainApplication[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const result = await getApplications<ChainApplication>();
      setApplications(result.applications);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Local blockchain applications could not be loaded.');
      setApplications([]);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void reload(); }, [reload]);
  return { applications, error, loading, reload };
}
