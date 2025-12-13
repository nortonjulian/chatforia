import { useEffect, useMemo, useState } from 'react';
import {
  Card,
  Title,
  Text,
  Button,
  Group,
  Stack,
  Badge,
  Alert,
  SimpleGrid,
  SegmentedControl,
  Box,
  Divider,
  Table,
  Accordion,
} from '@mantine/core';
import axiosClient from '../api/axiosClient';
import { useUser } from '../context/UserContext';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

// Icons
import { MessageSquare, Ban, Star, Wallet, CircleDollarSign } from 'lucide-react';

// region-aware pricing quotes
import { getPricingQuote } from '@/api/pricing';

/* ---------------- constants ---------------- */

const SECTION_APP = 'app';
const SECTION_MOBILE = 'mobile';
const SECTION_FAMILY = 'family';

// Hidden for now — flip to true later when reseller/wholesale makes it sane.
const ENABLE_FAMILY_SECTION = false;

// eSIM scopes
const ESIM_SCOPE_LOCAL = 'local';
const ESIM_SCOPE_EUROPE = 'europe';
const ESIM_SCOPE_GLOBAL = 'global';

/* ---------------- helpers ---------------- */
function countryNameFromCode(code, locale) {
  const cc = String(code || '').toUpperCase();
  if (!cc || cc.length !== 2) return null;

  try {
    // Browser-supported in modern Chrome/Safari/Firefox
    const dn = new Intl.DisplayNames([locale || undefined], { type: 'region' });
    return dn.of(cc) || null;
  } catch {
    return null;
  }
}

function formatMoney(amountMinor, currency = 'USD', locale) {
  const ZERO_DECIMAL = new Set([
    'BIF',
    'CLP',
    'DJF',
    'GNF',
    'JPY',
    'KMF',
    'KRW',
    'PYG',
    'RWF',
    'UGX',
    'VND',
    'VUV',
    'XAF',
    'XOF',
    'XPF',
  ]);
  const THREE_DECIMAL = new Set(['BHD', 'JOD', 'KWD', 'OMR', 'TND']);
  const c = String(currency || 'USD').toUpperCase();

  let divisor = 100;
  let fractionDigits = 2;

  if (ZERO_DECIMAL.has(c)) {
    divisor = 1;
    fractionDigits = 0;
  } else if (THREE_DECIMAL.has(c)) {
    divisor = 1000;
    fractionDigits = 3;
  }

  const major = amountMinor / divisor;

  const nf = new Intl.NumberFormat(locale || undefined, {
    style: 'currency',
    currency: c,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });

  return nf.format(major);
}

/* ---------------- components ---------------- */

export function PlanCard({
  title,
  price,
  description,
  features = [],
  cta,
  onClick,
  highlight = false,
  disabled = false,
  loading = false,
  badge,
  badgeColor = 'gray',
  icon,
  testId,
  tint = false, // whether to apply a color tint
  tintColor, // theme decides; no default
  ariaLabel,
  footer,
}) {
  const { t } = useTranslation();

  // Build classes purely from props; no auth/theme coupling
  const classNames = ['plan-card'];
  if (highlight) classNames.push('plan-card--highlight');
  if (tint && tintColor) classNames.push(`plan-card--highlight-${tintColor}`);
  const cardClassName = classNames.join(' ');

  return (
    <Card
      withBorder
      radius="xl"
      shadow="sm"
      p="lg"
      data-testid={testId}
      className={cardClassName}
      style={{ height: '100%' }}
    >
      <Stack gap="xs" style={{ height: '100%', display: 'flex' }}>
        <Group justify="space-between" align="center">
          <Group gap={8}>
            {icon}
            <Title order={3}>{title}</Title>
          </Group>
          {badge && <Badge color={badgeColor}>{badge}</Badge>}
        </Group>

        {description && (
          <Text size="sm" c="dimmed">
            {description}
          </Text>
        )}

        <Stack
          gap={4}
          component="ul"
          className="plan-card-features"
          style={{ margin: 0, paddingLeft: '1.2rem' }}
        >
          {features.map((f) => (
            <li key={f}>
              <Text size="sm" component="span">
                {f}
              </Text>
            </li>
          ))}
        </Stack>

        <Box style={{ flex: 1 }} />

        <Button
          mt="sm"
          onClick={onClick}
          disabled={disabled || loading}
          loading={loading}
          aria-busy={loading ? 'true' : 'false'}
          aria-label={ariaLabel || t('upgrade.cta.aria', 'Select plan')}
          fullWidth
        >
          {cta}
        </Button>

        {footer}
      </Stack>
    </Card>
  );
}

