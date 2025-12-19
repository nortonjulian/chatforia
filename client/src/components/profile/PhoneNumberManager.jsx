import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert,
  Badge,
  Button,
  Card,
  Divider,
  Group,
  Loader,
  Modal,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
  Switch,
  Tooltip,
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconCircleCheck,
  IconLock,
  IconLockOpen,
  IconPhone,
  IconReplace,
  IconSearch,
  IconTrash,
} from '@tabler/icons-react';
import axiosClient from '@/api/axiosClient';
import { useUser } from '@/context/UserContext';
import PhoneWarningBanner from '@/components/PhoneWarningBanner.jsx';

/* ---------------- helpers ---------------- */
const fmtLocal = (n) => {
  if (!n) return '';
  const bare = String(n).replace(/[^\d]/g, '');
  if (bare.length === 11 && bare.startsWith('1')) {
    return `(${bare.slice(1, 4)}) ${bare.slice(4, 7)}-${bare.slice(7)}`;
  }
  if (bare.length === 10) {
    return `(${bare.slice(0, 3)}) ${bare.slice(3, 6)}-${bare.slice(6)}`;
  }
  return n;
};

const daysLeft = (expiresAt) => {
  if (!expiresAt) return null;
  const t = new Date(expiresAt).getTime();
  return Math.max(0, Math.ceil((t - Date.now()) / (1000 * 60 * 60 * 24)));
};

/* ---- Country options ---- */
const SUPPORTED_COUNTRY_ISO2 = [
  'US',
  'CA',
  'GB',
  'IE',
  'FR',
  'DE',
  'ES',
  'IT',
  'NL',
  'BE',
  'CH',
  'AT',
  'SE',
  'NO',
  'DK',
  'FI',
  'AU',
  'NZ',
  'JP',
  'KR',
  'SG',
  'HK',
  'IN',
  'PK',
  'BD',
  'ID',
  'PH',
  'TH',
  'VN',
  'MY',
  'BR',
  'MX',
  'AR',
  'CL',
  'CO',
  'PE',
  'ZA',
  'NG',
  'KE',
  'EG',
  'MA',
  'AE',
  'SA',
  'IL',
  'TR',
];

const flagEmoji = (iso2) =>
  iso2
    .toUpperCase()
    .replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));

const COUNTRY_OPTIONS = (() => {
  try {
    const dn = new Intl.DisplayNames(
      [typeof navigator !== 'undefined' ? navigator.language : 'en'],
      { type: 'region' }
    );
    return SUPPORTED_COUNTRY_ISO2.map((cc) => ({
      value: cc,
      label: `${flagEmoji(cc)} ${dn.of(cc) || cc}`,
    }));
  } catch {
    return SUPPORTED_COUNTRY_ISO2.map((cc) => ({
      value: cc,
      label: cc,
    }));
  }
})();

