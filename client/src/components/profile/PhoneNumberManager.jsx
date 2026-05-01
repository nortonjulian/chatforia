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
import { useNavigate } from 'react-router-dom';
import PhoneWarningBanner from '@/components/PhoneWarningBanner.jsx';
import { useTranslation } from 'react-i18next';
import posthog from '@/utils/analytics';

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
  const { currentUser } = useUser();
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [mode, setMode] = useState('FREE'); 
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
      setErr(t('phoneNumberManager.invalidAreaCode',
        'Please enter a 3-digit area code (e.g., 415) or leave blank.'
      ));
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
    const isBuy = effectiveMode === 'PREMIUM';

    setLoading(true);
    setErr('');
    setResults([]);

    const digits = validateArea();
    if (digits === null) {
      setLoading(false);
      return;
    }

    posthog.capture('number_search_started', {
      mode: effectiveMode,
      country,
      capability,
      had_area_code: Boolean(digits),
    });

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

      posthog.capture('number_search_results', {
        mode: effectiveMode,
        result_count: items.length,
        country,
        capability,
        had_area_code: Boolean(digits),
      });

      if (digits === '') {
        if (!items.length) {
          posthog.capture('number_search_empty', {
            mode: effectiveMode,
            country,
            capability,
            had_area_code: Boolean(digits),
          });

          setErr(
            isBuy
              ? t('phoneNumberManager.noInventory', 'No available inventory right now.')
              : t('phoneNumberManager.noFreeNumbers', 'No free numbers are available right now.')
          );
          setResults([]);
        } else {
          setResults(items.slice(0, 25));
        }
      } else {
        setResults(items.slice(0, 15));
        if (!items.length) {
          posthog.capture('number_search_empty', {
            mode: effectiveMode,
            country,
            capability,
            had_area_code: Boolean(digits),
          });

          setErr(
            isBuy
              ? t('phoneNumberManager.noInventoryAreaCode', 'No available inventory for that area code right now.')
              : t('phoneNumberManager.noFreeNumbersAreaCode', 'No free numbers in our pool for that area code right now.')
          );
        }
      }
    } catch (e) {
      const errorMsg =
        e?.response?.data?.error ||
        e?.response?.data?.message ||
        e?.message ||
        t('phoneNumberManager.couldNotLoadNumbers', 'Could not load numbers.');

      posthog.capture('number_search_failed', {
        mode: effectiveMode,
        country,
        capability,
        had_area_code: Boolean(digits),
        error: errorMsg,
      });

      setErr(errorMsg);
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
    const isBuy = effectiveMode === 'PREMIUM';

    const e164 = n.e164 || n.number;
    if (!e164) return;

    const hadAreaCode = Boolean(String(area || '').trim());

    posthog.capture('number_selection_attempted', {
      type: isBuy ? 'premium' : 'free',
      country,
      capability,
      had_area_code: hadAreaCode,
    });

    if (isBuy && currentUser?.plan !== 'PREMIUM') {
      posthog.capture('upgrade_redirected_from_number', {
        reason: 'premium_required',
        source: 'number_selection',
        country,
        capability,
        had_area_code: hadAreaCode,
      });

      navigate('/settings/upgrade', {
        state: { from: 'keep-number' },
      });
      return;
    }

    setAssigningId(e164);
    setErr('');

    try {
      await axiosClient.post('/numbers/lease', {
        e164,
        ...(isBuy ? { purchaseIntent: true } : {}),
        lockOnAssign: Boolean(lockOnAssign),
      });

      posthog.capture('number_assigned', {
        type: isBuy ? 'premium' : 'free',
        country,
        capability,
        had_area_code: hadAreaCode,
      });

      onAssigned?.({
        type: 'success',
        message: t('phoneNumberManager.numberAssigned', 'Number assigned.'),
        e164,
      });
      onClose?.();
    } catch (e) {
      const msg =
        e?.response?.data?.error ||
        e?.response?.data?.message ||
        (isBuy
          ? t('phoneNumberManager.couldNotAssign', 'Could not assign that number. It may have just been taken—try another.')
          : t('phoneNumberManager.couldNotLease', 'Could not lease that number. It may have just been taken—try another.'));

        posthog.capture('number_selection_failed', {
          type: isBuy ? 'premium' : 'free',
          error: msg,
          country,
          capability,
          had_area_code: hadAreaCode,
        });
        
        if (msg?.toLowerCase().includes('premium')) {
          navigate('/settings/upgrade', {
            state: { from: 'keep-number' },
          });
          return;
        }
      setErr(msg);
    } finally {
      setAssigningId(null);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title={t('phoneNumberManager.pickNumber', 'Pick a number')}>
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
              {t('phoneNumberManager.availableNumber', 'Available number')}
            </Button>
            <Button
              variant={mode === 'PREMIUM' ? 'filled' : 'light'}
              onClick={() => {
                setMode('PREMIUM');

                posthog.capture('premium_number_mode_selected', {
                  country,
                  previous_mode: mode,
                  had_area_code: Boolean(area),
                });

                setResults([]);
                setErr('');
                search('PREMIUM');
              }}
            >
              {t('phoneNumberManager.premiumNumber', 'Premium number 🔒')}
            </Button>
          </Group>

          <Text size="sm" c="dimmed">
            {mode === 'FREE'
              ? t('phoneNumberManager.freeNumberHint', 'Free number that may be recycled after inactivity.')
              : t('phoneNumberManager.premiumNumberHint', 'Keep your number while your Premium subscription is active.')}
          </Text>
        </Group>

        <Group align="end" wrap="wrap">
          <Select
            label={t('phoneNumberManager.country', 'Country')}
            value={country}
            onChange={(v) => setCountry(v || 'US')}
            data={COUNTRY_OPTIONS?.length ? COUNTRY_OPTIONS : [{ value: 'US', label: '🇺🇸 United States' }]}
            searchable
            nothingFoundMessage={t('common.noMatches', 'No matches')}
            style={{ minWidth: 260 }}
          />
          <TextInput
            label={t('phoneNumberManager.areaCode', 'Area code')}
            placeholder={t('phoneNumberManager.areaCodePlaceholder', 'e.g., 415')}
            value={area}
            onChange={(e) => setArea(e.currentTarget.value)}
            style={{ minWidth: 160 }}
          />
          <Select
            label={t('phoneNumberManager.capability', 'Capability')}
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
            {t('phoneNumberManager.search', 'Search')}
          </Button>
        </Group>

        <Group gap="sm" align="center">
          <Switch
            checked={lockOnAssign}
            onChange={(e) => setLockOnAssign(e.currentTarget.checked)}
            onLabel={<IconLock size={14} />}
            offLabel={<IconLockOpen size={14} />}
            label={t(
              'phoneNumberManager.lockThisNumber',
              'Lock this number (weekly add-on, coming soon)'
            )}
          />
          <Text size="sm" c="dimmed">
            {t(
              'phoneNumberManager.premiumProtectedHint',
              'Premium numbers are protected from recycling while your Premium subscription is active.'
            )}
          </Text>
        </Group>

        {err && (
          <Alert color="red" icon={<IconAlertTriangle size={16} />}>
            {err}
          </Alert>
        )}

        <Divider label={t('phoneNumberManager.availableNumbers', 'Available numbers')} />

        {loading ? (
          <Group justify="center" my="md">
            <Loader />
          </Group>
        ) : results.length === 0 ? (
          <Text c="dimmed" size="sm">
            {t(
              'phoneNumberManager.searchHint',
              'Enter a 3-digit area code (US/CA only), or leave blank, then search.'
            )}
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

              const baseLocation =
                n.locality ||
                n.city ||
                n.friendlyName ||
                n.location ||
                '';

              const locationLabel =
                baseLocation && !baseLocation.includes(',')
                  ? [baseLocation, n.region].filter(Boolean).join(', ')
                  : baseLocation;

              return (
                <Card key={e164} withBorder radius="md" p="sm">
                  <Group justify="space-between" align="center">
                    <Group>
                      <IconPhone size={18} />
                      <Stack gap={0}>
                        <Text fw={600}>{fmtLocal(e164)}</Text>

                        {locationLabel && (
                          <Text size="sm" c="dimmed">
                            {locationLabel}
                          </Text>
                        )}

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
                      {mode === 'PREMIUM' ? 'Keep' : 'Select'}
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
  const { t } = useTranslation();
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
        const expiresAt = primary.releaseAfter || primary.holdUntil || null;
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
        setBanner({
          type: 'error',
          message: t('phoneNumberManager.unableToLoadStatus', 'Unable to load phone number status.'),
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
  }, []);

  const dLeft = useMemo(() => daysLeft(status?.expiresAt), [status]);

  const keepCurrentNumber = async () => {
    posthog.capture('number_keep_attempted', {
      is_premium: isPremium,
      current_state: status?.state || 'unknown',
    });

    if (!['active', 'expiring'].includes(status?.state)) {
      setBanner({
        type: 'info',
        message: t('phoneNumberManager.assignNumberFirst', 'Assign a number first.'),
      });
      return;
    }

    if (!isPremium) {
      // 🔥 TRACK PAYWALL HIT (this is the key moment)
      posthog.capture('upgrade_prompted_from_keep_number', {
        source: 'keep_current_number',
        current_state: status?.state || 'unknown',
      });

      setBanner({
        type: 'warning',
        message: t('phoneNumberManager.premiumKeepFeature', 'Keeping your number is a Premium feature.'),
        action: {
          label: t('upgrade.title', 'Upgrade'),
          href: '/settings/upgrade',
        },
      });
      return;
    }

    setBanner(null);
    try {
      await axiosClient.post('/numbers/buy/keep-current');
      setBanner({
        type: 'success',
        message: t('phoneNumberManager.numberProtectedNow', 'Your number is now protected.'),
      });

      posthog.capture('number_keep_success');

      reload();
    } catch (e) {
      setBanner({
        type: 'error',
        message:
          e?.response?.data?.error ||
          t('phoneNumberManager.couldNotProtectNow', 'Could not protect your number right now.'),
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
        message: t('phoneNumberManager.lockingPremiumFeature', 'Locking numbers is a Premium feature.'),
        action: {
          label: t('upgrade.title', 'Upgrade'),
          href: '/settings/upgrade',
        },
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
        setBanner({
          type: 'success',
          message: t('phoneNumberManager.numberProtected', 'Number protected.'),
        });
        reload();
      })
      .catch(() => {
        setBanner({
          type: 'error',
          message: t('phoneNumberManager.couldNotProtect', 'Could not protect the number.'),
        });
      });
  };

  const releaseNumber = () => {
    if (
      !window.confirm(
        t(
          'phoneNumberManager.releaseConfirm',
          'Release your current number? It may be assigned to someone else.'
        )
      )
    )
      return;
      
    axiosClient
      .post('/numbers/release')
      .then(() => {
        setBanner({
          type: 'warning',
          message: t('phoneNumberManager.numberReleased', 'Number released.'),
        });
        reload();
      })
      .catch(() => {
        setBanner({
          type: 'error',
          message: t('phoneNumberManager.couldNotRelease', 'Could not release the number.'),
        });
      });
  };

  const headerBadge = () => {
    if (loading) return null;

    if (status?.state === 'active') {
      return (
        <Badge color="green" variant="light" leftSection={<IconCircleCheck size={14} />}>
          {t('phoneNumberManager.active', 'Active')}
        </Badge>
      );
    }

    if (status?.state === 'expiring') {
      return (
        <Tooltip
          label={t('phoneNumberManager.expiresInDaysFull', 'Expires in {{count}} day', {
            count: dLeft,
          })}
        >
          <Badge color="yellow" variant="light" leftSection={<IconAlertTriangle size={14} />}>
            {t('phoneNumberManager.expiringShort', 'Expiring{{suffix}}', {
              suffix: dLeft != null ? ` (${dLeft}d)` : '',
            })}
          </Badge>
        </Tooltip>
      );
    }

    return <Badge variant="outline">{t('phoneNumberManager.noNumber', 'No number')}</Badge>;
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
              {t('phoneNumberManager.phoneNumber', 'Phone number')}
            </Title>
            {headerBadge()}
          </Group>

          <Group gap="xs">
            {status?.locked ? (
              <Button variant="light" leftSection={<IconLockOpen size={16} />} onClick={unlock}>
                {t('phoneNumberManager.unprotect', 'Unprotect')}
              </Button>
            ) : (
              <Tooltip
                label={
                  !['active', 'expiring'].includes(status?.state)
                    ? t('phoneNumberManager.assignNumberFirst', 'Assign a number first')
                    : !isPremium
                      ? t('phoneNumberManager.premiumFeature', 'Premium feature')
                      : t('phoneNumberManager.protectYourNumber', 'Protect your number')
                }
              >
                <Button
                  variant="light"
                  leftSection={<IconLock size={16} />}
                  onClick={keepCurrentNumber}
                  disabled={!['active', 'expiring'].includes(status?.state)}
                >
                  {t('phoneNumberManager.keepThisNumber', 'Keep this number')}
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
                  {t('phoneNumberManager.replace', 'Replace')}
                </Button>
                <Button
                  color="red"
                  variant="light"
                  leftSection={<IconTrash size={16} />}
                  onClick={releaseNumber}
                >
                  {t('phoneNumberManager.release', 'Release')}
                </Button>
              </>
            ) : (
              <Button onClick={() => setPickerOpen(true)}>{t('phoneNumberManager.pickNumber', 'Pick a number')}</Button>
            )}
          </Group>
        </Group>

        <Divider my="sm" />

        <Stack gap={4}>
          {loading ? (
            <Text c="dimmed">{t('common.loading', 'Loading…')}</Text>
          ) : ['active', 'expiring'].includes(status?.state) ? (
            <>
              <Text fw={600} size="lg">
                {fmtLocal(status.local || status.display || status.e164)}
              </Text>
              <Text size="sm" c="dimmed">
                {status.e164}
              </Text>

              {status?.state === 'expiring' && dLeft != null && (
                <Alert color="yellow" icon={<IconAlertTriangle size={16} />}>
                  Your number may be released in {dLeft} day{dLeft === 1 ? '' : 's'}. {t(
                  'phoneNumberManager.releaseWarning',
                  'Your number may be released in {{count}} day. Upgrade to Premium to keep it protected.',
                  { count: dLeft }
                )}
                </Alert>
              )}

              <Group gap="xs" mt="xs">
                {status.capabilities?.includes('sms') && <Badge variant="outline">SMS</Badge>}
                {status.capabilities?.includes('voice') && <Badge variant="outline">VOICE</Badge>}
                {status.locked ? (
                  <Badge leftSection={<IconLock size={12} />}>{t('phoneNumberManager.protected', 'Protected')}</Badge>
                ) : (
                  <Badge>{t('phoneNumberManager.notProtected', 'Not protected')}</Badge>
                )}
                {status.expiresAt && (
                  <Badge color={status.state === 'expiring' ? 'yellow' : 'gray'} variant="light">
                    {status.state === 'expiring'
                      ? t('phoneNumberManager.expiresInShort', 'Expires in {{count}}d', { count: dLeft })
                      : t('phoneNumberManager.renewsOn', 'Renews {{date}}', {
                          date: new Date(status.expiresAt).toLocaleDateString(),
                    })}
                  </Badge>
                )}
              </Group>
            </>
          ) : (
            <Text c="dimmed">
              {t('phoneNumberManager.pickNumberHint', 'Pick a Chatforia number to use for messaging and communication inside the app.')}
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
              message: t('phoneNumberManager.numberAssigned', 'Number assigned.'),
            }
          );
          setPickerOpen(false);
          reload();
        }}
      />
    </>
  );
}
