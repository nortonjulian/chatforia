import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
} from 'react';
import axiosClient from '@/api/axiosClient';
import { useSocket } from './SocketContext';
import i18n from '@/i18n';
import { applyAccountTheme } from '@/utils/themeManager';
import {
  getLocalKeyBundleMeta,
  getUnlockedPrivateKeyForPublicKey,
  unlockKeyBundle,
  getPersistedUnlockPasscodeForSession,
  clearPersistedUnlockPasscodeForSession,
} from '@/utils/encryptionClient';

import {
  requestBrowserPairing,
  tryInstallKeysFromApprovedPairing,
} from '@/utils/encryptionClient';

const UserContext = createContext(null);

// helper to read XSRF-TOKEN from cookies
function getXsrfToken() {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function hasAuthHint() {
  if (typeof window === 'undefined') return false;

  const hasCookieHint =
    document.cookie.includes('foria_jwt=') ||
    document.cookie.includes('cf_session=');

  const hasStorageHint =
    !!localStorage.getItem('foria_jwt') ||
    !!localStorage.getItem('token') ||
    !!localStorage.getItem('cf_session');

  return hasCookieHint || hasStorageHint;
}

export function UserProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState(null);

  const [needsKeyUnlock, setNeedsKeyUnlock] = useState(false);
  const [keyMeta, setKeyMeta] = useState(null);

  const { refreshRooms, reconnect, disconnect } = useSocket();

  const [keyUnlockLoading, setKeyUnlockLoading] = useState(false);
  const [pairingPending, setPairingPending] = useState(false);

  const bootstrappedRef = useRef(false);

  const bootstrap = useCallback(async () => {
    if (!hasAuthHint()) {
      setCurrentUser(null);
      setKeyMeta(null);
      setNeedsKeyUnlock(false);
      setAuthError(null);
      setPairingPending(false);
      disconnect?.();
      setAuthLoading(false);
      return;
    }

    setAuthLoading(true);
    setAuthError(null);

    try {
      const { data } = await axiosClient.get('/auth/me');
      const user = data?.user ?? data;

      // Language
      if (user?.preferredLanguage) {
        await i18n.changeLanguage(user.preferredLanguage);
      } else {
        const browserLng = navigator.language?.split('-')?.[0];
        if (browserLng) {
          await i18n.changeLanguage(browserLng);
        }
      }

      // Theme
      if (user?.theme) {
        applyAccountTheme(user.theme);
      }

      const serverPublicKey = (user?.publicKey || '').trim();

      let meta = null;
      try {
        meta = await getLocalKeyBundleMeta();
      } catch (keyErr) {
        console.warn('Failed to inspect local key bundle', keyErr?.message || keyErr);
        meta = null;
      }

      setKeyMeta(meta || null);

      let shouldUnlock = false;
      let restoreReason = null;

      // 🔐 NEW: pairing-first logic
      if (serverPublicKey && !meta?.publicKey) {
        console.log('[E2EE] no local key → attempting pairing flow');

        try {
          await requestBrowserPairing(null);
          setPairingPending(true);

          let approved = false;

          for (let i = 0; i < 20; i++) {
            await new Promise((r) => setTimeout(r, 2000));

            try {
              const installed = await tryInstallKeysFromApprovedPairing(null);

              if (installed) {
                console.log('[E2EE] pairing success → keys installed');
                approved = true;
                break;
              }
            } catch (err) {
              console.warn('[E2EE] pairing poll error', err?.message || err);
            }
          }

          setPairingPending(false);

          if (approved) {
            const newMeta = await getLocalKeyBundleMeta();
            setKeyMeta(newMeta || null);
            shouldUnlock = false;
          } else {
            shouldUnlock = true;
            restoreReason =
              'Approve this browser on your iPhone or restore your encryption key.';
          }
        } catch (err) {
          setPairingPending(false);
          console.warn('[E2EE] pairing flow failed', err?.message || err);

          shouldUnlock = true;
          restoreReason =
            'Failed to pair this browser. Restore your encryption key.';
        }
      }

      // Wrong key
      if (serverPublicKey && meta?.publicKey && meta.publicKey !== serverPublicKey) {
        shouldUnlock = true;
        restoreReason =
          'This browser has a different encryption key than your Chatforia account. Restore the correct key.';
      }

      // Locked bundle
      if (
        !shouldUnlock &&
        serverPublicKey &&
        meta?.publicKey === serverPublicKey &&
        meta?.hasEncrypted
      ) {
        try {
          await getUnlockedPrivateKeyForPublicKey(serverPublicKey);
        } catch (err) {
          const msg = err?.message || String(err);

          if (msg === 'LOCKED') {
            const savedPasscode = getPersistedUnlockPasscodeForSession();

            if (savedPasscode) {
              setKeyUnlockLoading(true);

              try {
                await unlockKeyBundle(savedPasscode);
                await getUnlockedPrivateKeyForPublicKey(serverPublicKey);
                shouldUnlock = false;
              } catch {
                clearPersistedUnlockPasscodeForSession();
                shouldUnlock = true;
                restoreReason = 'Unlock your encryption key to continue.';
              } finally {
                setKeyUnlockLoading(false);
              }
            } else {
              shouldUnlock = true;
              restoreReason = 'Unlock your encryption key to continue.';
            }
          }
        }
      }

      setCurrentUser(user);
      setNeedsKeyUnlock(shouldUnlock);

      if (shouldUnlock) {
        setAuthError(restoreReason);
        disconnect?.();
        return;
      }

      reconnect?.();
      refreshRooms?.().catch((err) => {
        console.warn('[UserContext] background refreshRooms failed', err?.message || err);
      });
    } catch (err) {
      setPairingPending(false);

      if (err?.response?.status === 401) {
        setCurrentUser(null);
      } else {
        console.warn('Failed to load /auth/me', err?.message || err);
        setAuthError('Failed to verify session');
        setCurrentUser(null);
      }

      setKeyMeta(null);
      setNeedsKeyUnlock(false);
      disconnect?.();
    } finally {
      setAuthLoading(false);
    }
  }, [reconnect, refreshRooms, disconnect]);

  useEffect(() => {
    if (bootstrappedRef.current) return;
    bootstrappedRef.current = true;

    bootstrap();

    const onUnauthorized = () => {
      setCurrentUser(null);
      setKeyMeta(null);
      setNeedsKeyUnlock(false);
      setPairingPending(false);
      disconnect?.();
    };

    window.addEventListener('auth-unauthorized', onUnauthorized);

  return () => {
    window.removeEventListener('auth-unauthorized', onUnauthorized);
  };
}, [bootstrap, disconnect]);

  const logout = useCallback(async () => {
    try {
      const xsrf = getXsrfToken();

      await axiosClient.post(
        '/auth/logout',
        {},
        {
          withCredentials: true,
          headers: {
            'X-Requested-With': 'XMLHttpRequest',
            ...(xsrf
              ? {
                  'X-CSRF-Token': xsrf,
                  'X-XSRF-Token': xsrf,
                }
              : {}),
          },
        }
      );
    } catch {}

    localStorage.removeItem('token');
    localStorage.removeItem('foria_jwt');
    localStorage.removeItem('cf_session');

    document.cookie = 'foria_jwt=; Max-Age=0; path=/';
    document.cookie = 'cf_session=; Max-Age=0; path=/';

    setCurrentUser(null);
    setKeyMeta(null);
    setNeedsKeyUnlock(false);
    setAuthError(null);
    setPairingPending(false);

    disconnect?.();
    window.location.assign('/');
  }, [disconnect]);

  const value = useMemo(
    () => ({
      currentUser,
      setCurrentUser,
      authLoading,
      authError,
      logout,

      needsKeyUnlock,
      setNeedsKeyUnlock,
      keyMeta,
      setKeyMeta,
      pairingPending,
    }),
    [
      currentUser,
      authLoading,
      authError,
      logout,
      needsKeyUnlock,
      keyMeta,
      pairingPending,
    ]
  );

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export function useUser() {
  return useContext(UserContext);
}

export { UserContext };