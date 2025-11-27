import { useCallback, useEffect, useRef, useState } from 'react';
import { Device } from '@twilio/voice-sdk';
import { fetchVoiceToken } from '@/api/voiceClientApi';
import { toast } from '@/utils/safeToast';

/**
 * useTwilioVoice
 *
 * Manages a single Twilio.Device instance for browser ↔ PSTN calling.
 * - Lazily initializes on first call (fetches /voice/token).
 * - Exposes startBrowserCall(to) and hangup().
 * - Tracks ready/initializing/calling/error state.
 */
export function useTwilioVoice() {
  const deviceRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [initializing, setInitializing] = useState(false);
  const [calling, setCalling] = useState(false);
  const [error, setError] = useState(null);
  const [currentCall, setCurrentCall] = useState(null);

  // Optional: keep last token around in case you want manual refresh later
  const tokenRef = useRef(null);

  const initDevice = useCallback(async () => {
    if (deviceRef.current) return deviceRef.current;

    setInitializing(true);
    setError(null);

    try {
      const { token, identity } = await fetchVoiceToken();
      tokenRef.current = token;

      const device = new Device(token, {
        logLevel: 'error',
      });

      // Device event handlers
      device.on('registered', () => {
        setReady(true);
        setError(null);
        // eslint-disable-next-line no-console
        console.log('[twilio] Device registered for', identity);
      });

      device.on('error', (err) => {
        const msg = err?.message || 'Twilio device error';
        setError(msg);
        toast.err?.(msg);
      });

      device.on('incoming', (connection) => {
        // For now just log and ignore; you can later present a UI + accept/reject.
        // eslint-disable-next-line no-console
        console.log('[twilio] Incoming call from', connection.parameters?.From);
        // Example if you want auto-reject for now:
        // connection.reject();
      });

      device.on('connect', (connection) => {
        // Outgoing or accepted incoming connection is now established
        setCalling(false);
        setCurrentCall(connection);
        // eslint-disable-next-line no-console
        console.log('[twilio] Call connected');
      });

      device.on('disconnect', () => {
        setCalling(false);
        setCurrentCall(null);
        // eslint-disable-next-line no-console
        console.log('[twilio] Call disconnected');
      });

      device.on('cancel', () => {
        setCalling(false);
        setCurrentCall(null);
        // eslint-disable-next-line no-console
        console.log('[twilio] Call cancelled');
      });

      await device.register();
      deviceRef.current = device;

      return device;
    } catch (e) {
      const msg =
        e?.response?.data?.error ||
        e?.message ||
        'Failed to initialize voice device';
      setError(msg);
      toast.err?.(msg);
      throw e;
    } finally {
      setInitializing(false);
    }
  }, []);

  const startBrowserCall = useCallback(
    async (toNumber) => {
      const to = String(toNumber || '').trim();
      if (!to) {
        const msg = 'Please enter a phone number.';
        setError(msg);
        toast.err?.(msg);
        return;
      }

      try {
        setCalling(true);
        setError(null);

        const device = await initDevice();
        if (!device) {
          throw new Error('Twilio device not ready');
        }

        // TwiML will see this as parameter "To"
        const connection = await device.connect({
          params: { To: to },
        });

        setCurrentCall(connection);
        toast.ok?.('Calling from your browser…');
        return connection;
      } catch (e) {
        const msg =
          e?.message ||
          e?.toString?.() ||
          'Failed to start browser call';
        setError(msg);
        setCalling(false);
        toast.err?.(msg);
        throw e;
      }
    },
    [initDevice]
  );

  const hangup = useCallback(() => {
    try {
      if (currentCall) {
        currentCall.disconnect();
      } else if (deviceRef.current) {
        // Disconnect all active connections
        deviceRef.current.disconnectAll();
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[twilio] hangup error', e);
    } finally {
      setCurrentCall(null);
      setCalling(false);
    }
  }, [currentCall]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      try {
        if (deviceRef.current) {
          deviceRef.current.destroy();
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[twilio] device destroy error', e);
      } finally {
        deviceRef.current = null;
      }
    };
  }, []);

  return {
    // state
    ready,
    initializing,
    calling,
    error,
    currentCall,

    // actions
    startBrowserCall,
    hangup,
  };
}
