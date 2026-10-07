import { useEffect, useState, useCallback } from 'react';
import axiosClient from '@/api/axiosClient';

export default function useEntitlements() {
  const [entitlements, setEntitlements] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setErr] = useState(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const { data } = await axiosClient.get('/premium/entitlements');
      setEntitlements(data);
      setErr(null);
    } catch (e) {
      setErr(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { entitlements, loading, error, refresh };
}
