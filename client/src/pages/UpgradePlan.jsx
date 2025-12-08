// client/src/pages/UpgradePlan.jsx
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
// eSIM / add-on billing helpers
import { createEsimCheckoutSession } from '@/api/billing';

// ---- helpers ----
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

        <Title order={2}>{price}</Title>

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

      {/* H2: Why people switch */}
      <Title order={2}>
        {t('upgrade.why.title', 'Why people switch to Chatforia')}
      </Title>

      <Text size="sm" c="dimmed">
        {t(
          'upgrade.why.subtitle',
          'Chatforia gives you a real phone number, smart translation, and a clear path to go ad-free when you’re ready.'
        )}
      </Text>

      {/* Small comparison cards */}
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
              'Text real phone numbers — not just other app users — with AI and status built in. Great if you’re coming from apps like TextFree or TextMe.'
            )}
          </Text>
        </Card>
      </SimpleGrid>

      {/* Compact comparison table */}
      <Card withBorder radius="lg" p="md">
        <Text fw={600} size="sm" mb={8}>
          {t('upgrade.why.tableTitle', 'How Chatforia compares')}
        </Text>

        <Table
          highlightOnHover
          striped
          verticalSpacing="xs"
          horizontalSpacing="md"
        >
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
              <Table.Td>
                {t('upgrade.why.yesPremium', 'Yes (Premium)')}
              </Table.Td>
              <Table.Td>{t('upgrade.why.no', 'No')}</Table.Td>
              <Table.Td>{t('upgrade.why.no', 'No')}</Table.Td>
            </Table.Tr>

            <Table.Tr>
              <Table.Td>{t('upgrade.why.feature.ads', 'Ad-free option')}</Table.Td>
              <Table.Td>
                {t('upgrade.why.plusPremium', 'Plus & Premium')}
              </Table.Td>
              <Table.Td>{t('upgrade.why.limited', 'Limited')}</Table.Td>
              <Table.Td>{t('upgrade.why.nA', 'N/A')}</Table.Td>
            </Table.Tr>

            <Table.Tr>
              <Table.Td>
                {t('upgrade.why.feature.history', 'Message history')}
              </Table.Td>
              <Table.Td>
                {t('upgrade.why.history.chatforia', 'Up to 12+ months')}
              </Table.Td>
              <Table.Td>
                {t('upgrade.why.history.textnow', 'Varies by account')}
              </Table.Td>
              <Table.Td>
                {t('upgrade.why.history.voice', 'Limited / account-based')}
              </Table.Td>
            </Table.Tr>
          </Table.Tbody>
        </Table>

        <Text size="xs" c="dimmed" mt="xs">
          {t(
            'upgrade.why.disclaimer',
            'Comparison based on publicly available information and may change over time. Other free-texting apps like TextFree or TextMe are generally similar to TextNow.'
          )}
        </Text>
      </Card>
    </Stack>
  );
}