function WhyChatforiaSection() {
  const { t } = useTranslation();

  return (
    <Stack gap="md" mt="xl">
      <Divider my="sm" />

      <Title order={2}>
        {t('upgrade.why.title', 'Why people switch to Chatforia')}
      </Title>

      <Text size="sm" c="dimmed">
        {t(
          'upgrade.why.subtitle',
          'Chatforia gives you a real phone number, smart translation, and a clear path to go ad-free when you’re ready.'
        )}
      </Text>

      <SimpleGrid cols={{ base: 1, md: 3 }} spacing="md">
        <Card withBorder radius="lg" p="md">
          <Text fw={600} size="sm">
            {t('upgrade.why.card.textnow.title', 'Chatforia vs TextNow')}
          </Text>
          <Text size="xs" c="dimmed" mt={4}>
            {t(
              'upgrade.why.card.textnow.body',
              'Lighter ads on Free, a simple Plus upgrade when you’re ready, and Premium tools TextNow doesn’t offer.'
            )}
          </Text>
        </Card>

        <Card withBorder radius="lg" p="md">
          <Text fw={600} size="sm">
            {t('upgrade.why.card.voice.title', 'Chatforia vs Google Voice')}
          </Text>
          <Text size="xs" c="dimmed" mt={4}>
            {t(
              'upgrade.why.card.voice.body',
              'Modern app, global-first design, and built-in translation instead of old-school call forwarding.'
            )}
          </Text>
        </Card>

        <Card withBorder radius="lg" p="md">
          <Text fw={600} size="sm">
            {t('upgrade.why.card.messengers.title', 'Chatforia vs chat apps')}
          </Text>
          <Text size="xs" c="dimmed" mt={4}>
            {t(
              'upgrade.why.card.messengers.body',
              'Text real phone numbers — not just other app users — with AI and status built in.'
            )}
          </Text>
        </Card>
      </SimpleGrid>

      <Card withBorder radius="lg" p="md">
        <Text fw={600} size="sm" mb={8}>
          {t('upgrade.why.tableTitle', 'How Chatforia compares')}
        </Text>

        <Table highlightOnHover striped verticalSpacing="xs" horizontalSpacing="md">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('upgrade.why.col.feature', 'Feature')}</Table.Th>
              <Table.Th>Chatforia</Table.Th>
              <Table.Th>TextNow</Table.Th>
              <Table.Th>Google Voice</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            <Table.Tr>
              <Table.Td>
                {t('upgrade.why.feature.freeNumber', 'Free phone number')}
              </Table.Td>
              <Table.Td>{t('upgrade.why.yes', 'Yes')}</Table.Td>
              <Table.Td>{t('upgrade.why.yes', 'Yes')}</Table.Td>
              <Table.Td>{t('upgrade.why.yes', 'Yes')}</Table.Td>
            </Table.Tr>

            <Table.Tr>
              <Table.Td>
                {t(
                  'upgrade.why.feature.translation',
                  'Built-in auto-translation'
                )}
              </Table.Td>
              <Table.Td>{t('upgrade.why.yes', 'Yes')}</Table.Td>
              <Table.Td>{t('upgrade.why.no', 'No')}</Table.Td>
              <Table.Td>{t('upgrade.why.no', 'No')}</Table.Td>
            </Table.Tr>

            <Table.Tr>
              <Table.Td>
                {t(
                  'upgrade.why.feature.aiTools',
                  'AI tools (rewrites, replies, summaries)'
                )}
              </Table.Td>
              <Table.Td>{t('upgrade.why.yesPremium', 'Yes (Premium)')}</Table.Td>
              <Table.Td>{t('upgrade.why.no', 'No')}</Table.Td>
              <Table.Td>{t('upgrade.why.no', 'No')}</Table.Td>
            </Table.Tr>

            <Table.Tr>
              <Table.Td>{t('upgrade.why.feature.ads', 'Ad-free option')}</Table.Td>
              <Table.Td>{t('upgrade.why.plusPremium', 'Plus & Premium')}</Table.Td>
              <Table.Td>{t('upgrade.why.limited', 'Limited')}</Table.Td>
              <Table.Td>{t('upgrade.why.nA', 'N/A')}</Table.Td>
            </Table.Tr>

            <Table.Tr>
              <Table.Td>{t('upgrade.why.feature.history', 'Message history')}</Table.Td>
              <Table.Td>{t('upgrade.why.history.chatforia', 'Up to 12+ months')}</Table.Td>
              <Table.Td>{t('upgrade.why.history.textnow', 'Varies by account')}</Table.Td>
              <Table.Td>{t('upgrade.why.history.voice', 'Limited / account-based')}</Table.Td>
            </Table.Tr>
          </Table.Tbody>
        </Table>

        <Text size="xs" c="dimmed" mt="xs">
          {t(
            'upgrade.why.disclaimer',
            'Comparison based on publicly available information and may change over time.'
          )}
        </Text>
      </Card>
    </Stack>
  );
}

