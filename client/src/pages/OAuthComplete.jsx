import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Center, Loader, Stack, Text } from '@mantine/core';
import axiosClient from '@/api/axiosClient';
import { useUser } from '@/context/UserContext';

export default function OAuthComplete() {
  const { setCurrentUser } = useUser();
  const [params] = useSearchParams();
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // Hit whatever your API exposes to read the logged-in user
        const res =
          (await axiosClient.get('/auth/me').catch(() => null)) ||
          (await axiosClient.get('/users/me').catch(() => null));

        const user = res?.data?.user ?? res?.data ?? null;
        if (!cancelled && user) {
          setCurrentUser(user);
          const next = params.get('next') || '/';
          navigate(next, { replace: true });
          return;
        }
      } catch (_) {}
      if (!cancelled) navigate('/login?error=sso_failed', { replace: true });
    })();

    return () => { cancelled = true; };
  }, [navigate, params, setCurrentUser]);

  return (
    <Center mih={160}>
      <Stack gap="xs" align="center">
        <Loader />
        <Text size="sm" c="dimmed">Completing sign-in…</Text>
      </Stack>
    </Center>
  );
}
