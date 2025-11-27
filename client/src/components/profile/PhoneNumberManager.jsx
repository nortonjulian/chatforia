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

/* ---- Country options (many countries; auto-localized at runtime) ---- */
const SUPPORTED_COUNTRY_ISO2 = [
  'US','CA','GB','AU','AR','AT','BE','BG','BR','CH','CL','CO','CR','CY','CZ','DE','DK','DO','DZ',
  'EC','EE','EG','ES','FI','FR','GE','GH','GR','GT','HK','HN','HR','HU','ID','IE','IL','IN','IS',
  'IT','JM','JO','JP','KE','KW','KZ','LB','LT','LU','LV','MA','MT','MX','MY','NG','NI','NL','NO',
  'NZ','OM','PA','PE','PH','PK','PL','PT','PY','QA','RO','RS','RU','SA','SE','SG','SI','SK','SV',
  'TH','TN','TR','TW','UA','AE','UY','VN','ZA','KR'
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
    // Fallback: English-ish labels without localization
    return SUPPORTED_COUNTRY_ISO2.map((cc) => ({
      value: cc,
      label: cc,
    }));
  }
})();

/* ---------------- Number Picker (modal) ---------------- */
function NumberPickerModal({ opened, onClose, onAssigned }) {
  const [country, setCountry] = useState('US');
  const [area, setArea] = useState('');
  const [capability, setCapability] = useState('sms'); // sms | voice | both (currently informational)
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
    }
  }, [opened]);

  const search = () => {
    setLoading(true);
    setErr('');
    setResults([]);

    const digits = (area || '').replace(/\D/g, '');

    if (digits.length !== 3) {
      setLoading(false);
      setErr('Please enter a 3-digit area code (e.g., 415).');
      return;
    }

    axiosClient
      .get('/numbers/available', {
        params: {
          country,
          areaCode: digits,
          type: 'local',
          limit: 15,
        },
      })
      .then(({ data }) => {
        const items = Array.isArray(data?.numbers) ? data.numbers : [];
        setResults(items.slice(0, 15));
        if (!items.length) {
          setErr('No numbers found for that area code. Try a nearby one.');
        }
      })
      .catch(() => {
        setErr(
          'Could not load available numbers. Try a nearby area code or a different country.'
        );
        setResults([]);
      })
      .finally(() => {
        setLoading(false);
      });
  };

  const assign = (n) => {
    const e164 = n.e164 || n.number;
    if (!e164) return;

    setAssigningId(e164);
    setErr('');

    // Reserve best-effort, then claim/purchase
    axiosClient
      .post('/numbers/reserve', { e164 })
      .catch(() => {
        // soft-fail ok; claim will still attempt purchase
      })
      .then(() =>
        axiosClient.post('/numbers/claim', {
          e164,
          // future: send keepLocked flag if you want to use lockOnAssign
        })
      )
      .then(() => {
        onAssigned?.({
          type: 'success',
          message: 'Number assigned.',
        });
        onClose();
      })
      .catch(() => {
        setErr(
          'Could not assign that number. It may have just been taken—try another.'
        );
      })
      .finally(() => {
        setAssigningId(null);
      });
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Pick a number"
      size="lg"
      radius="lg"
    >
      <Stack gap="sm">
        <Group align="end" wrap="wrap">
          <Select
            label="Country"
            value={country}
            onChange={setCountry}
            data={COUNTRY_OPTIONS}
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
            onChange={setCapability}
            data={[
              { value: 'sms', label: 'SMS' },
              { value: 'voice', label: 'Voice' },
              {
                value: 'both',
                label: 'SMS + Voice',
              },
            ]}
            style={{ minWidth: 180 }}
          />
          <Button
            onClick={search}
            leftSection={<IconSearch size={16} />}
            loading={loading}
          >
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
          <Text size="sm" c="dimmed">
            Prevents recycling while your plan is active (feature wiring TBD).
          </Text>
        </Group>

        {err ? (
          <Alert color="red" icon={<IconAlertTriangle size={16} />}>
            {err}
          </Alert>
        ) : null}

        <Divider label="Available numbers" />

        {loading ? (
          <Group justify="center" my="md">
            <Loader />
          </Group>
        ) : results.length === 0 ? (
          <Text c="dimmed" size="sm">
            Enter a country &amp; 3-digit area code, then search.
          </Text>
        ) : (
          <Stack>
            {results.map((n) => {
              const e164 = n.e164 || n.number;
              const caps = n.capabilities || n.caps || [];
              const displayLocal =
                n.local ||
                n.locality ||
                n.display ||
                e164;

              return (
                <Card key={e164} withBorder radius="md" p="sm">
                  <Group justify="space-between" align="center">
                    <Group>
                      <IconPhone size={18} />
                      <Stack gap={0}>
                        <Text fw={600}>
                          {fmtLocal(displayLocal)}
                        </Text>
                        <Text size="sm" c="dimmed">
                          {e164}
                        </Text>
                      </Stack>
                      <Group gap={6}>
                        {Array.isArray(caps) &&
                          caps.map((c) => (
                            <Badge key={c} variant="light">
                              {String(c).toUpperCase()}
                            </Badge>
                          ))}

                        {n.price ? (
                          <Badge variant="outline">
                            ${n.price}/mo
                          </Badge>
                        ) : null}
                      </Group>
                    </Group>

                    <Button
                      onClick={() => assign(n)}
                      loading={assigningId === e164}
                    >
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

  const [banner, setBanner] = useState(null); // { type, message, action? }
  const ran = useRef(false);

  const reload = () => {
    setLoading(true);
    axiosClient
      .get('/numbers/my')
      .then(({ data }) => {
        const num = data?.number || null;

        if (!num) {
          setStatus({ state: 'none' });
          return;
        }

        const e164 = num.e164;
        const capabilities =
          num.capabilities && Array.isArray(num.capabilities)
            ? num.capabilities
            : ['sms', 'voice'];

        const expiresAt = num.releaseAfter || null;
        const d = daysLeft(expiresAt);
        const state =
          expiresAt && d !== null && d <= 14 ? 'expiring' : 'active';

        setStatus({
          state,
          e164,
          local: e164,
          display: e164,
          capabilities,
          locked: !!num.keepLocked,
          expiresAt,
        });
      })
      .catch(() => {
        setStatus({ state: 'none' });
        setBanner({
          type: 'error',
          message: 'Unable to load phone number status.',
        });
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dLeft = useMemo(() => daysLeft(status?.expiresAt), [status]);

  const lock = () => {
    const hasNumber = status?.state === 'active' || status?.state === 'expiring';
    if (!hasNumber) {
      setBanner({
        type: 'info',
        message: 'Assign a number first.',
      });
      return;
    }
    if (!isPremium) {
      setBanner({
        type: 'warning',
        message: 'Locking numbers is a Premium feature.',
        action: {
          label: 'Upgrade',
          href: '/settings/upgrade',
        },
      });
      return;
    }

    axiosClient
      .post('/numbers/keep/enable')
      .then(() => {
        setBanner({
          type: 'success',
          message: 'Number locked.',
        });
        reload();
      })
      .catch((e) => {
        if (
          e?.response?.status === 402 ||
          e?.response?.data?.reason === 'premium_required'
        ) {
          setBanner({
            type: 'warning',
            message: 'Locking numbers is a Premium feature.',
            action: {
              label: 'Upgrade',
              href: '/settings/upgrade',
            },
          });
        } else {
          setBanner({
            type: 'error',
            message: 'Could not lock the number.',
          });
        }
      });
  };

  const unlock = () => {
    axiosClient
      .post('/numbers/keep/disable')
      .then(() => {
        setBanner({
          type: 'success',
          message: 'Number unlocked.',
        });
        reload();
      })
      .catch(() => {
        setBanner({
          type: 'error',
          message: 'Could not unlock the number.',
        });
      });
  };

  const releaseNumber = () => {
    if (
      !window.confirm(
        'Release your current number? It may be assigned to someone else.'
      )
    )
      return;

    axiosClient
      .post('/numbers/release')
      .then(() => {
        setBanner({
          type: 'warning',
          message: 'Number released.',
        });
        reload();
      })
      .catch(() => {
        setBanner({
          type: 'error',
          message: 'Could not release the number.',
        });
      });
  };

  const headerBadge = () => {
    if (loading) return null;

    if (status?.state === 'active') {
      return (
        <Badge
          aria-label="badge-active"
          color="green"
          variant="light"
          leftSection={<IconCircleCheck size={14} />}
        >
          Active
        </Badge>
      );
    }

    if (status?.state === 'expiring') {
      return (
        <Tooltip label={`Expires in ${dLeft} day${dLeft === 1 ? '' : 's'}`}>
          <Badge
            aria-label="badge-expiring"
            color="yellow"
            variant="light"
            leftSection={<IconAlertTriangle size={14} />}
          >
            {`Expiring${dLeft != null ? ` (${dLeft}d)` : ''}`}
          </Badge>
        </Tooltip>
      );
    }

    return (
      <Badge aria-label="badge-none" variant="outline">
        No number
      </Badge>
    );
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
        {banner?.message && (
          <Alert
            color={bannerColor}
            withCloseButton
            onClose={() => setBanner(null)}
            mb="sm"
          >
            <Group justify="space-between" align="center" wrap="nowrap">
              <Text>{banner.message}</Text>
              {banner?.action && (
                <Button
                  component={Link}
                  to={banner.action.href}
                  size="xs"
                  radius="xl"
                >
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
              <Button
                variant="light"
                leftSection={<IconLockOpen size={16} />}
                onClick={unlock}
              >
                Unlock
              </Button>
            ) : (
              <Tooltip
                label={
                  status?.state !== 'active' && status?.state !== 'expiring'
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
                  disabled={status?.state !== 'active' && status?.state !== 'expiring'}
                >
                  Lock
                </Button>
              </Tooltip>
            )}

            {status?.state === 'active' || status?.state === 'expiring' ? (
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
              <Button onClick={() => setPickerOpen(true)}>
                Pick a number
              </Button>
            )}
          </Group>
        </Group>

        <Divider my="sm" />

        <Stack gap={4}>
          {loading ? (
            <Text c="dimmed">Loading…</Text>
          ) : status?.state === 'active' || status?.state === 'expiring' ? (
            <>
              <Text fw={600} size="lg">
                {fmtLocal(status.local || status.display || status.e164)}
              </Text>
              <Text size="sm" c="dimmed">
                {status.e164}
              </Text>

              <Group gap="xs" mt="xs">
                {status.capabilities?.includes('sms') && (
                  <Badge variant="outline">SMS</Badge>
                )}
                {status.capabilities?.includes('voice') && (
                  <Badge variant="outline">VOICE</Badge>
                )}

                {status.locked ? (
                  <Badge leftSection={<IconLock size={12} />}>Locked</Badge>
                ) : (
                  <Badge>Not locked</Badge>
                )}

                {status.expiresAt ? (
                  <Badge
                    color={status.state === 'expiring' ? 'yellow' : 'gray'}
                    variant="light"
                  >
                    {status.state === 'expiring'
                      ? `Expires in ${dLeft}d`
                      : `Renews ${new Date(status.expiresAt).toLocaleDateString()}`}
                  </Badge>
                ) : null}
              </Group>
            </>
          ) : (
            <Text c="dimmed">
              You don’t have a Chatforia number yet. Pick one by area code to start
              texting and calling.
            </Text>
          )}
        </Stack>
      </Card>

      <NumberPickerModal
        opened={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onAssigned={(msg) => {
          setBanner(
            msg || {
              type: 'success',
              message: 'Number assigned.',
            }
          );
          setPickerOpen(false);
          reload();
        }}
      />
    </>
  );
}
