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
} from '@mantine/core';
import axiosClient from '../api/axiosClient';
import { useUser } from '../context/UserContext';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

// Icons
import {
  MessageSquare,
  Ban,
  Star,
  Wallet,
  CircleDollarSign,
} from 'lucide-react';

// ⬇️ NEW: region-aware pricing quotes
import { getPricingQuote } from '@/api/pricing';

// ---- helpers ----
function formatMoney(amountMinor, currency = 'USD', locale) {
  const ZERO_DECIMAL = new Set([
    'BIF','CLP','DJF','GNF','JPY','KMF','KRW','PYG','RWF','UGX','VND','VUV','XAF','XOF','XPF'
  ]);
  const THREE_DECIMAL = new Set(['BHD','JOD','KWD','OMR','TND']);
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

function PlanCard({
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
  tint = false,          // subtle background tint
  tintColor = 'yellow',  // Mantine color name for tint
  ariaLabel,
  footer,                // optional extra content below the button (e.g., disclaimer)
}) {
  const { t } = useTranslation();

  return (
    <Card
      withBorder
      radius="xl"
      shadow={highlight ? 'md' : 'sm'}
      p="lg"
      data-testid={testId}
      style={{
        background:
          tint
            ? `var(--mantine-color-${tintColor}-0, #fff8e1)`
            : 'var(--mantine-color-default)',
        height: '100%',
      }}
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

        <Stack gap={4}>
          {features.map((f) => (
            <Text key={f} size="sm">
              • {f}
            </Text>
          ))}
        </Stack>

        {/* Flex spacer to push the CTA to the bottom across cards */}
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

export default function UpgradePage({ variant = 'account' }) {
  const { t } = useTranslation();
  const { currentUser } = useUser();
  const navigate = useNavigate();

  const [loadingCheckout, setLoadingCheckout] = useState(false);
  const [loadingPortal, setLoadingPortal] = useState(false);
  const [loadingKeep, setLoadingKeep] = useState(false);

  // Display toggle: which premium option should be visually emphasized
  const [billingCycle, setBillingCycle] = useState('monthly'); // 'monthly' | 'annual'

  // ⬇️ NEW: pricing quotes (nullable until loaded)
  const [qPlus, setQPlus] = useState(null);
  const [qPremMonthly, setQPremMonthly] = useState(null);
  const [qPremAnnual, setQPremAnnual] = useState(null);

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
    Boolean(isAuthed && isPaid && cancelAt && !Number.isNaN(cancelAt.getTime()) && cancelAt > new Date());

  // ⬇️ NEW: fetch region-aware quotes on mount
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
        // Silent fail; UI will show hard-coded labels
      }
    })();
  }, []);

  // ⬇️ NEW: nicely formatted price labels with fallback
  const labelPlus = useMemo(() => {
    if (qPlus?.currency && typeof qPlus?.unitAmount === 'number') {
      return `${formatMoney(qPlus.unitAmount, qPlus.currency)} / ${t('upgrade.perMonth', 'mo')}`;
    }
    return t('upgrade.plans.plus.price', '$4.99 / mo');
  }, [qPlus, t]);

  const labelPremMonthly = useMemo(() => {
    if (qPremMonthly?.currency && typeof qPremMonthly?.unitAmount === 'number') {
      return `${formatMoney(qPremMonthly.unitAmount, qPremMonthly.currency)} / ${t('upgrade.perMonth', 'mo')}`;
    }
    return t('upgrade.plans.premiumMonthly.price', '$24.99 / mo');
  }, [qPremMonthly, t]);

  const labelPremAnnual = useMemo(() => {
    if (qPremAnnual?.currency && typeof qPremAnnual?.unitAmount === 'number') {
      return `${formatMoney(qPremAnnual.unitAmount, qPremAnnual.currency)} / ${t('upgrade.perYear', 'year')}`;
    }
    return t('upgrade.plans.premiumAnnual.price', '$225 / year');
  }, [qPremAnnual, t]);

  // ⬇️ Updated checkout: prefer priceId when we have a quote
  const startCheckout = async (planOrPrice) => {
    if (!isAuthed) return navigate('/login?next=/upgrade');

    const body = planOrPrice?.startsWith('price_')
      ? { priceId: planOrPrice }
      : { plan: planOrPrice };

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
    } catch {}
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

  // CTA labels
  const ctaPlus = isAuthed
    ? (isPlus || isPremium
        ? (loadingPortal ? t('upgrade.billing.opening', 'Opening…') : t('upgrade.billing.manage', 'Manage Billing'))
        : (loadingCheckout ? t('upgrade.checkout.redirecting', 'Redirecting…') : t('upgrade.cta.getPlus', 'Upgrade to Plus')))
    : t('upgrade.auth.continue', 'Continue to login');

  const ctaPremMonthly = isAuthed
    ? (isPremium
        ? (loadingPortal ? t('upgrade.billing.opening', 'Opening…') : t('upgrade.billing.manage', 'Manage Billing'))
        : (loadingCheckout ? t('upgrade.checkout.redirecting', 'Redirecting…') : t('upgrade.cta.upgradeMonthly', 'Upgrade Monthly')))
    : t('upgrade.auth.continue', 'Continue to login');

  const ctaPremAnnual = isAuthed
    ? (isPremium
        ? (loadingPortal ? t('upgrade.billing.opening', 'Opening…') : t('upgrade.billing.manage', 'Manage Billing'))
        : (loadingCheckout ? t('upgrade.checkout.redirecting', 'Redirecting…') : t('upgrade.cta.upgradeAnnual', 'Upgrade Annual')))
    : t('upgrade.auth.continue', 'Continue to login');

  return (
    <Stack gap="lg" maw={900} mx="auto" p="md">
      <Title order={2}>{t('upgrade.title', 'Upgrade')}</Title>

      <Text c="dimmed">
        {t(
          'upgrade.subtitle',
          'Unlock the right plan for you: go ad-free with Plus, or get our full power features with Premium.'
        )}
      </Text>

      {hasScheduledDowngrade && (
        <Alert color="orange" variant="light" title={t('upgrade.scheduleBanner.title', 'Subscription will end')}>
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
            {t('upgrade.scheduleBanner.keepPlanCta', `Keep ${isPlus ? 'Plus' : 'Premium'}`)}
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

      {/* Monthly / Annual emphasis toggle */}
      <Group justify="flex-start">
        <SegmentedControl
          value={billingCycle}
          onChange={setBillingCycle}
          data={[
            { label: t('upgrade.toggle.monthly', 'Monthly'), value: 'monthly' },
            { label: t('upgrade.toggle.annual', 'Annual (Save 25%)'), value: 'annual' },
          ]}
        />
      </Group>

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
        {/* Free */}
        <PlanCard
          testId="plan-free"
          title={t('upgrade.plans.free.title', 'Free')}
          price={t('upgrade.plans.free.price', '$0')}
          description={t('upgrade.plans.free.desc', 'Start messaging for free.')}
          features={[
            t('upgrade.plans.free.features.msg', '1:1 and group messaging'),
            t('upgrade.plans.free.features.aiBasic', 'Basic AI replies'),
            t('upgrade.plans.free.features.attachments', 'Standard attachments'),
          ]}
          icon={<MessageSquare size={18} />}
          cta={
            isFree
              ? t('upgrade.plans.free.ctaCurrent', 'Current Plan')
              : t('upgrade.plans.free.ctaUnavailable', 'Switch to Free (not available)')
          }
          ariaLabel={t('upgrade.plans.free.aria', 'Free plan (current)')}
          onClick={() => {}}
          disabled={!isPaid}
        />

        {/* Plus (Ad-free) */}
        <PlanCard
          testId="plan-plus"
          title={t('upgrade.plans.plus.title', 'Plus')}
          price={labelPlus}
          description={t('upgrade.plans.plus.desc', 'Most affordable ad-free experience.')}
          features={[
            t('upgrade.plans.plus.features.noAds', 'Remove all ads'),
            t('upgrade.plans.plus.features.msg', '1:1 and group messaging'),
            t('upgrade.plans.plus.features.attachments', 'Larger attachments'),
            t('upgrade.plans.plus.features.aiBasic', 'Basic AI replies'),
          ]}
          badge={!isPremium && !isPlus ? t('upgrade.plans.plus.badge', 'Popular') : undefined}
          badgeColor="orange"
          icon={<Ban size={18} />}
          cta={ctaPlus}
          ariaLabel={t('upgrade.plans.plus.aria', 'Upgrade to Plus')}
          onClick={() =>
            isAuthed
              ? (isPlus || isPremium)
                ? openBillingPortal()
                : startCheckout(qPlus?.stripePriceId || 'PLUS_MONTHLY')
              : navigate('/login?next=/upgrade')
          }
          loading={isAuthed ? (isPlus || isPremium ? loadingPortal : loadingCheckout) : false}
        />

        {/* Premium — Monthly */}
        <PlanCard
          testId="plan-premium-monthly"
          title={t('upgrade.plans.premiumMonthly.title', 'Premium (Monthly)')}
          price={labelPremMonthly}
          description={t('upgrade.plans.premiumMonthly.desc', 'Full features, ringtones, and AI power tools.')}
          features={[
            t('upgrade.plans.premiumMonthly.features.plusAll', 'Everything in Plus'),
            t('upgrade.plans.premiumMonthly.features.ringtones', 'Custom ringtones & message tones'),
            t('upgrade.plans.premiumMonthly.features.powerAi', 'Power AI features'),
            t('upgrade.plans.premiumMonthly.features.priorityUpdates', 'Priority updates'),
            t('upgrade.plans.premiumMonthly.features.backups', 'Backups & device syncing'),
          ]}
          highlight={billingCycle === 'monthly'}
          tint={billingCycle === 'monthly'}
          tintColor="yellow"
          badge={t('upgrade.plans.premiumMonthly.badge', 'Best value')}
          badgeColor="yellow"
          icon={<Star size={18} />}
          cta={ctaPremMonthly}
          ariaLabel={t('upgrade.plans.premiumMonthly.aria', 'Upgrade to Premium Monthly')}
          onClick={() =>
            isAuthed
              ? (isPremium ? openBillingPortal() : startCheckout(qPremMonthly?.stripePriceId || 'PREMIUM_MONTHLY'))
              : navigate('/login?next=/upgrade')
          }
          loading={isAuthed ? (isPremium ? loadingPortal : loadingCheckout) : false}
        />

        {/* Premium — Annual */}
        <PlanCard
          testId="plan-premium-annual"
          title={t('upgrade.plans.premiumAnnual.title', 'Premium (Annual)')}
          price={labelPremAnnual}
          description={t('upgrade.plans.premiumAnnual.desc', 'Save more when billed yearly.')}
          features={[
            t('upgrade.plans.premiumAnnual.features.allPremium', 'Everything in Premium'),
            t('upgrade.plans.premiumAnnual.features.annualBilling', 'Billed annually'),
            t('upgrade.plans.premiumAnnual.features.save25', 'Save ~25% vs monthly'),
            t('upgrade.plans.premiumAnnual.features.sameFeatures', 'Same features as Monthly'),
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
              ? startCheckout(qPremAnnual?.stripePriceId || 'PREMIUM_ANNUAL')
              : navigate('/login?next=/upgrade')
          }
          loading={isAuthed ? loadingCheckout : false}
          footer={
            <Text size="xs" c="dimmed" mt="xs">
              {t('upgrade.plans.premiumAnnual.disclaimer', 'Billed upfront. Cancel anytime. No hidden fees.')}
            </Text>
          }
        />
      </SimpleGrid>

      {!isAuthed && (
        <Group mt="xs" gap="sm">
          <Button component={Link} to="/login?next=/upgrade">
            {t('upgrade.auth.signIn', 'Sign in')}
          </Button>
          <Button component={Link} to="/register?next=/upgrade" variant="light">
            {t('upgrade.auth.createAccount', 'Create account')}
          </Button>
        </Group>
      )}
    </Stack>
  );
}
