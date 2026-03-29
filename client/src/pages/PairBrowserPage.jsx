import { useEffect, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  Center,
  Group,
  Loader,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from '@mantine/core';
import { ShieldCheck, Laptop, RefreshCw, LockKeyhole } from 'lucide-react';
import { useUser } from '@/context/UserContext';
import {
  requestBrowserPairing,
  fetchBrowserPairingStatus,
  tryInstallKeysFromApprovedPairing,
  getLocalKeyBundleMeta,
} from '@/utils/encryptionClient';

export default function PairBrowserPage() {
  const {
    currentUser,
    authLoading,
    setNeedsKeyUnlock,
    setKeyMeta,
  } = useUser();

  const [starting, setStarting] = useState(true);
  const [pairingActive, setPairingActive] = useState(false);
  const [approved, setApproved] = useState(false);
  const [error, setError] = useState(null);
  const [timedOut, setTimedOut] = useState(false);

  const pollRef = useRef(null);
  const timeoutRef = useRef(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      if (pollRef.current) clearInterval(pollRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (authLoading || !currentUser) return;

    startPairing();

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, currentUser?.id]);

  async function startPairing() {
    setStarting(true);
    setError(null);
    setTimedOut(false);
    setApproved(false);

    if (pollRef.current) clearInterval(pollRef.current);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    try {
      await requestBrowserPairing(null);

      if (!mountedRef.current) return;

      setPairingActive(true);
      setStarting(false);

      pollRef.current = setInterval(async () => {
        try {
          const { device } = await fetchBrowserPairingStatus(null);

          if (!mountedRef.current) return;

          if (device?.revokedAt) {
            clearInterval(pollRef.current);
            pollRef.current = null;
            setPairingActive(false);
            setError('This browser pairing request was revoked.');
            return;
          }

          if (device?.pairingStatus === 'rejected') {
            clearInterval(pollRef.current);
            pollRef.current = null;
            setPairingActive(false);
            setError('This browser pairing request was rejected on iPhone.');
            return;
          }

          if (device?.pairingStatus === 'approved' && device?.wrappedAccountKey) {
            const installed = await tryInstallKeysFromApprovedPairing(null);

            if (!mountedRef.current) return;

            if (installed) {
              const newMeta = await getLocalKeyBundleMeta();

              if (!mountedRef.current) return;

              clearInterval(pollRef.current);
              pollRef.current = null;
              clearTimeout(timeoutRef.current);
              timeoutRef.current = null;

              setKeyMeta(newMeta || null);
              setNeedsKeyUnlock(false);
              setApproved(true);
              setPairingActive(false);
            }
          }
        } catch (err) {
          if (!mountedRef.current) return;
          console.warn('[PairBrowserPage] polling failed', err?.message || err);
        }
      }, 2000);

      timeoutRef.current = setTimeout(() => {
        if (!mountedRef.current) return;

        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }

        setPairingActive(false);
        setTimedOut(true);
      }, 45000);
    } catch (err) {
      if (!mountedRef.current) return;

      console.warn('[PairBrowserPage] startPairing failed', err?.message || err);
      setError('Could not start secure browser pairing.');
      setStarting(false);
      setPairingActive(false);
    }
  }

  if (!authLoading && !currentUser) {
    return <Navigate to="/" replace />;
  }

  if (approved) {
    return <Navigate to="/chat" replace />;
  }

  return (
    <Center mih="70vh" px="md">
      <Card
        withBorder
        radius="xl"
        p="xl"
        maw={560}
        w="100%"
        shadow="sm"
      >
        <Stack gap="lg">
          <Group justify="center">
            <ThemeIcon size={64} radius="xl" variant="light">
              <ShieldCheck size={34} />
            </ThemeIcon>
          </Group>

          <Stack gap={6} align="center">
            <Title order={2} ta="center">
              Secure Browser Pairing
            </Title>
            <Text c="dimmed" ta="center">
              Approve this browser on your iPhone to unlock your encrypted chats.
            </Text>
          </Stack>

          <Card withBorder radius="lg" p="md">
            <Group wrap="nowrap" align="flex-start">
              <ThemeIcon variant="light" radius="xl" size={40}>
                <Laptop size={20} />
              </ThemeIcon>

              <Box>
                <Text fw={600}>This browser is requesting access</Text>
                <Text size="sm" c="dimmed" mt={4}>
                  Chatforia will never send your account private key in plaintext.
                  Your iPhone securely wraps it for this browser only.
                </Text>
              </Box>
            </Group>
          </Card>

          {starting && (
            <Group justify="center" gap="sm">
              <Loader size="sm" />
              <Text size="sm">Starting secure pairing…</Text>
            </Group>
          )}

          {pairingActive && (
            <Stack gap="sm">
              <Alert
                variant="light"
                radius="lg"
                icon={<LockKeyhole size={18} />}
                title="Waiting for approval"
              >
                Open Chatforia on your iPhone and approve this browser.
              </Alert>

              <Group justify="center" gap="sm">
                <Loader size="sm" />
                <Text size="sm" c="dimmed">
                  Listening for approval…
                </Text>
              </Group>
            </Stack>
          )}

          {timedOut && (
            <Alert color="yellow" radius="lg" title="Pairing timed out">
              We did not receive approval in time. Try again and approve the browser on your iPhone.
            </Alert>
          )}

          {error && (
            <Alert color="red" radius="lg" title="Pairing failed">
              {error}
            </Alert>
          )}

          <Button
            size="md"
            radius="xl"
            leftSection={<RefreshCw size={16} />}
            onClick={startPairing}
            loading={starting}
            disabled={pairingActive}
          >
            Retry pairing
          </Button>

          <Text size="xs" c="dimmed" ta="center">
            This is a one-time approval for this browser unless local storage is cleared or the device is revoked.
          </Text>
        </Stack>
      </Card>
    </Center>
  );
}