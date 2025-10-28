import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
} from 'react';
import axiosClient from '@/api/axiosClient';
import { useSocket } from './SocketContext';
import i18n from '@/i18n';

const UserContext = createContext(null);

export function UserProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState(null);

  const { refreshRooms, reconnect, disconnect } = useSocket();

  const bootstrap = useCallback(async () => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      const { data } = await axiosClient.get('/auth/me');
      const user = data?.user ?? data;

      // ✅ Apply user's preferred language or fallback to browser default
      if (user?.preferredLanguage) {
        await i18n.changeLanguage(user.preferredLanguage);
      } else {
        const browserLng = navigator.language?.split('-')?.[0];
        if (browserLng) {
          await i18n.changeLanguage(browserLng);
        }
      }

      setCurrentUser(user);

      reconnect?.();
      await refreshRooms?.();
    } catch (err) {
      if (err?.response?.status === 401) {
        setCurrentUser(null);
      } else {
        console.warn('Failed to load /auth/me', err?.message || err);
        setAuthError('Failed to verify session');
        setCurrentUser(null);
      }
      disconnect?.();
    } finally {
      setAuthLoading(false);
    }
  }, [reconnect, refreshRooms, disconnect]);

  useEffect(() => {
    bootstrap();

    const onUnauthorized = () => {
      setCurrentUser(null);
      disconnect?.();
    };
    window.addEventListener('auth-unauthorized', onUnauthorized);
    return () => window.removeEventListener('auth-unauthorized', onUnauthorized);
  }, [bootstrap, disconnect]);

  const logout = useCallback(async () => {
    try {
      await axiosClient.post('/auth/logout', null, {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      });
    } catch {
      // ignore
    }
    localStorage.removeItem('token');
    localStorage.removeItem('foria_jwt');
    document.cookie = 'foria_jwt=; Max-Age=0; path=/';
    setCurrentUser(null);
    disconnect?.();
  }, [disconnect]);

  const value = useMemo(
    () => ({ currentUser, setCurrentUser, authLoading, authError, logout }),
    [currentUser, authLoading, authError, logout]
  );

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export function useUser() {
  return useContext(UserContext);
}

export { UserContext };