function EsimCompareTable() {
  const { t } = useTranslation();

  return (
    <Card withBorder radius="lg" p="md" mt="md">
      <Text fw={600} size="sm" mb={8}>
        {t('upgrade.mobile.compare.title', 'Compare eSIM data packs')}
      </Text>

      <Table highlightOnHover striped verticalSpacing="xs" horizontalSpacing="md">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t('upgrade.mobile.compare.col.pack', 'Pack')}</Table.Th>
            <Table.Th>{t('upgrade.mobile.compare.col.data', 'Approx. data')}</Table.Th>
            <Table.Th>{t('upgrade.mobile.compare.col.bestFor', 'Best for')}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          <Table.Tr>
            <Table.Td>{t('upgrade.mobile.small.title', 'Starter pack')}</Table.Td>
            <Table.Td>{t('upgrade.mobile.small.data', 'About 3 GB')}</Table.Td>
            <Table.Td>
              {t(
                'upgrade.mobile.small.bestFor',
                'Short trips, light messaging, and occasional calls'
              )}
            </Table.Td>
          </Table.Tr>
          <Table.Tr>
            <Table.Td>{t('upgrade.mobile.medium.title', 'Traveler pack')}</Table.Td>
            <Table.Td>{t('upgrade.mobile.medium.data', 'About 5 GB')}</Table.Td>
            <Table.Td>
              {t(
                'upgrade.mobile.medium.bestFor',
                'Weekend trips, regular VoIP calls, and maps'
              )}
            </Table.Td>
          </Table.Tr>
          <Table.Tr>
            <Table.Td>{t('upgrade.mobile.large.title', 'Power pack')}</Table.Td>
            <Table.Td>{t('upgrade.mobile.large.data', 'About 10 GB')}</Table.Td>
            <Table.Td>
              {t(
                'upgrade.mobile.large.bestFor',
                'Heavy chat, calls, video, and hotspot use'
              )}
            </Table.Td>
          </Table.Tr>
        </Table.Tbody>
      </Table>

      <Text size="xs" c="dimmed" mt="xs">
        {t(
          'upgrade.mobile.compare.disclaimer',
          'Actual data usage depends on how you use Chatforia (voice, video, media, and other apps on your phone).'
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

      {/* H2: Pricing & plans FAQ */}
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
                'Yes. The Free plan includes a Chatforia number, calling, and messaging with ads. You can stay on Free as long as you like, or upgrade to remove ads and unlock more features.'
              )}
            </Text>
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="plus-vs-premium">
          <Accordion.Control>
            {t('upgrade.faq.plusPremium.q', 'What’s the difference between Plus and Premium?')}
          </Accordion.Control>
          <Accordion.Panel>
            <Text size="sm">
              {t(
                'upgrade.faq.plusPremium.a',
                'Plus removes ads and extends your message history — perfect for everyday use. Premium adds extra customization, AI tools for rewrites and replies, and priority support for heavy users.'
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
                'Chatforia Mobile uses global eSIM coverage. Availability depends on your country and device. You’ll see supported options during activation inside the app.'
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
                'Yes. You can manage or cancel your subscription from the billing page in the app. Changes take effect at the end of your current billing period.'
              )}
            </Text>
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="family">
          <Accordion.Control>
            {t('upgrade.faq.family.q', 'How do Family packs work?')}
          </Accordion.Control>
          <Accordion.Panel>
            <Text size="sm">
              {t(
                'upgrade.faq.family.a',
                'Family packs create a shared data pool across multiple Chatforia accounts. One person pays the bill, and you can invite or remove members and set limits per person.'
              )}
            </Text>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </Stack>
  );
}

