import { useState, useCallback } from 'react';
import { startAliasCall } from '@/api/voiceApi';
import { toast } from '@/utils/safeToast';

export function usePstnCall() {
  const [loading, setLoading] = useState(false);
  const [lastResult, setLastResult] = useState(null);
  const [error, setError] = useState(null);

  const placeCall = useCallback(
    async (rawNumber) => {
      const to = String(rawNumber || '').trim();
      setError(null);
      setLastResult(null);

      if (!to) {
        const msg = 'Please enter a phone number.';
        setError(msg);
        toast.err?.(msg);
        return;
      }

      try {
        setLoading(true);
        const result = await startAliasCall(to);
        setLastResult(result);

        if (result?.ok) {
          toast.ok?.('Calling via your Chatforia number…');
        } else {
          toast.err?.('We could not start the call.');
        }

        return result;
      } catch (err) {
        const msg =
          err?.response?.data?.error ||
          err?.response?.data?.message ||
          err?.message ||
          'Failed to start call';
        setError(msg);
        toast.err?.(msg);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  return {
    placeCall,
    loading,
    error,
    lastResult,
  };
}
