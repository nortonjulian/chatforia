import { useCallback, useEffect, useRef, useState } from 'react';
import { Device } from '@twilio/voice-sdk';
import { fetchVoiceToken } from '@/api/voiceClientApi';
import { toast } from '@/utils/safeToast';

export function useTwilioVoice() {
  const deviceRef = useRef(null);
  const tokenRef = useRef(null);

  const [ready, setReady] = useState(false);
  const [initializing, setInitializing] = useState(false);
  const [calling, setCalling] = useState(false);
  const [callStatus, setCallStatus] = useState('idle');
  const [error, setError] = useState(null);
  const [currentCall, setCurrentCall] = useState(null);

  const clearCallState = useCallback(() => {
    setCalling(false);
    setCurrentCall(null);
    setCallStatus('idle');
  }, []);

  const attachCallListeners = useCallback((call) => {
    if (!call || typeof call.on !== 'function') return;

    call.on('accept', () => {
      setCalling(false);
      setCurrentCall(call);
      setCallStatus('in-call');
      console.log('[twilio] Call accepted');
    });

    call.on('disconnect', () => {
      setCalling(false);
      setCurrentCall(null);
      setCallStatus('ended');
      console.log('[twilio] Call disconnected');

      setTimeout(() => {
        setCallStatus('idle');
      }, 1200);
    });

    call.on('cancel', () => {
      setCalling(false);
      setCurrentCall(null);
      setCallStatus('ended');
      console.log('[twilio] Call cancelled');

      setTimeout(() => {
        setCallStatus('idle');
      }, 1200);
    });

    call.on('reject', () => {
      setCalling(false);
      setCurrentCall(null);
      setCallStatus('ended');
      console.log('[twilio] Call rejected');

      setTimeout(() => {
        setCallStatus('idle');
      }, 1200);
    });

    call.on('error', (err) => {
      const msg = err?.message || 'Twilio call error';
      setError(msg);
      setCalling(false);
      setCurrentCall(null);
      setCallStatus('error');
      toast.err?.(msg);
      console.error('[twilio] Call error', err);
    });
  }, []);

  const initDevice = useCallback(async () => {
    if (deviceRef.current) return deviceRef.current;

    setInitializing(true);
    setCallStatus('initializing');
    setError(null);

    try {
      const { token, identity } = await fetchVoiceToken();
      tokenRef.current = token;

      const device = new Device(token, {
        logLevel: 'error',
      });

      device.on('registered', () => {
        setReady(true);
        setError(null);
        setCallStatus((prev) => (prev === 'initializing' ? 'ready' : prev));
        console.log('[twilio] Device registered for', identity);
      });

      device.on('error', (err) => {
        const msg = err?.message || 'Twilio device error';
        setError(msg);
        setCalling(false);
        setCallStatus('error');
        toast.err?.(msg);
        console.error('[twilio] Device error', err);
      });

      device.on('incoming', (call) => {
        console.log('[twilio] Incoming call from', call.parameters?.From);
        setCurrentCall(call);
        setCallStatus('incoming');
        attachCallListeners(call);
      });

      await device.register();
      deviceRef.current = device;

      return device;
    } catch (e) {
      const msg =
        e?.response?.data?.error ||
        e?.response?.data?.message ||
        e?.message ||
        'Failed to initialize voice device';

      setError(msg);
      setCalling(false);
      setCallStatus('error');
      toast.err?.(msg);
      throw e;
    } finally {
      setInitializing(false);
    }
  }, [attachCallListeners]);

  const startBrowserCall = useCallback(
    async (toNumber) => {
      const to = String(toNumber || '').trim();

      if (!to) {
        const msg = 'Please enter a phone number.';
        setError(msg);
        setCallStatus('error');
        toast.err?.(msg);
        return;
      }

      try {
        setCalling(true);
        setError(null);
        setCallStatus('connecting');

        const device = await initDevice();
        if (!device) throw new Error('Twilio device not ready');

        const call = await device.connect({
          params: { To: to },
        });

        setCurrentCall(call);
        setCallStatus('ringing');
        attachCallListeners(call);

        toast.ok?.('Calling from your browser…');
        return call;
      } catch (e) {
        const msg =
          e?.response?.data?.error ||
          e?.response?.data?.message ||
          e?.message ||
          e?.toString?.() ||
          'Failed to start browser call';

        setError(msg);
        setCalling(false);
        setCallStatus('error');
        toast.err?.(msg);
        throw e;
      }
    },
    [attachCallListeners, initDevice]
  );

  const hangup = useCallback(() => {
    try {
      setCallStatus('ending');

      if (currentCall) {
        currentCall.disconnect();
      } else if (deviceRef.current) {
        deviceRef.current.disconnectAll();
      }
    } catch (e) {
      console.error('[twilio] hangup error', e);
    } finally {
      clearCallState();
    }
  }, [clearCallState, currentCall]);

  useEffect(() => {
    return () => {
      try {
        if (deviceRef.current) {
          deviceRef.current.destroy();
        }
      } catch (e) {
        console.error('[twilio] device destroy error', e);
      } finally {
        deviceRef.current = null;
      }
    };
  }, []);

  return {
    ready,
    initializing,
    calling,
    callStatus,
    error,
    currentCall,
    startBrowserCall,
    hangup,
  };
}