const SECTION_APP = 'app';
const SECTION_MOBILE = 'mobile';
const SECTION_FAMILY = 'family';

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

  // mobile eSIM pack quotes
  const [qMobileSmall, setQMobileSmall] = useState(null);
  const [qMobileMedium, setQMobileMedium] = useState(null);
  const [qMobileLarge, setQMobileLarge] = useState(null);

  // family shared data pack quotes
  const [qFamilySmall, setQFamilySmall] = useState(null);
  const [qFamilyMedium, setQFamilyMedium] = useState(null);
  const [qFamilyLarge, setQFamilyLarge] = useState(null);

  const isAuthed = !!currentUser;
  const planName = (currentUser?.plan || 'FREE').toUpperCase();
  const isFree = planName === 'FREE';
  const isPlus = planName === 'PLUS';
  const isPremium = planName === 'PREMIUM';
  const isPaid = isPlus || isPremium;

  const cancelAt = currentUser?.planExpiresAt
    ? new Date(currentUser.planExpiresAt)
    : null;

  const hasScheduledDowngrade =
    Boolean(
      isAuthed &&
        isPaid &&
        cancelAt &&
        !Number.isNaN(cancelAt.getTime()) &&
        cancelAt > new Date()
    );

  // fetch region-aware quotes on mount
  useEffect(() => {
    (async () => {
      try {
        const [
          plus,
          premM,
          premA,
          mobileSmall,
          mobileMedium,
          mobileLarge,
          familySmall,
          familyMedium,
          familyLarge,
        ] = await Promise.allSettled([
          getPricingQuote({ product: 'chatforia_plus' }),
          getPricingQuote({ product: 'chatforia_premium_monthly' }),
          getPricingQuote({ product: 'chatforia_premium_annual' }),
          getPricingQuote({ product: 'chatforia_mobile_small' }),
          getPricingQuote({ product: 'chatforia_mobile_medium' }),
          getPricingQuote({ product: 'chatforia_mobile_large' }),
          getPricingQuote({ product: 'chatforia_family_small' }),
          getPricingQuote({ product: 'chatforia_family_medium' }),
          getPricingQuote({ product: 'chatforia_family_large' }),
        ]);

        if (plus.status === 'fulfilled') setQPlus(plus.value);
        if (premM.status === 'fulfilled') setQPremMonthly(premM.value);
        if (premA.status === 'fulfilled') setQPremAnnual(premA.value);

        if (mobileSmall.status === 'fulfilled') setQMobileSmall(mobileSmall.value);
        if (mobileMedium.status === 'fulfilled') setQMobileMedium(mobileMedium.value);
        if (mobileLarge.status === 'fulfilled') setQMobileLarge(mobileLarge.value);

        if (familySmall.status === 'fulfilled') setQFamilySmall(familySmall.value);
        if (familyMedium.status === 'fulfilled') setQFamilyMedium(familyMedium.value);
        if (familyLarge.status === 'fulfilled') setQFamilyLarge(familyLarge.value);
      } catch {
        // Silent fail; UI will show hard-coded labels
      }
    })();
  }, []);

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

  // mobile labels — data packs (one-time)
  const labelMobileSmall = useMemo(() => {
    if (qMobileSmall?.currency && typeof qMobileSmall?.unitAmount === 'number') {
      return formatMoney(qMobileSmall.unitAmount, qMobileSmall.currency);
    }
    return t('upgrade.mobile.small.price', '$9.99'); // 3 GB
  }, [qMobileSmall, t]);

  const labelMobileMedium = useMemo(() => {
    if (qMobileMedium?.currency && typeof qMobileMedium?.unitAmount === 'number') {
      return formatMoney(qMobileMedium.unitAmount, qMobileMedium.currency);
    }
    return t('upgrade.mobile.medium.price', '$14.99'); // 5 GB
  }, [qMobileMedium, t]);

  const labelMobileLarge = useMemo(() => {
    if (qMobileLarge?.currency && typeof qMobileLarge?.unitAmount === 'number') {
      return formatMoney(qMobileLarge.unitAmount, qMobileLarge.currency);
    }
    return t('upgrade.mobile.large.price', '$24.99'); // 10 GB
  }, [qMobileLarge, t]);

  // family labels — shared pool packs (one-time)
  const labelFamilySmall = useMemo(() => {
    if (qFamilySmall?.currency && typeof qFamilySmall?.unitAmount === 'number') {
      return formatMoney(qFamilySmall.unitAmount, qFamilySmall.currency);
    }
    return t('upgrade.family.small.price', '$29.99'); // 20 GB
  }, [qFamilySmall, t]);

  const labelFamilyMedium = useMemo(() => {
    if (qFamilyMedium?.currency && typeof qFamilyMedium?.unitAmount === 'number') {
      return formatMoney(qFamilyMedium.unitAmount, qFamilyMedium.currency);
    }
    return t('upgrade.family.medium.price', '$49.99'); // 40 GB
  }, [qFamilyMedium, t]);

  const labelFamilyLarge = useMemo(() => {
    if (qFamilyLarge?.currency && typeof qFamilyLarge?.unitAmount === 'number') {
      return formatMoney(qFamilyLarge.unitAmount, qFamilyLarge.currency);
    }
    return t('upgrade.family.large.price', '$79.99'); // 80 GB
  }, [qFamilyLarge, t]);

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

  // lookup Stripe price from pricing API, then call /billing/checkout
  const startCheckoutWithProduct = async (product, fallbackPlanCode) => {
    if (!isAuthed) return navigate('/login?next=/upgrade');

    try {
      setLoadingCheckout(true);

      let priceId = null;

      try {
        const { data } = await axiosClient.get('/pricing/quote', {
          params: { product },
        });
        priceId = data?.stripePriceId || null;
        if (!priceId) {
          console.warn('No stripePriceId on quote, falling back to plan code', data);
        }
      } catch (err) {
        console.warn('get /api/pricing/quote failed for', product, err);
      }

      const body = priceId ? { priceId } : { plan: fallbackPlanCode };

      const res = await axiosClient.post('/billing/checkout', body);
      const url = res?.data?.checkoutUrl || res?.data?.url;
      if (url) window.location.href = url;
    } catch (e) {
      console.error('Checkout error', e);
    } finally {
      setLoadingCheckout(false);
    }
  };

  // eSIM add-on checkout using /billing/checkout-addon
  const buyEsimPack = async (kind) => {
    if (!isAuthed) return navigate('/login?next=/upgrade');

    try {
      setLoadingCheckout(true);
      // kind: "STARTER" | "TRAVELER" | "POWER"
      const data = await createEsimCheckoutSession(kind);
      const url = data?.checkoutUrl || data?.url;
      if (url) window.location.href = url;
    } catch (e) {
      console.error('eSIM checkout failed', e);
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

  // CTA for mobile/family packs (one-time purchases)
  const mobileCta = isAuthed
    ? loadingCheckout
      ? t('upgrade.mobile.checkout.redirecting', 'Redirecting…')
      : t('upgrade.mobile.cta', 'Get this data pack')
    : isPublic
    ? t('upgrade.mobile.ctaPublic', 'Get this data pack – continue to login')
    : t('upgrade.auth.continue', 'Continue to login');

  const content = (
    <Stack gap="xl" maw={900} mx="auto" p="md">
      {/* H1: main page title */}
      <Title order={1}>
        {t('upgrade.h1', 'Chatforia Pricing & Plans')}
      </Title>

      {/* Subtitle under H1 */}
      <Text c="dimmed" size="sm">
        {t(
          'upgrade.h1Subtitle',
          'Start with our free, ad-supported plan. Go ad-free with Plus, or unlock full power features with Premium.'
        )}
      </Text>

      {/* Top-level section toggle: App vs Mobile vs Family (logged-in only) */}
      {!isPublic && (
        <Group justify="flex-start">
          <SegmentedControl
            value={section}
            onChange={setSection}
            data={[
              { label: t('upgrade.section.app', 'App plans'), value: SECTION_APP },
              { label: t('upgrade.section.mobile', 'Mobile (eSIM)'), value: SECTION_MOBILE },
              { label: t('upgrade.section.family', 'Family plans'), value: SECTION_FAMILY },
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
          {/* H2: Free, Plus, and Premium */}
          <Title order={2}>
            {t('upgrade.h2.app', 'Free, Plus, and Premium plans')}
          </Title>

          {/* Monthly / Annual emphasis toggle */}
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
            {/* Free */}
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
                t(
                  'upgrade.plans.free.features.ads',
                  'Free forever with ads in the app'
                ),
              ]}
              icon={<MessageSquare size={18} />}
              cta={ctaFree}
              ariaLabel={t('upgrade.plans.free.aria', 'Free plan')}
              onClick={() => {
                if (!isAuthed) {
                  navigate('/login?next=/upgrade');
                }
              }}
              disabled={isAuthed}
            />

            {/* Plus (Ad-free) */}
            <PlanCard
              testId="plan-plus"
              title={t('upgrade.plans.plus.title', 'Plus')}
              price={labelPlus}
              description={t(
                'upgrade.plans.plus.desc',
                'All the essentials, without ads. Great for everyday messaging and calling.'
              )}
              features={[
                t(
                  'upgrade.plans.plus.features.allFree',
                  'Everything in Free, with no ads'
                ),
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
              badge={
                !isPremium && !isPlus
                  ? t('upgrade.plans.plus.badge', 'Popular')
                  : undefined
              }
              badgeColor="orange"
              icon={<Ban size={18} />}
              cta={ctaPlus}
              ariaLabel={t('upgrade.plans.plus.aria', 'Upgrade to Plus')}
              onClick={() =>
                isAuthed
                  ? isPlus || isPremium
                    ? openBillingPortal()
                    : startCheckout({
                        plan: 'PLUS_MONTHLY',
                        priceId: qPlus?.stripePriceId,
                      })
                  : navigate('/login?next=/upgrade')
              }
              loading={
                isAuthed ? (isPlus || isPremium ? loadingPortal : loadingCheckout) : false
              }
            />

            {/* Premium — Monthly */}
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
              ariaLabel={t(
                'upgrade.plans.premiumMonthly.aria',
                'Upgrade to Premium Monthly'
              )}
              onClick={() =>
                isAuthed
                  ? isPremium
                    ? openBillingPortal()
                    : startCheckout({
                        plan: 'PREMIUM_MONTHLY',
                        priceId: qPremMonthly?.stripePriceId,
                      })
                  : navigate('/login?next=/upgrade')
              }
              loading={isAuthed ? (isPremium ? loadingPortal : loadingCheckout) : false}
            />

            {/* Premium — Annual */}
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
                t(
                  'upgrade.plans.premiumAnnual.features.annualBilling',
                  'Billed once per year'
                ),
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
              ariaLabel={t(
                'upgrade.plans.premiumAnnual.aria',
                'Upgrade to Premium Annual'
              )}
              onClick={() =>
                isAuthed
                  ? startCheckout({
                      plan: 'PREMIUM_ANNUAL',
                      priceId: qPremAnnual?.stripePriceId,
                    })
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
            {/* H2: Mobile (eSIM) */}
            <Title order={2}>
              {t('upgrade.mobile.title', 'Chatforia Mobile (eSIM data packs)')}
            </Title>
            <Text c="dimmed" size="sm">
              {t(
                'upgrade.mobile.subtitle.detail',
                'Pick a one-time global data pack so Chatforia keeps working when you’re traveling or away from Wi-Fi.'
              )}
            </Text>
          </Stack>

          <SimpleGrid cols={{ base: 1, md: 3 }} spacing="lg" mt="sm">
            {/* Starter / Small */}
            <PlanCard
              testId="plan-mobile-small"
              title={t('upgrade.mobile.small.title', 'Starter data pack')}
              price={labelMobileSmall}
              description={t(
                'upgrade.mobile.small.desc',
                'Roughly 3 GB of global data — great for quick trips or light chat and calling.'
              )}
              features={[
                t(
                  'upgrade.mobile.feature.esim',
                  'Instant eSIM activation on supported devices'
                ),
                t(
                  'upgrade.mobile.feature.roaming',
                  'Use Chatforia without searching for Wi-Fi'
                ),
                t(
                  'upgrade.mobile.feature.oneTime',
                  'One-time pack, no contract'
                ),
              ]}
              icon={<Wallet size={18} />}
              cta={mobileCta}
              ariaLabel={t(
                'upgrade.mobile.small.aria',
                'Buy Starter eSIM data pack'
              )}
              onClick={() =>
                isAuthed
                  ? buyEsimPack('STARTER')
                  : navigate('/login?next=/upgrade')
              }
              loading={isAuthed ? loadingCheckout : false}
            />

            {/* Traveler / Medium */}
            <PlanCard
              testId="plan-mobile-medium"
              title={t('upgrade.mobile.medium.title', 'Traveler data pack')}
              price={labelMobileMedium}
              description={t(
                'upgrade.mobile.medium.desc',
                'Around 5 GB of global data — ideal for weekend trips or moderate usage.'
              )}
              features={[
                t(
                  'upgrade.mobile.feature.esim',
                  'Instant eSIM activation on supported devices'
                ),
                t(
                  'upgrade.mobile.feature.share',
                  'Perfect for calls, texts, and light browsing'
                ),
                t(
                  'upgrade.mobile.feature.topUp',
                  'Top up anytime with another pack'
                ),
              ]}
              icon={<Wallet size={18} />}
              cta={mobileCta}
              ariaLabel={t(
                'upgrade.mobile.medium.aria',
                'Buy Traveler eSIM data pack'
              )}
              onClick={() =>
                isAuthed
                  ? buyEsimPack('TRAVELER')
                  : navigate('/login?next=/upgrade')
              }
              loading={isAuthed ? loadingCheckout : false}
            />

            {/* Power / Large */}
            <PlanCard
              testId="plan-mobile-large"
              title={t('upgrade.mobile.large.title', 'Power user data pack')}
              price={labelMobileLarge}
              description={t(
                'upgrade.mobile.large.desc',
                'Roughly 10 GB of global data — best for long trips, hotspots, or heavy use.'
              )}
              features={[
                t(
                  'upgrade.mobile.feature.esim',
                  'Instant eSIM activation on supported devices'
                ),
                t(
                  'upgrade.mobile.feature.heavy',
                  'Enough for heavy chat, calls, and browsing'
                ),
                t(
                  'upgrade.mobile.feature.bestValue',
                  'Best value per GB'
                ),
              ]}
              icon={<Wallet size={18} />}
              cta={mobileCta}
              ariaLabel={t(
                'upgrade.mobile.large.aria',
                'Buy Power user eSIM data pack'
              )}
              onClick={() =>
                isAuthed
                  ? buyEsimPack('POWER')
                  : navigate('/login?next=/upgrade')
              }
              loading={isAuthed ? loadingCheckout : false}
            />
          </SimpleGrid>

          {/* eSIM device compatibility disclaimer */}
          <Text size="xs" c="dimmed" mt="xs">
            {t(
              'upgrade.mobile.disclaimer.devices',
              'eSIM data packs require an eSIM-compatible and unlocked device. Availability varies by phone model, carrier, and country. Coverage and speeds vary by region.'
            )}
          </Text>

          {variant === 'public' && <EsimCompareTable />}
        </>
      )}

      {/* FAMILY SECTION */}
      {(section === SECTION_FAMILY || variant === 'public') && (
        <>
          <Divider my="sm" />

          <Stack gap="xs">
            {/* H2: Family shared data */}
            <Title order={2}>
              {t('upgrade.family.title', 'Chatforia Family (shared data)')}
            </Title>
            <Text c="dimmed" size="sm">
              {t(
                'upgrade.family.subtitle',
                'Share a single data pool across your family. One bill, multiple Chatforia accounts, global coverage.'
              )}
            </Text>
          </Stack>

          <SimpleGrid cols={{ base: 1, md: 3 }} spacing="lg" mt="sm">
            {/* Family Small */}
            <PlanCard
              testId="plan-family-small"
              title={t('upgrade.family.small.title', 'Family Small')}
              price={`${labelFamilySmall} ${t('upgrade.family.perPack', '/ pack')}`}
              description={t(
                'upgrade.family.small.desc',
                'Includes 20 GB of shared high-speed data — great for 2–3 light users.'
              )}
              features={[
                t('upgrade.family.feature.shared', 'Shared data pool for your family'),
                t('upgrade.family.feature.members', 'Invite up to 4 additional members'),
                t('upgrade.family.feature.manage', 'Manage limits for each member'),
              ]}
              icon={<Wallet size={18} />}
              cta={mobileCta}
              ariaLabel={t('upgrade.family.small.aria', 'Buy Family Small pack')}
              onClick={() =>
                isAuthed
                  ? startCheckoutWithProduct('chatforia_family_small', 'FAMILY_SMALL')
                  : navigate('/login?next=/upgrade')
              }
              loading={isAuthed ? loadingCheckout : false}
            />

            {/* Family Medium */}
            <PlanCard
              testId="plan-family-medium"
              title={t('upgrade.family.medium.title', 'Family Medium')}
              price={`${labelFamilyMedium} ${t('upgrade.family.perPack', '/ pack')}`}
              description={t(
                'upgrade.family.medium.desc',
                'Includes 40 GB of shared high-speed data — ideal for 3–5 active members.'
              )}
              features={[
                t('upgrade.family.feature.shared', 'Shared data pool for your family'),
                t('upgrade.family.feature.membersMore', 'Great for 3–5 active members'),
                t('upgrade.family.feature.topUp', 'Add more packs anytime'),
              ]}
              icon={<Wallet size={18} />}
              cta={mobileCta}
              ariaLabel={t('upgrade.family.medium.aria', 'Buy Family Medium pack')}
              onClick={() =>
                isAuthed
                  ? startCheckoutWithProduct('chatforia_family_medium', 'FAMILY_MEDIUM')
                  : navigate('/login?next=/upgrade')
              }
              loading={isAuthed ? loadingCheckout : false}
            />

            {/* Family Large */}
            <PlanCard
              testId="plan-family-large"
              title={t('upgrade.family.large.title', 'Family Large')}
              price={`${labelFamilyLarge} ${t('upgrade.family.perPack', '/ pack')}`}
              description={t(
                'upgrade.family.large.desc',
                'Includes 80 GB of shared high-speed data — for power families that are always online.'
              )}
              features={[
                t('upgrade.family.feature.shared', 'Shared data pool for your family'),
                t('upgrade.family.feature.bestValue', 'Best value per GB'),
                t('upgrade.family.feature.fairUse', 'Subject to fair-use policy and local limits'),
              ]}
              icon={<Wallet size={18} />}
              cta={mobileCta}
              ariaLabel={t('upgrade.family.large.aria', 'Buy Family Large pack')}
              onClick={() =>
                isAuthed
                  ? startCheckoutWithProduct('chatforia_family_large', 'FAMILY_LARGE')
                  : navigate('/login?next=/upgrade')
              }
              loading={isAuthed ? loadingCheckout : false}
              footer={
                <Text size="xs" c="dimmed" mt="xs">
                  {t(
                    'upgrade.family.disclaimer',
                    'Family packs create or top up a shared data pool. You can invite and remove members anytime.'
                  )}
                </Text>
              }
            />
          </SimpleGrid>

          {variant === 'public' && (
            <Text size="xs" c="dimmed" mt="xs">
              {t(
                'upgrade.family.footnote',
                'Family packs share a single data pool across linked Chatforia accounts. Availability and limits depend on your country and local regulations.'
              )}
            </Text>
          )}
        </>
      )}

      {variant === 'public' && <WhyChatforiaSection />}
      {variant === 'public' && <PricingFaqSection />}

      {!isAuthed && (
        <Group mt="lg" gap="sm" justify="center">
          <Button
            component={Link}
            to="/login?next=/upgrade"
            size="sm"
            variant="default"
          >
            {t('upgrade.auth.signIn', 'Sign in')}
          </Button>
          <Button
            component={Link}
            to="/register?next=/upgrade"
            size="sm"
            variant="light"
          >
            {t('upgrade.auth.createAccount', 'Create account')}
          </Button>
        </Group>
      )}
    </Stack>
  );

  // Wrap with gradient tint only for the public pricing page
  if (variant === 'public') {
    return <div className="public-page auth-page">{content}</div>;
  }

  // Account/inside-app view (no extra tint)
  return content;
}
