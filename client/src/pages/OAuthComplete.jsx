import { useEffect, useRef } from 'react';
import { Center, Stack, Text, Loader } from '@mantine/core';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useUser } from '@/context/UserContext';
import axiosClient from '@/api/axiosClient';

export default function OAuthComplete() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { setCurrentUser } = useUser?.() || {};
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;

    (async () => {
      const next = searchParams.get('next') || '/';

      const safeFinish = (userObj) => {
        if (!alive.current) return;
        if (userObj) {
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
        {/* Only one element with data-testid="loader" */}
        <Loader data-testid="loader" />
        <Text c="dimmed">Completing sign-in…</Text>
      </Stack>
    </Center>
  );
}
