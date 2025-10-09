import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert, Badge, Button, Card, Divider, Group, Loader, Modal, Select,
  Stack, Text, TextInput, Title, Switch, Tooltip
} from '@mantine/core';
import {
  IconAlertTriangle, IconCircleCheck, IconLock, IconLockOpen, IconPhone,
  IconReplace, IconSearch, IconTrash
} from '@tabler/icons-react';
import axiosClient from '@/api/axiosClient';
import { useUser } from '@/context/UserContext';

/* ---------------- helpers ---------------- */
const fmtLocal = (n) => {
  if (!n) return '';
  const bare = String(n).replace(/[^\d]/g, '');
  if (bare.length === 11 && bare.startsWith('1')) {
    return `(${bare.slice(1,4)}) ${bare.slice(4,7)}-${bare.slice(7)}`;
  }
  if (bare.length === 10) {
    return `(${bare.slice(0,3)}) ${bare.slice(3,6)}-${bare.slice(6)}`;
  }
  return n;
};
const daysLeft = (expiresAt) => {
  if (!expiresAt) return null;
  const t = new Date(expiresAt).getTime();
  return Math.max(0, Math.ceil((t - Date.now()) / (1000 * 60 * 60 * 24)));
};

/* ---------------- Number Picker (modal) ---------------- */
function NumberPickerModal({ opened, onClose, onAssigned }) {
  const [country, setCountry] = useState('US');
  const [area, setArea] = useState('');
  const [capability, setCapability] = useState('sms'); // sms | voice | both
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [assigningId, setAssigningId] = useState(null);
  const [lockOnAssign, setLockOnAssign] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!opened) {
      setArea('');
      setResults([]);
      setErr('');
      setCapability('sms');
      setLockOnAssign(false);
    }
  }, [opened]);

  const search = async () => {
    setLoading(true);
    setErr('');
    try {
      const { data } = await axiosClient.get('/numbers/search', {
        params: { country, areaCode: area.trim(), capability },
      });
      const items = Array.isArray(data) ? data : (data?.results || []);
      setResults(items.slice(0, 15));
    } catch {
      setErr('Could not load available numbers. Try a nearby area code.');
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const assign = async (n) => {
    const numberId = n.id || n.numberId || n.e164 || n.number;
    if (!numberId) return;
    setAssigningId(numberId);
    setErr('');
    try {
      // Optional: reserve (best-effort)
      try { await axiosClient.post('/numbers/reserve', { numberId }); } catch {}

      await axiosClient.post('/numbers/purchase', {
        numberId,
        lock: !!lockOnAssign,
      });

      // Let parent show a success banner and refresh
      onAssigned?.({ type: 'success', message: 'Number assigned.' });
      onClose();
    } catch {
      setErr('Could not assign that number. It may have just been taken—try another.');
    } finally {
      setAssigningId(null);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title="Pick a number" size="lg" radius="lg">
      <Stack gap="sm">
        <Group align="end" wrap="wrap">
          <Select
            label="Country"
            value={country}
            onChange={setCountry}
            data={[
              { value: 'US', label: 'United States' },
              { value: 'CA', label: 'Canada' },
              { value: 'GB', label: 'United Kingdom' },
              { value: 'AU', label: 'Australia' },
            ]}
            style={{ minWidth: 200 }}
          />
          <TextInput
            label="Area code / Region"
            placeholder="e.g., 415"
            value={area}
            onChange={(e) => setArea(e.currentTarget.value)}
            style={{ minWidth: 160 }}
          />
          <Select
            label="Capability"
            value={capability}
            onChange={setCapability}
            data={[
              { value: 'sms', label: 'SMS' },
              { value: 'voice', label: 'Voice' },
              { value: 'both', label: 'SMS + Voice' },
            ]}
            style={{ minWidth: 180 }}
          />
          <Button onClick={search} leftSection={<IconSearch size={16} />} loading={loading}>
            Search
          </Button>
        </Group>

        <Group gap="sm" align="center">
          <Switch
            checked={lockOnAssign}
            onChange={(e) => setLockOnAssign(e.currentTarget.checked)}
            onLabel={<IconLock size={14} />}
            offLabel={<IconLockOpen size={14} />}
            label="Lock this number (Premium)"
          />
          <Text size="sm" c="dimmed">Prevents recycling while your plan is active.</Text>
        </Group>

        {err ? <Alert color="red">{err}</Alert> : null}

        <Divider label="Available numbers" />

        {loading ? (
          <Group justify="center" my="md"><Loader /></Group>
        ) : results.length === 0 ? (
          <Text c="dimmed" size="sm">Enter a country & area code, then search.</Text>
        ) : (
          <Stack>
            {results.map((n) => {
              const id = n.id || n.e164 || n.number;
              return (
                <Card key={id} withBorder radius="md" p="sm">
                  <Group justify="space-between" align="center">
                    <Group>
                      <IconPhone size={18} />
                      <Stack gap={0}>
                        <Text fw={600}>{fmtLocal(n.local || n.display || n.e164 || n.number)}</Text>
                        <Text size="sm" c="dimmed">{n.e164 || n.number}</Text>
                      </Stack>
                      <Group gap={6}>
                        {(n.capabilities || n.caps || []).map((c) => (
                          <Badge key={c} variant="light">{String(c).toUpperCase()}</Badge>
                        ))}
                        {n.price ? <Badge variant="outline">${n.price}/mo</Badge> : null}
                      </Group>
                    </Group>
                    <Button onClick={() => assign(n)} loading={assigningId === id}>
                      Select
                    </Button>
                  </Group>
                </Card>
              );
            })}
          </Stack>
        )}
      </Stack>
    </Modal>
  );
}

/* ---------------- Manager (main card) ---------------- */
export default function PhoneNumberManager() {
  const { currentUser } = useUser();
  const plan = (currentUser?.plan || 'FREE').toUpperCase();
  const isPremium = plan === 'PREMIUM';
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(null); // { e164, locked, state:'none|active|expiring', expiresAt }
  const [pickerOpen, setPickerOpen] = useState(false);

  // Inline banner (no toasts)
  const [banner, setBanner] = useState(null); // { type, message, action?: {label, href} }

  // Avoid StrictMode double-fetch
  const ran = useRef(false);

  const reload = async () => {
    setLoading(true);
    try {
      const { data } = await axiosClient.get('/numbers/status');
      setStatus(data || { state: 'none' });
    } catch {
      setBanner({ type: 'error', message: 'Unable to load phone number status.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    reload();
  }, []);

  const dLeft = useMemo(() => daysLeft(status?.expiresAt), [status]);

  const lock = async () => {
    const hasNumber = status?.state === 'active';
    if (!hasNumber) {
      setBanner({ type: 'info', message: 'Assign a number first.' });
      return;
    }
    if (!isPremium) {
      setBanner({
        type: 'warning',
        message: 'Locking numbers is a Premium feature.',
        action: { label: 'Upgrade', href: '/settings/upgrade' },
      });
      return;
    }
    try {
      await axiosClient.post('/numbers/lock');
      setBanner({ type: 'success', message: 'Number locked.' });
      reload();
    } catch (e) {
      if (e?.response?.status === 402 || e?.response?.data?.error === 'premium_required') {
        setBanner({
          type: 'warning',
          message: 'Locking numbers is a Premium feature.',
          action: { label: 'Upgrade', href: '/settings/upgrade' },
        });
      } else {
        setBanner({ type: 'error', message: 'Could not lock the number.' });
      }
    }
  };

  const unlock = async () => {
    try {
      await axiosClient.post('/numbers/unlock');
      setBanner({ type: 'success', message: 'Number unlocked.' });
      reload();
    } catch {
      setBanner({ type: 'error', message: 'Could not unlock the number.' });
    }
  };

  const releaseNumber = async () => {
    if (!window.confirm('Release your current number? It may be assigned to someone else.')) return;
    try {
      await axiosClient.post('/numbers/release');
      setBanner({ type: 'warning', message: 'Number released.' });
      reload();
    } catch {
      setBanner({ type: 'error', message: 'Could not release the number.' });
    }
  };

  const headerBadge = () => {
    if (loading) return null;
    if (status?.state === 'active') {
      return <Badge color="green" variant="light" leftSection={<IconCircleCheck size={14} />}>Active</Badge>;
    }
    if (status?.state === 'expiring') {
      return (
        <Tooltip label={`Expires in ${dLeft} day${dLeft === 1 ? '' : 's'}`}>
          <Badge color="yellow" variant="light" leftSection={<IconAlertTriangle size={14} />}>
            Expiring{dLeft != null ? ` (${dLeft}d)` : ''}
          </Badge>
        </Tooltip>
      );
    }
    return <Badge variant="outline">No number</Badge>;
  };

  const bannerColor =
    banner?.type === 'error' ? 'red'
    : banner?.type === 'warning' ? 'yellow'
    : banner?.type === 'success' ? 'green'
    : 'blue';

  return (
    <>
      <Card withBorder radius="lg" p="lg">
        {/* Inline banner instead of toast */}
        {banner?.message && (
          <Alert color={bannerColor} withCloseButton onClose={() => setBanner(null)} mb="sm">
            <Group justify="space-between" align="center" wrap="nowrap">
              <Text>{banner.message}</Text>
              {banner?.action && (
                <Button component={Link} to={banner.action.href} size="xs" radius="xl">
                  {banner.action.label}
                </Button>
              )}
            </Group>
          </Alert>
        )}

        <Group justify="space-between" align="start" mb="xs">
          <Group>
            <IconPhone size={20} />
            <Title order={4} m={0}>Phone number</Title>
            {headerBadge()}
          </Group>
          <Group gap="xs">
            {status?.locked ? (
              <Button variant="light" leftSection={<IconLockOpen size={16} />} onClick={unlock}>
                Unlock
              </Button>
            ) : (
              <Tooltip
                label={
                  status?.state !== 'active'
                    ? 'Assign a number first'
                    : !isPremium
                    ? 'Premium feature'
                    : 'Lock your number'
                }
              >
                <Button
                  variant="light"
                  leftSection={<IconLock size={16} />}
                  onClick={lock}
                  disabled={status?.state !== 'active'}
                >
                  Lock
                </Button>
              </Tooltip>
            )}
            {status?.state === 'active' ? (
              <>
                <Button color="orange" variant="light" leftSection={<IconReplace size={16} />} onClick={() => setPickerOpen(true)}>
                  Replace
                </Button>
                <Button color="red" variant="light" leftSection={<IconTrash size={16} />} onClick={releaseNumber}>
                  Release
                </Button>
              </>
            ) : (
              <Button onClick={() => setPickerOpen(true)}>Pick a number</Button>
            )}
          </Group>
        </Group>

        <Divider my="sm" />

        <Stack gap={4}>
          {loading ? (
            <Text c="dimmed">Loading…</Text>
          ) : status?.state === 'active' ? (
            <>
              <Text fw={600} size="lg">{fmtLocal(status.local || status.display || status.e164)}</Text>
              <Text size="sm" c="dimmed">{status.e164}</Text>
              <Group gap="xs" mt="xs">
                {status.capabilities?.includes('sms') && <Badge variant="outline">SMS</Badge>}
                {status.capabilities?.includes('voice') && <Badge variant="outline">VOICE</Badge>}
                {status.locked ? <Badge leftSection={<IconLock size={12} />}>Locked</Badge> : <Badge>Not locked</Badge>}
                {status.expiresAt ? (
                  <Badge color={status.state === 'expiring' ? 'yellow' : 'gray'} variant="light">
                    {status.state === 'expiring' ? `Expires in ${dLeft}d` : `Renews ${new Date(status.expiresAt).toLocaleDateString()}`}
                  </Badge>
                ) : null}
              </Group>
            </>
          ) : (
            <Text c="dimmed">No number assigned. Pick one by area code to start texting.</Text>
          )}
        </Stack>
      </Card>

      <NumberPickerModal
        opened={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onAssigned={(msg) => {
          setBanner(msg || { type: 'success', message: 'Number assigned.' });
          setPickerOpen(false);
          reload();
        }}
      />
    </>
  );
}
