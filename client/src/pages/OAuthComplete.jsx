import { useEffect, useRef } from 'react';
import { Center, Stack, Text, Loader } from '@mantine/core';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useUser } from '@/context/UserContext';
import axiosClient from '@/api/axiosClient';
import { useTranslation } from 'react-i18next';

const LOGIN_FLAG_KEY = 'chatforiaHasLoggedIn';

export default function OAuthComplete() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { setCurrentUser } = useUser?.() || {};
  const alive = useRef(true);
  const { t } = useTranslation();

  useEffect(() => {
    alive.current = true;

    (async () => {
      const next = searchParams.get('next') || '/';

      const safeFinish = (userObj) => {
        if (!alive.current) return;

        if (userObj) {
          // Mark this device as having successfully logged in via OAuth
          try {
            if (typeof window !== 'undefined') {
              window.localStorage.setItem(LOGIN_FLAG_KEY, 'true');
            }
          } catch {
            // ignore storage errors
          }

          setCurrentUser?.(userObj);
          navigate(next, { replace: true });
        } else {
          navigate('/login?error=sso_failed', { replace: true });
        }
      };

      try {
        const resp = await axiosClient.get('/auth/me');
        const data = resp?.data;
        const user =
          (data && data.user) ||
          (data && typeof data === 'object' && 'id' in data ? data : null);
        if (user) {
          safeFinish(user);
          return;
        }
      } catch {
        // fall through
      }

      try {
        const resp2 = await axiosClient.get('/users/me');
        const data2 = resp2?.data;
        const user2 =
          (data2 && data2.user) ||
          (data2 && typeof data2 === 'object' && 'id' in data2 ? data2 : null);
        if (user2) {
          safeFinish(user2);
          return;
        }
      } catch {
        // fall through
      }

      safeFinish(null);
    })();

    return () => {
      alive.current = false;
    };
  }, [searchParams, navigate, setCurrentUser]);

  return (
    <Center mih={160} data-testid="center">
      <Stack align="center" gap="xs" data-testid="stack">
        <Loader data-testid="loader" />
        <Text c="dimmed">
          {t('oauth.completing', 'Completing sign-in…')}
        </Text>
      </Stack>
    </Center>
  );
}