function EsimCompareTable({ scope }) {
  const { t } = useTranslation();

  const rows = useMemo(() => {
    // Global is only 3/5 for now
    if (scope === ESIM_SCOPE_GLOBAL) {
      return [
        {
          pack: t('upgrade.mobile.small.title', '3 GB'),
          data: t('upgrade.mobile.small.data', '3 GB'),
          bestFor: t(
            'upgrade.mobile.small.bestFor',
            'Short trips, light messaging, and maps'
          ),
        },
        {
          pack: t('upgrade.mobile.medium.title', '5 GB'),
          data: t('upgrade.mobile.medium.data', '5 GB'),
          bestFor: t(
            'upgrade.mobile.medium.bestFor',
            'Weekend trips, regular VoIP calls, and maps'
          ),
        },
      ];
    }

    // Local + Europe show 3/5/10/20
    return [
      {
        pack: t('upgrade.mobile.small.title', '3 GB'),
        data: t('upgrade.mobile.small.data', '3 GB'),
        bestFor: t(
          'upgrade.mobile.small.bestFor',
          'Short trips, light messaging, and maps'
        ),
      },
      {
        pack: t('upgrade.mobile.medium.title', '5 GB'),
        data: t('upgrade.mobile.medium.data', '5 GB'),
        bestFor: t(
          'upgrade.mobile.medium.bestFor',
          'Weekend trips, regular VoIP calls, and maps'
        ),
      },
      {
        pack: t('upgrade.mobile.large.title', '10 GB'),
        data: t('upgrade.mobile.large.data', '10 GB'),
        bestFor: t(
          'upgrade.mobile.large.bestFor',
          'Longer stays, heavier usage, and frequent navigation'
        ),
      },
      {
        pack: t('upgrade.mobile.xl.title', '20 GB'),
        data: t('upgrade.mobile.xl.data', '20 GB'),
        bestFor: t(
          'upgrade.mobile.xl.bestFor',
          'Power travelers, hotspot use, and heavy browsing'
        ),
      },
    ];
  }, [scope, t]);

  return (
    <Card withBorder radius="lg" p="md" mt="md">
      <Text fw={600} size="sm" mb={8}>
        {t('upgrade.mobile.compare.title', 'Compare eSIM data packs')}
      </Text>

      <Table highlightOnHover striped verticalSpacing="xs" horizontalSpacing="md">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t('upgrade.mobile.compare.col.pack', 'Pack')}</Table.Th>
            <Table.Th>{t('upgrade.mobile.compare.col.data', 'Data')}</Table.Th>
            <Table.Th>{t('upgrade.mobile.compare.col.bestFor', 'Best for')}</Table.Th>
          </Table.Tr>
        </Table.Thead>

        <Table.Tbody>
          {rows.map((r) => (
            <Table.Tr key={`${r.pack}-${r.data}`}>
              <Table.Td>{r.pack}</Table.Td>
              <Table.Td>{r.data}</Table.Td>
              <Table.Td>{r.bestFor}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>

      <Text size="xs" c="dimmed" mt="xs">
        {t(
          'upgrade.mobile.compare.disclaimer',
          'Actual data usage depends on how you use your phone (voice, video, media, maps, hotspot, etc.).'
        )}
      </Text>
    </Card>
  );
}

function PricingFaqSection() {
  const { t } = useTranslation();

  return (
    <Stack gap="md" mt="xl">
      <Divider my="sm" />
      <Title order={2}>{t('upgrade.faq.title', 'Pricing & plans FAQ')}</Title>

      <Accordion multiple>
        <Accordion.Item value="free-plan">
          <Accordion.Control>
            {t('upgrade.faq.free.q', 'Is the Free plan really free?')}
          </Accordion.Control>
          <Accordion.Panel>
            <Text size="sm">
              {t(
                'upgrade.faq.free.a',
                'Yes. The Free plan includes a Chatforia number, calling, and messaging with ads. You can stay on Free as long as you like.'
              )}
            </Text>
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="plus-vs-premium">
          <Accordion.Control>
            {t(
              'upgrade.faq.plusPremium.q',
              'What’s the difference between Plus and Premium?'
            )}
          </Accordion.Control>
          <Accordion.Panel>
            <Text size="sm">
              {t(
                'upgrade.faq.plusPremium.a',
                'Plus removes ads and extends your history. Premium adds AI power tools, more customization, and priority support.'
              )}
            </Text>
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="esim-availability">
          <Accordion.Control>
            {t('upgrade.faq.esim.q', 'Where do eSIM data packs work?')}
          </Accordion.Control>
          <Accordion.Panel>
            <Text size="sm">
              {t(
                'upgrade.faq.esim.a',
                'Availability depends on your device and region. You’ll see supported options during activation inside the app.'
              )}
            </Text>
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="cancel">
          <Accordion.Control>
            {t('upgrade.faq.cancel.q', 'Can I cancel or change plans anytime?')}
          </Accordion.Control>
          <Accordion.Panel>
            <Text size="sm">
              {t(
                'upgrade.faq.cancel.a',
                'Yes. You can manage or cancel your subscription from the billing page. Changes take effect at the end of your billing period.'
              )}
            </Text>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </Stack>
  );
}

/* ---------------- page ---------------- */

export default function UpgradePage({ variant = 'account' }) {
  const { t } = useTranslation();
  const { currentUser } = useUser();
  const navigate = useNavigate();

  const isPublic = variant === 'public';

  const [loadingCheckout, setLoadingCheckout] = useState(false);
  const [loadingPortal, setLoadingPortal] = useState(false);
  const [loadingKeep, setLoadingKeep] = useState(false);

  // Which section (App plans vs Mobile vs Family)
  const [section, setSection] = useState(SECTION_APP);

  // Display toggle: which premium option should be visually emphasized
  const [billingCycle, setBillingCycle] = useState('monthly'); // 'monthly' | 'annual'

  // pricing quotes – app
  const [qPlus, setQPlus] = useState(null);
  const [qPremMonthly, setQPremMonthly] = useState(null);
  const [qPremAnnual, setQPremAnnual] = useState(null);

  // eSIM scope + quotes map
  const [esimScope, setEsimScope] = useState(ESIM_SCOPE_LOCAL);
  const [esimQuotes, setEsimQuotes] = useState({}); // { [product]: quote }

  const isAuthed = !!currentUser;
  const planName = (currentUser?.plan || 'FREE').toUpperCase();
  const isFree = planName === 'FREE';
  const isPlus = planName === 'PLUS';
  const isPremium = planName === 'PREMIUM';
  const isPaid = isPlus || isPremium;

  const cancelAt = currentUser?.planExpiresAt
    ? new Date(currentUser.planExpiresAt)
    : null;

  const hasScheduledDowngrade = Boolean(
    isAuthed &&
      isPaid &&
      cancelAt &&
      !Number.isNaN(cancelAt.getTime()) &&
      cancelAt > new Date()
  );

  // eSIM products (no plans under 3GB; Global only 3/5)
  const esimProducts = useMemo(() => {
    if (esimScope === ESIM_SCOPE_GLOBAL) {
      return [
        {
          product: 'chatforia_esim_global_3',
          gb: 3,
          title: t('upgrade.esim.global.3.title', 'Global 3 GB'),
          desc: t('upgrade.esim.global.3.desc', 'Global coverage for light travel.'),
        },
        {
          product: 'chatforia_esim_global_5',
          gb: 5,
          title: t('upgrade.esim.global.5.title', 'Global 5 GB'),
          desc: t('upgrade.esim.global.5.desc', 'Global coverage for moderate travel.'),
        },
      ];
    }

    if (esimScope === ESIM_SCOPE_EUROPE) {
      return [
        {
          product: 'chatforia_esim_europe_3',
          gb: 3,
          title: t('upgrade.esim.europe.3.title', 'Europe 3 GB'),
          desc: t('upgrade.esim.europe.3.desc', 'Great for quick trips and light use.'),
        },
        {
          product: 'chatforia_esim_europe_5',
          gb: 5,
          title: t('upgrade.esim.europe.5.title', 'Europe 5 GB'),
          desc: t('upgrade.esim.europe.5.desc', 'Weekend trips, maps, and regular messaging.'),
        },
        {
          product: 'chatforia_esim_europe_10',
          gb: 10,
          title: t('upgrade.esim.europe.10.title', 'Europe 10 GB'),
          desc: t('upgrade.esim.europe.10.desc', 'Longer stays and heavier usage.'),
        },
        {
          product: 'chatforia_esim_europe_20',
          gb: 20,
          title: t('upgrade.esim.europe.20.title', 'Europe 20 GB'),
          desc: t('upgrade.esim.europe.20.desc', 'Power travelers and hotspot use.'),
        },
      ];
    }

    // Local default
    return [
      {
        product: 'chatforia_esim_local_3',
        gb: 3,
        title: t('upgrade.esim.local.3.title', 'Local 3 GB'),
        desc: t('upgrade.esim.local.3.desc', 'Light use and short coverage needs.'),
      },
      {
        product: 'chatforia_esim_local_5',
        gb: 5,
        title: t('upgrade.esim.local.5.title', 'Local 5 GB'),
        desc: t('upgrade.esim.local.5.desc', 'Regular daily usage.'),
      },
      {
        product: 'chatforia_esim_local_10',
        gb: 10,
        title: t('upgrade.esim.local.10.title', 'Local 10 GB'),
        desc: t('upgrade.esim.local.10.desc', 'Heavy usage and media sharing.'),
      },
      {
        product: 'chatforia_esim_local_20',
        gb: 20,
        title: t('upgrade.esim.local.20.title', 'Local 20 GB'),
        desc: t('upgrade.esim.local.20.desc', 'Power users and hotspot scenarios.'),
      },
    ];
  }, [esimScope, t]);

  // Choose a grid that always looks good:
  // - 2 items (Global) => 2 columns on md
  // - 4 items (Local/Europe) => 2 columns on md (clean 2x2)
  // - if you ever have 3 again, it’ll switch to 3
  const esimMdCols = esimProducts.length === 3 ? 3 : 2;

  // fetch region-aware quotes on mount (app plans)
  useEffect(() => {
    (async () => {
      try {
        const [plus, premM, premA] = await Promise.allSettled([
          getPricingQuote({ product: 'chatforia_plus' }),
          getPricingQuote({ product: 'chatforia_premium_monthly' }),
          getPricingQuote({ product: 'chatforia_premium_annual' }),
        ]);

        if (plus.status === 'fulfilled') setQPlus(plus.value);
        if (premM.status === 'fulfilled') setQPremMonthly(premM.value);
        if (premA.status === 'fulfilled') setQPremAnnual(premA.value);
      } catch {
        // silent fail; UI will show hard-coded labels
      }
    })();
  }, []);

  // fetch eSIM quotes whenever scope changes
  useEffect(() => {
    (async () => {
      try {
        const results = await Promise.allSettled(
          esimProducts.map((p) => getPricingQuote({ product: p.product }))
        );

        const next = {};
        results.forEach((r, i) => {
          if (r.status === 'fulfilled' && r.value) {
            next[esimProducts[i].product] = r.value;
          }
        });
        setEsimQuotes(next);
      } catch {
        setEsimQuotes({});
      }
    })();
  }, [esimProducts]);

  // nicely formatted price labels with fallback (app)
  const labelPlus = useMemo(() => {
    if (qPlus?.currency && typeof qPlus?.unitAmount === 'number') {
      return `${formatMoney(qPlus.unitAmount, qPlus.currency)} / ${t(
        'upgrade.perMonth',
        'mo'
      )}`;
    }
    return t('upgrade.plans.plus.price', '$4.99 / mo');
  }, [qPlus, t]);

  const labelPremMonthly = useMemo(() => {
    if (qPremMonthly?.currency && typeof qPremMonthly?.unitAmount === 'number') {
      return `${formatMoney(qPremMonthly.unitAmount, qPremMonthly.currency)} / ${t(
        'upgrade.perMonth',
        'mo'
      )}`;
    }
    return t('upgrade.plans.premiumMonthly.price', '$24.99 / mo');
  }, [qPremMonthly, t]);

  const labelPremAnnual = useMemo(() => {
    if (qPremAnnual?.currency && typeof qPremAnnual?.unitAmount === 'number') {
      return `${formatMoney(qPremAnnual.unitAmount, qPremAnnual.currency)} / ${t(
        'upgrade.perYear',
        'year'
      )}`;
    }
    return t('upgrade.plans.premiumAnnual.price', '$225 / year');
  }, [qPremAnnual, t]);

  const startCheckout = async ({ plan, priceId } = {}) => {
    if (!isAuthed) return navigate('/login?next=/upgrade');

    const body = {};
    if (plan) body.plan = plan;
    if (priceId) body.priceId = priceId;

    try {
      setLoadingCheckout(true);
      const { data } = await axiosClient.post('/billing/checkout', body);
      const url = data?.checkoutUrl || data?.url;
      if (url) window.location.href = url;
    } catch (e) {
      console.error('Checkout error', e);
    } finally {
      setLoadingCheckout(false);
    }
  };

  const detectedCountryCode = useMemo(() => {
    // Prefer “app” quote country if present
    const fromApp = qPlus?.country || qPremMonthly?.country || qPremAnnual?.country;
    if (fromApp) return fromApp;

    // Else use any eSIM quote country (first available)
    const anyEsimQuote = Object.values(esimQuotes || {}).find(Boolean);
    return anyEsimQuote?.country || null;
  }, [qPlus, qPremMonthly, qPremAnnual, esimQuotes]);

  const detectedCountryName = useMemo(() => {
    return countryNameFromCode(detectedCountryCode, navigator?.language);
  }, [detectedCountryCode]);

  // product-based checkout (for eSIM packs & future add-ons)
  const startCheckoutWithProduct = async (product) => {
    if (!isAuthed) return navigate('/login?next=/upgrade');

    try {
      setLoadingCheckout(true);

      let priceId = null;
      try {
        const { data } = await axiosClient.get('/pricing/quote', {
          params: { product },
        });
        priceId = data?.stripePriceId || null;
        if (!priceId) console.warn('No stripePriceId on quote', data);
      } catch (err) {
        console.warn('get /api/pricing/quote failed for', product, err);
      }

      // If Stripe is wired, priceId will exist and /billing/checkout will work.
      // If not, backend can decide what to do with { product }.
      const body = priceId ? { priceId } : { product };

      const res = await axiosClient.post('/billing/checkout', body);
      const url = res?.data?.checkoutUrl || res?.data?.url;
      if (url) window.location.href = url;
    } catch (e) {
      console.error('Checkout error', e);
    } finally {
      setLoadingCheckout(false);
    }
  };

  const openBillingPortal = async () => {
    if (!isAuthed) return navigate('/login?next=/upgrade');
    try {
      setLoadingPortal(true);
      const { data } = await axiosClient.post('/billing/portal', {});
      const url = data?.portalUrl || data?.url;
      if (url) window.location.href = url;
    } catch (e) {
      console.error('Portal error', e);
    } finally {
      setLoadingPortal(false);
    }
  };

  const refreshMe = async () => {
    try {
      const { data } = await axiosClient.get('/auth/me');
      if (!data?.user) return;
      window.location.reload();
    } catch {
      // ignore
    }
  };

  const unCancel = async () => {
    if (!isAuthed) return;
    try {
      setLoadingKeep(true);
      await axiosClient.post('/billing/uncancel');
      await refreshMe();
    } catch (e) {
      console.error('Uncancel error', e);
    } finally {
      setLoadingKeep(false);
    }
  };

  // CTA labels (app plans)
  const ctaFree = isAuthed
    ? isFree
      ? t('upgrade.plans.free.ctaCurrent', 'Current plan')
      : t('upgrade.plans.free.ctaManage', 'Manage in billing')
    : isPublic
    ? t('upgrade.plans.free.ctaPublic', 'Get started – continue to login')
    : t('upgrade.auth.continue', 'Continue to login');

  const ctaPlus = isAuthed
    ? isPlus || isPremium
      ? loadingPortal
        ? t('upgrade.billing.opening', 'Opening…')
        : t('upgrade.billing.manage', 'Manage Billing')
      : loadingCheckout
      ? t('upgrade.checkout.redirecting', 'Redirecting…')
      : t('upgrade.cta.getPlus', 'Upgrade to Plus')
    : isPublic
    ? t('upgrade.cta.public.plus', 'Get Plus – continue to login')
    : t('upgrade.auth.continue', 'Continue to login');

  const ctaPremMonthly = isAuthed
    ? isPremium
      ? loadingPortal
        ? t('upgrade.billing.opening', 'Opening…')
        : t('upgrade.billing.manage', 'Manage Billing')
      : loadingCheckout
      ? t('upgrade.checkout.redirecting', 'Redirecting…')
      : t('upgrade.cta.upgradeMonthly', 'Upgrade Monthly')
    : isPublic
    ? t('upgrade.cta.public.premiumMonthly', 'Unlock Premium – continue to login')
    : t('upgrade.auth.continue', 'Continue to login');

  const ctaPremAnnual = isAuthed
    ? isPremium
      ? loadingPortal
        ? t('upgrade.billing.opening', 'Opening…')
        : t('upgrade.billing.manage', 'Manage Billing')
      : loadingCheckout
      ? t('upgrade.checkout.redirecting', 'Redirecting…')
      : t('upgrade.cta.upgradeAnnual', 'Upgrade Annual')
    : isPublic
    ? t(
        'upgrade.cta.public.premiumAnnual',
        'Save 25% with annual – continue to login'
      )
    : t('upgrade.auth.continue', 'Continue to login');

  // CTA for eSIM packs (one-time purchases)
  const mobileCta = isAuthed
    ? loadingCheckout
      ? t('upgrade.mobile.checkout.redirecting', 'Redirecting…')
      : t('upgrade.mobile.cta', 'Get this data pack')
    : isPublic
    ? t('upgrade.mobile.ctaPublic', 'Get this data pack')
    : t('upgrade.auth.continue', 'Continue to login');

  const content = (
    <Stack gap="xl" maw={900} mx="auto" p="md">
      <Title order={1}>{t('upgrade.h1', 'Chatforia Pricing & Plans')}</Title>

      <Text c="dimmed" size="sm">
        {t(
          'upgrade.h1Subtitle',
          'Start with our free, ad-supported plan. Go ad-free with Plus, or unlock full power features with Premium.'
        )}
      </Text>

      {!isPublic && (
        <Group justify="flex-start">
          <SegmentedControl
            value={section}
            onChange={setSection}
            data={[
              { label: t('upgrade.section.app', 'App plans'), value: SECTION_APP },
              { label: t('upgrade.section.mobile', 'Mobile (eSIM)'), value: SECTION_MOBILE },
              ...(ENABLE_FAMILY_SECTION
                ? [{ label: t('upgrade.section.family', 'Family plans'), value: SECTION_FAMILY }]
                : []),
            ]}
          />
        </Group>
      )}

      {hasScheduledDowngrade && (
        <Alert
          color="orange"
          variant="light"
          title={t('upgrade.scheduleBanner.title', 'Subscription will end')}
        >
          {t('upgrade.scheduleBanner.body', 'You’ll revert to Free on')}{' '}
          <strong>{cancelAt.toLocaleDateString()}</strong>.
          <Button
            size="xs"
            ml="sm"
            variant="filled"
            onClick={unCancel}
            loading={loadingKeep}
            aria-busy={loadingKeep ? 'true' : 'false'}
          >
            {t(
              'upgrade.scheduleBanner.keepPlanCta',
              `Keep ${isPlus ? 'Plus' : 'Premium'}`
            )}
          </Button>
          <Button
            size="xs"
            ml="xs"
            variant="light"
            onClick={openBillingPortal}
            disabled={loadingPortal}
            loading={loadingPortal}
            aria-busy={loadingPortal ? 'true' : 'false'}
          >
            {t('upgrade.scheduleBanner.manageBillingCta', 'Manage billing')}
          </Button>
        </Alert>
      )}

      {/* APP PLANS SECTION */}
      {section === SECTION_APP && (
        <>
          <Title order={2}>
            {t('upgrade.h2.app', 'Free, Plus, and Premium plans')}
          </Title>

          <Group justify="flex-start" mt="sm">
            <SegmentedControl
              value={billingCycle}
              onChange={setBillingCycle}
              data={[
                { label: t('upgrade.toggle.monthly', 'Monthly'), value: 'monthly' },
                { label: t('upgrade.toggle.annual', 'Annual (Save 25%)'), value: 'annual' },
              ]}
            />
          </Group>

          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg" mt="sm">
            <PlanCard
              testId="plan-free"
              title={t('upgrade.plans.free.title', 'Free')}
              price={t('upgrade.plans.free.price', '$0')}
              description={t(
                'upgrade.plans.free.desc',
                'Start messaging for free. Ideal if you’re just trying Chatforia.'
              )}
              features={[
                t(
                  'upgrade.plans.free.features.chat',
                  'Real-time 1:1 and group chat, plus voice and video calls'
                ),
                t(
                  'upgrade.plans.free.features.media',
                  'Share photos, voice messages, and short videos'
                ),
                t(
                  'upgrade.plans.free.features.ai',
                  'AI-powered smart replies and instant translation (fair use)'
                ),
                t(
                  'upgrade.plans.free.features.disappearing',
                  'Disappearing messages and basic privacy controls'
                ),
                t('upgrade.plans.free.features.ads', 'Free forever with ads in the app'),
              ]}
              icon={<MessageSquare size={18} />}
              cta={ctaFree}
              ariaLabel={t('upgrade.plans.free.aria', 'Free plan')}
              onClick={() => {
                if (!isAuthed) navigate('/login?next=/upgrade');
              }}
              disabled={isAuthed}
            />

            <PlanCard
              testId="plan-plus"
              title={t('upgrade.plans.plus.title', 'Plus')}
              price={labelPlus}
              description={t(
                'upgrade.plans.plus.desc',
                'All the essentials, without ads. Great for everyday messaging and calling.'
              )}
              features={[
                t('upgrade.plans.plus.features.allFree', 'Everything in Free, with no ads'),
                t(
                  'upgrade.plans.plus.features.forwarding',
                  'Forward calls and texts to your real phone number'
                ),
                t(
                  'upgrade.plans.plus.features.history',
                  'Longer message history (up to 6 months)'
                ),
                t(
                  'upgrade.plans.plus.features.support',
                  'Faster support when something goes wrong'
                ),
              ]}
              badge={!isPremium && !isPlus ? t('upgrade.plans.plus.badge', 'Popular') : undefined}
              badgeColor="orange"
              icon={<Ban size={18} />}
              cta={ctaPlus}
              ariaLabel={t('upgrade.plans.plus.aria', 'Upgrade to Plus')}
              onClick={() =>
                isAuthed
                  ? isPlus || isPremium
                    ? openBillingPortal()
                    : startCheckout({ plan: 'PLUS_MONTHLY', priceId: qPlus?.stripePriceId })
                  : navigate('/login?next=/upgrade')
              }
              loading={isAuthed ? (isPlus || isPremium ? loadingPortal : loadingCheckout) : false}
            />

            <PlanCard
              testId="plan-premium-monthly"
              title={t('upgrade.plans.premiumMonthly.title', 'Premium (Monthly)')}
              price={labelPremMonthly}
              description={t(
                'upgrade.plans.premiumMonthly.desc',
                'The full Chatforia experience: AI power tools, customization, and priority support.'
              )}
              features={[
                t('upgrade.plans.premiumMonthly.features.plusAll', 'Everything in Plus'),
                t(
                  'upgrade.plans.premiumMonthly.features.themes',
                  'Unlock all premium color themes and app customizations'
                ),
                t(
                  'upgrade.plans.premiumMonthly.features.ai',
                  'Premium-only AI power tools for rewrites, smart replies, and summaries'
                ),
                t(
                  'upgrade.plans.premiumMonthly.features.support',
                  'Priority support when you need help most'
                ),
              ]}
              highlight={billingCycle === 'monthly'}
              tint={billingCycle === 'monthly'}
              tintColor="yellow"
              badge={t('upgrade.plans.premiumMonthly.badge', 'Recommended')}
              badgeColor="yellow"
              icon={<Star size={18} />}
              cta={ctaPremMonthly}
              ariaLabel={t('upgrade.plans.premiumMonthly.aria', 'Upgrade to Premium Monthly')}
              onClick={() =>
                isAuthed
                  ? isPremium
                    ? openBillingPortal()
                    : startCheckout({ plan: 'PREMIUM_MONTHLY', priceId: qPremMonthly?.stripePriceId })
                  : navigate('/login?next=/upgrade')
              }
              loading={isAuthed ? (isPremium ? loadingPortal : loadingCheckout) : false}
            />

            <PlanCard
              testId="plan-premium-annual"
              title={t('upgrade.plans.premiumAnnual.title', 'Premium (Annual)')}
              price={labelPremAnnual}
              description={t(
                'upgrade.plans.premiumAnnual.desc',
                'Save more when billed yearly — including extra color themes, AI tools, and priority support.'
              )}
              features={[
                t(
                  'upgrade.plans.premiumAnnual.features.allPremium',
                  'Everything in Premium Monthly — including extra color themes'
                ),
                t('upgrade.plans.premiumAnnual.features.annualBilling', 'Billed once per year'),
                t(
                  'upgrade.plans.premiumAnnual.features.save25',
                  'Save around 25% compared to paying monthly'
                ),
                t(
                  'upgrade.plans.premiumAnnual.features.bestFor',
                  'Best for power users, remote workers, and heavy travelers'
                ),
              ]}
              highlight={billingCycle === 'annual'}
              tint={billingCycle === 'annual'}
              tintColor="green"
              badge={t('upgrade.plans.premiumAnnual.badge', 'Save 25%')}
              badgeColor="green"
              icon={<CircleDollarSign size={18} />}
              cta={ctaPremAnnual}
              ariaLabel={t('upgrade.plans.premiumAnnual.aria', 'Upgrade to Premium Annual')}
              onClick={() =>
                isAuthed
                  ? startCheckout({ plan: 'PREMIUM_ANNUAL', priceId: qPremAnnual?.stripePriceId })
                  : navigate('/login?next=/upgrade')
              }
              loading={isAuthed ? loadingCheckout : false}
              footer={
                <Text size="xs" c="dimmed" mt="xs">
                  {t(
                    'upgrade.plans.premiumAnnual.disclaimer',
                    'Billed upfront. Cancel anytime. No hidden fees.'
                  )}
                </Text>
              }
            />
          </SimpleGrid>
        </>
      )}

      {/* MOBILE (eSIM) SECTION */}
      {(section === SECTION_MOBILE || variant === 'public') && (
        <>
          <Divider my="sm" />

          <Stack gap="xs">
            <Title order={2}>
              {t('upgrade.mobile.title', 'Chatforia Mobile (eSIM data packs)')}
            </Title>
            <Text c="dimmed" size="sm">
              {t(
                'upgrade.mobile.subtitle.detail',
                'Pick a one-time data pack so Chatforia keeps working when you’re traveling or away from Wi-Fi.'
              )}
            </Text>
          </Stack>

          <Group justify="flex-start" mt="sm">
            <SegmentedControl
              value={esimScope}
              onChange={setEsimScope}
              data={[
                { label: t('upgrade.esim.scope.local', 'Local'), value: ESIM_SCOPE_LOCAL },
                { label: t('upgrade.esim.scope.europe', 'Europe'), value: ESIM_SCOPE_EUROPE },
                { label: t('upgrade.esim.scope.global', 'Global'), value: ESIM_SCOPE_GLOBAL },
              ]}
            />
          </Group>

          {isPublic && (
            <Text size="sm" c="dimmed" mt={6} mb="sm">
              {detectedCountryName ? `Local = ${detectedCountryName}` : 'Local = your current country'}
            </Text>
          )}

          <Text size="xs" c="dimmed" mt={-4}>
            {t('upgrade.esim.note', 'We don’t sell data packs under 3 GB.')}
          </Text>

          <SimpleGrid cols={{ base: 1, md: esimMdCols }} spacing="lg" mt="sm">
            {esimProducts.map((p) => {
              const q = esimQuotes[p.product];

              const priceLabel =
                q?.currency && typeof q?.unitAmount === 'number'
                  ? formatMoney(q.unitAmount, q.currency)
                  : '—';

              return (
                <PlanCard
                  key={p.product}
                  testId={`plan-${p.product}`}
                  title={p.title}
                  price={priceLabel}
                  description={p.desc}
                  features={[
                    t(
                      'upgrade.mobile.feature.esim',
                      'Instant eSIM activation on supported devices'
                    ),
                    t('upgrade.mobile.feature.oneTime', 'One-time pack, no contract'),
                    t('upgrade.mobile.feature.topUp', 'Top up anytime with another pack'),
                  ]}
                  icon={<Wallet size={18} />}
                  cta={mobileCta}
                  ariaLabel={t('upgrade.mobile.aria', 'Buy eSIM data pack')}
                  onClick={() =>
                    isAuthed
                      ? startCheckoutWithProduct(p.product)
                      : navigate('/login?next=/upgrade')
                  }
                  loading={isAuthed ? loadingCheckout : false}
                />
              );
            })}
          </SimpleGrid>

          <Text size="xs" c="dimmed" mt="xs">
            {t(
              'upgrade.mobile.disclaimer.devices',
              'eSIM data packs require an eSIM-compatible and unlocked device. Availability varies by phone model, carrier, and country. Coverage and speeds vary by region.'
            )}
          </Text>

          {variant === 'public' && <EsimCompareTable scope={esimScope} />}
        </>
      )}

      {/* FAMILY SECTION (hidden for now) */}
      {ENABLE_FAMILY_SECTION && (section === SECTION_FAMILY || variant === 'public') && (
        <>
          <Divider my="sm" />
          <Title order={2}>{t('upgrade.family.title', 'Chatforia Family (shared data)')}</Title>
          <Text c="dimmed" size="sm">
            {t(
              'upgrade.family.subtitle',
              'Coming soon. Family packs will return once wholesale/reseller pricing is enabled.'
            )}
          </Text>
        </>
      )}

      {variant === 'public' && <WhyChatforiaSection />}
      {variant === 'public' && <PricingFaqSection />}

      {!isAuthed && (
        <Group mt="lg" gap="sm" justify="center">
          <Button component={Link} to="/login?next=/upgrade" size="sm" variant="default">
            {t('upgrade.auth.signIn', 'Sign in')}
          </Button>
          <Button component={Link} to="/register?next=/upgrade" size="sm" variant="light">
            {t('upgrade.auth.createAccount', 'Create account')}
          </Button>
        </Group>
      )}
    </Stack>
  );

  if (variant === 'public') return <div className="public-page auth-page">{content}</div>;
  return content;
}