export function NumberPickerModal({ opened, onClose, onAssigned }) {
  const [country, setCountry] = useState('US');
  const [area, setArea] = useState('');
  const [capability, setCapability] = useState('sms');

  const [mode, setMode] = useState('FREE'); // FREE (free pool) | BUY (sellable inventory)
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
      setAssigningId(null);
      setMode('FREE');
      setCountry('US');
    }
  }, [opened]);

  // NANP countries (area code = 3 digits)
  const isNanp = (iso2) => ['US', 'CA'].includes(String(iso2 || '').toUpperCase());

  const validateArea = () => {
    const digits = String(area || '').replace(/[^\d]/g, '');

    // Blank area is allowed (means “random / broad search”)
    if (digits.length === 0) return '';

    // Only enforce 3-digit “area code” for NANP countries
    if (isNanp(country) && digits.length !== 3) {
      setErr('Please enter a 3-digit area code (e.g., 415) or leave blank.');
      return null;
    }

    // Non-NANP: don’t hard-validate here
    return digits;
  };

  /**
   * Search from Chatforia-owned inventory ONLY.
   * - FREE: pulls from your free pool inventory (/numbers/pool?forSale=false)
   * - BUY: pulls from your sellable inventory (/numbers/pool?forSale=true)
   */
  const search = async (modeOverride) => {
    const effectiveMode = modeOverride ?? mode;
    const isBuy = effectiveMode === 'BUY';

    setLoading(true);
    setErr('');
    setResults([]);

    const digits = validateArea();
    if (digits === null) {
      setLoading(false);
      return;
    }

    try {
      const { data } = await axiosClient.get('/numbers/pool', {
        params: {
          country,
          capability,
          limit: digits === '' ? 25 : 15,
          ...(digits === '' ? {} : { areaCode: digits }),
          forSale: isBuy ? true : false,
        },
      });

      const items = Array.isArray(data?.numbers) ? data.numbers : [];

      // Blank area: show ONE random pick (less overwhelming UX)
      if (digits === '') {
        if (!items.length) {
          setErr(isBuy ? 'No available inventory right now.' : 'No free numbers are available right now.');
          setResults([]);
        } else {
          const pick = items[Math.floor(Math.random() * items.length)];
          setResults([pick]);
        }
      } else {
        setResults(items.slice(0, 15));
        if (!items.length) {
          setErr(
            isBuy
              ? 'No available inventory for that area code right now.'
              : 'No free numbers in our pool for that area code right now.'
          );
        }
      }
    } catch (e) {
      setErr(
        e?.response?.data?.error ||
          e?.response?.data?.message ||
          e?.message ||
          'Could not load numbers.'
      );
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Assign from Chatforia-owned inventory ONLY.
   * - FREE: POST /numbers/lease { e164 }
   * - BUY:  POST /numbers/lease { e164, purchaseIntent: true }
   *
   * IMPORTANT: Do NOT call /numbers/reserve or /numbers/claim from the user UI.
   */
  const assign = async (n, modeOverride) => {
    const effectiveMode = modeOverride ?? mode;
    const isBuy = effectiveMode === 'BUY';

    const e164 = n.e164 || n.number;
    if (!e164) return;

    setAssigningId(e164);
    setErr('');

    try {
      await axiosClient.post('/numbers/lease', {
        e164,
        ...(isBuy ? { purchaseIntent: true } : {}),
        lockOnAssign: Boolean(lockOnAssign),
      });

      onAssigned?.({
        type: 'success',
        message: 'Number assigned.',
        e164,
      });
      onClose?.();
    } catch (e) {
      const msg =
        e?.response?.data?.error ||
        e?.response?.data?.message ||
        (isBuy
          ? 'Could not assign that number. It may have just been taken—try another.'
          : 'Could not lease that number. It may have just been taken—try another.');
      setErr(msg);
    } finally {
      setAssigningId(null);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title="Pick a number" size="lg" radius="lg">
      <Stack gap="sm">
        <Group justify="space-between" align="center" wrap="wrap">
          <Group gap="xs">
            <Button
              variant={mode === 'FREE' ? 'filled' : 'light'}
              onClick={() => {
                setMode('FREE');
                setResults([]);
                setErr('');
                setArea('');
                search('FREE');
              }}
            >
              Available number
            </Button>
            <Button
              variant={mode === 'BUY' ? 'filled' : 'light'}
              onClick={() => {
                setMode('BUY');
                setResults([]);
                setErr('');
                search('BUY');
              }}
            >
              Buy a number
            </Button>
          </Group>

          <Text size="sm" c="dimmed">
            {mode === 'FREE'
              ? 'Lease a Chatforia number from the free pool.'
              : 'Choose a number from Chatforia inventory.'}
          </Text>
        </Group>

        <Group align="end" wrap="wrap">
          <Select
            label="Country"
            value={country}
            onChange={(v) => setCountry(v || 'US')}
            data={COUNTRY_OPTIONS?.length ? COUNTRY_OPTIONS : [{ value: 'US', label: '🇺🇸 United States' }]}
            searchable
            nothingFoundMessage="No matches"
            style={{ minWidth: 260 }}
          />
          <TextInput
            label="Area code"
            placeholder="e.g., 415"
            value={area}
            onChange={(e) => setArea(e.currentTarget.value)}
            style={{ minWidth: 160 }}
          />
          <Select
            label="Capability"
            value={capability}
            onChange={(v) => setCapability(v || 'sms')}
            data={[
              { value: 'sms', label: 'SMS' },
              { value: 'voice', label: 'Voice' },
              { value: 'both', label: 'SMS + Voice' },
            ]}
            style={{ minWidth: 180 }}
          />
          <Button onClick={() => search()} leftSection={<IconSearch size={16} />} loading={loading}>
            Search
          </Button>
        </Group>

        <Group gap="sm" align="center">
          <Switch
            checked={lockOnAssign}
            onChange={(e) => setLockOnAssign(e.currentTarget.checked)}
            onLabel={<IconLock size={14} />}
            offLabel={<IconLockOpen size={14} />}
            label="Lock this number (weekly add-on, coming soon)"
          />
          <Text size="sm" c="dimmed">
            Locking will later prevent recycling and charge weekly (pricing TBD).
          </Text>
        </Group>

        {err && (
          <Alert color="red" icon={<IconAlertTriangle size={16} />}>
            {err}
          </Alert>
        )}

        <Divider label="Available numbers" />

        {loading ? (
          <Group justify="center" my="md">
            <Loader />
          </Group>
        ) : results.length === 0 ? (
          <Text c="dimmed" size="sm">
            Enter a 3-digit area code (US/CA only), or leave blank, then search.
          </Text>
        ) : (
          <Stack>
            {results.map((n) => {
              const e164 = n.e164 || n.number;
              const caps =
                Array.isArray(n.capabilities)
                  ? n.capabilities
                  : n.capabilities && typeof n.capabilities === 'object'
                    ? Object.entries(n.capabilities)
                        .filter(([, v]) => Boolean(v))
                        .map(([k]) => k)
                    : [];

              const displayLocal = n.local || n.locality || n.display || e164;

              return (
                <Card key={e164} withBorder radius="md" p="sm">
                  <Group justify="space-between" align="center">
                    <Group>
                      <IconPhone size={18} />
                      <Stack gap={0}>
                        <Text fw={600}>{fmtLocal(displayLocal)}</Text>
                        <Text size="sm" c="dimmed">
                          {e164}
                        </Text>
                      </Stack>
                      <Group gap={6}>
                        {caps.map((c) => (
                          <Badge key={c} variant="light">
                            {String(c).toUpperCase()}
                          </Badge>
                        ))}
                      </Group>
                    </Group>

                    <Button onClick={() => assign(n, mode)} loading={assigningId === e164}>
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

/* ---------------- Main Profile Card ---------------- */
export default function PhoneNumberManager() {
  const { currentUser } = useUser();
  const plan = (currentUser?.plan || 'FREE').toUpperCase();
  const isPremium = plan === 'PREMIUM';

  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [banner, setBanner] = useState(null);
  const [primaryPhone, setPrimaryPhone] = useState(null);
  const ran = useRef(false);

  const normalizeCaps = (caps) => {
    if (!caps) return [];
    if (Array.isArray(caps)) return caps.map((x) => String(x).toLowerCase());

    if (typeof caps === 'object') {
      return Object.entries(caps)
        .filter(([, v]) => !!v)
        .map(([k]) => String(k).toLowerCase());
    }

    if (typeof caps === 'string') {
      return caps
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    }

    return [];
  };

  const reload = () => {
    setLoading(true);
    axiosClient
      .get('/numbers/my')
      .then(({ data }) => {
        const primary = data?.number || null;

        if (!primary) {
          setPrimaryPhone(null);
          setStatus({ state: 'none' });
          return;
        }

        setPrimaryPhone(primary);

        const e164 = primary.e164;
        const capabilities = normalizeCaps(primary.capabilities);
        const expiresAt = primary.releaseAfter || null;
        const d = daysLeft(expiresAt);
        const state =
          primary.status === 'HOLD' || (expiresAt && d !== null && d <= 14) ? 'expiring' : 'active';

        setStatus({
          state,
          e164,
          local: e164,
          display: e164,
          capabilities,
          locked: !!primary.keepLocked,
          expiresAt,
        });
      })
      .catch(() => {
        setPrimaryPhone(null);
        setStatus({ state: 'none' });
        setBanner({ type: 'error', message: 'Unable to load phone number status.' });
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    reload();
  }, []);

  const dLeft = useMemo(() => daysLeft(status?.expiresAt), [status]);

  const keepCurrentNumber = async () => {
    if (!['active', 'expiring'].includes(status?.state)) {
      setBanner({ type: 'info', message: 'Assign a number first.' });
      return;
    }

    if (!isPremium) {
      setBanner({
        type: 'warning',
        message: 'Keeping your number is a Premium feature.',
        action: { label: 'Upgrade', href: '/settings/upgrade' },
      });
      return;
    }

    setBanner(null);
    try {
      await axiosClient.post('/numbers/buy/keep-current');
      setBanner({ type: 'success', message: 'Your number is now protected.' });
      reload();
    } catch (e) {
      setBanner({
        type: 'error',
        message: e?.response?.data?.error || 'Could not protect your number right now.',
      });
    }
  };

  const lock = () => {
    if (!['active', 'expiring'].includes(status?.state)) {
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

    axiosClient
      .post('/numbers/keep/enable')
      .then(() => {
        setBanner({ type: 'success', message: 'Number protected.' });
        reload();
      })
      .catch(() => {
        setBanner({ type: 'error', message: 'Could not protect the number.' });
      });
  };

  const unlock = () => {
    axiosClient
      .post('/numbers/keep/disable')
      .then(() => {
        setBanner({ type: 'success', message: 'Number unprotected.' });
        reload();
      })
      .catch(() => {
        setBanner({ type: 'error', message: 'Could not unprotect the number.' });
      });
  };

  const releaseNumber = () => {
    if (!window.confirm('Release your current number? It may be assigned to someone else.')) return;

    axiosClient
      .post('/numbers/release')
      .then(() => {
        setBanner({ type: 'warning', message: 'Number released.' });
        reload();
      })
      .catch(() => {
        setBanner({ type: 'error', message: 'Could not release the number.' });
      });
  };

  const headerBadge = () => {
    if (loading) return null;

    if (status?.state === 'active') {
      return (
        <Badge color="green" variant="light" leftSection={<IconCircleCheck size={14} />}>
          Active
        </Badge>
      );
    }

    if (status?.state === 'expiring') {
      return (
        <Tooltip label={`Expires in ${dLeft} day${dLeft === 1 ? '' : 's'}`}>
          <Badge color="yellow" variant="light" leftSection={<IconAlertTriangle size={14} />}>
            {`Expiring${dLeft != null ? ` (${dLeft}d)` : ''}`}
          </Badge>
        </Tooltip>
      );
    }

    return <Badge variant="outline">No number</Badge>;
  };

  const bannerColor =
    banner?.type === 'error'
      ? 'red'
      : banner?.type === 'warning'
        ? 'yellow'
        : banner?.type === 'success'
          ? 'green'
          : 'blue';

  return (
    <>
      <Card withBorder radius="lg" p="lg">
        {primaryPhone && <PhoneWarningBanner phone={primaryPhone} onReactivate={reload} />}

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
            <Title order={4} m={0}>
              Phone number
            </Title>
            {headerBadge()}
          </Group>

          <Group gap="xs">
            {status?.locked ? (
              <Button variant="light" leftSection={<IconLockOpen size={16} />} onClick={unlock}>
                Unprotect
              </Button>
            ) : (
              <Tooltip
                label={
                  !['active', 'expiring'].includes(status?.state)
                    ? 'Assign a number first'
                    : !isPremium
                      ? 'Premium feature'
                      : 'Protect your number'
                }
              >
                <Button
                  variant="light"
                  leftSection={<IconLock size={16} />}
                  onClick={keepCurrentNumber}
                  disabled={!['active', 'expiring'].includes(status?.state)}
                >
                  Keep this number
                </Button>
              </Tooltip>
            )}

            {['active', 'expiring'].includes(status?.state) ? (
              <>
                <Button
                  color="orange"
                  variant="light"
                  leftSection={<IconReplace size={16} />}
                  onClick={() => setPickerOpen(true)}
                >
                  Replace
                </Button>
                <Button
                  color="red"
                  variant="light"
                  leftSection={<IconTrash size={16} />}
                  onClick={releaseNumber}
                >
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
          ) : ['active', 'expiring'].includes(status?.state) ? (
            <>
              <Text fw={600} size="lg">
                {fmtLocal(status.local || status.display || status.e164)}
              </Text>
              <Text size="sm" c="dimmed">
                {status.e164}
              </Text>

              <Group gap="xs" mt="xs">
                {status.capabilities?.includes('sms') && <Badge variant="outline">SMS</Badge>}
                {status.capabilities?.includes('voice') && <Badge variant="outline">VOICE</Badge>}
                {status.locked ? (
                  <Badge leftSection={<IconLock size={12} />}>Protected</Badge>
                ) : (
                  <Badge>Not protected</Badge>
                )}
                {status.expiresAt && (
                  <Badge color={status.state === 'expiring' ? 'yellow' : 'gray'} variant="light">
                    {status.state === 'expiring'
                      ? `Expires in ${dLeft}d`
                      : `Renews ${new Date(status.expiresAt).toLocaleDateString()}`}
                  </Badge>
                )}
              </Group>
            </>
          ) : (
            <Text c="dimmed">
              You don’t have a Chatforia number yet. Pick one by area code to start texting and calling.
            </Text>
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
