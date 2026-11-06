import { useCallback, useEffect, useState } from 'react';
import { getOperationalData, type OperationalData } from './blockchain.api';

const emptyData: OperationalData = {
  evidenceRequests: [],
  ingredientBatches: [],
  productBatches: [],
  transfers: [],
};

export function useOperationalData() {
  const [data, setData] = useState<OperationalData>(emptyData);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await getOperationalData());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read blockchain data.');
      setData(emptyData);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, error, loading, reload };
}
