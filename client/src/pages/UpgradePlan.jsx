import { useState } from 'react';
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
} from '@mantine/core';
import axiosClient from '../api/axiosClient';
import { useUser } from '../context/UserContext';
import { Link, useNavigate } from 'react-router-dom';

import { useTranslation } from 'react-i18next';

function PlanCard({
  title,
  price,
  features = [],
  cta,
  onClick,
  highlight = false,
  disabled = false,
  loading = false,
  badge,
  testId,
}) {
  const { t } = useTranslation();

  return (
    <Card
      withBorder
      radius="xl"
      shadow={highlight ? 'md' : 'sm'}
      p="lg"
      data-testid={testId}
    >
      <Stack gap="xs">
        <Group justify="space-between" align="center">
          <Title order={3}>{title}</Title>
          {badge && <Badge color="yellow">{badge}</Badge>}
        </Group>

        <Title order={2}>{price}</Title>

        <Stack gap={4}>
          {features.map((f) => (
            <Text key={f} size="sm">
              • {f}
            </Text>
          ))}
        </Stack>

        <Button
          mt="sm"
          onClick={onClick}
          disabled={disabled || loading}
          loading={loading}
          aria-busy={loading ? 'true' : 'false'}
        >
          {cta}
        </Button>
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

  const startCheckout = async (plan) => {
    if (!isAuthed) return navigate('/login?next=/upgrade');
    try {
      setLoadingCheckout(true);
      const { data } = await axiosClient.post('/billing/checkout', { plan });
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

  return (
    <Stack gap="lg" maw={900} mx="auto" p="md">
      <Title order={2}>
        {t('upgrade.title', 'Upgrade')}
      </Title>

      <Text c="dimmed">
        {t(
          'upgrade.subtitle',
          'Unlock the right plan for you: go ad-free with Plus, or get our full power features with Premium.'
        )}
      </Text>

      {/* Scheduled downgrade banner */}
      {hasScheduledDowngrade && (
        <Alert
          color="orange"
          variant="light"
          title={t(
            'upgrade.scheduleBanner.title',
            'Subscription will end'
          )}
        >
          {t(
            'upgrade.scheduleBanner.body',
            'You’ll revert to Free on'
          )}{' '}
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
            {t(
              'upgrade.scheduleBanner.manageBillingCta',
              'Manage billing'
            )}
          </Button>
        </Alert>
      )}

      {/* 2×2 grid: Free / Plus / Premium Monthly / Premium Annual */}
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
        {/* Free */}
        <PlanCard
          testId="plan-free"
          title={t('upgrade.plans.free.title', 'Free')}
          price={t('upgrade.plans.free.price', '$0')}
          features={[
            t(
              'upgrade.plans.free.features.msg',
              '1:1 and group messaging'
            ),
            t(
              'upgrade.plans.free.features.aiBasic',
              'Basic AI replies'
            ),
            t(
              'upgrade.plans.free.features.attachments',
              'Standard attachments'
            ),
          ]}
          cta={
            isFree
              ? t(
                  'upgrade.plans.free.ctaCurrent',
                  'Current Plan'
                )
              : t(
                  'upgrade.plans.free.ctaUnavailable',
                  'Switch to Free (not available)'
                )
          }
          onClick={() => {}}
          disabled={!isPaid}
        />

        {/* Plus (Ad-free) */}
        <PlanCard
          testId="plan-plus"
          title={t('upgrade.plans.plus.title', 'Plus')}
          price={t('upgrade.plans.plus.price', '$4.99 / mo')}
          features={[
            t(
              'upgrade.plans.plus.features.noAds',
              'Remove all ads'
            ),
            t(
              'upgrade.plans.plus.features.msg',
              '1:1 and group messaging'
            ),
            t(
              'upgrade.plans.plus.features.attachments',
              'Larger attachments'
            ),
            t(
              'upgrade.plans.plus.features.aiBasic',
              'Basic AI replies'
            ),
          ]}
          badge={
            !isPremium && !isPlus
              ? t('upgrade.plans.plus.badge', 'Popular')
              : undefined
          }
          cta={
            isAuthed
              ? isPlus || isPremium
                ? (loadingPortal
                    ? t(
                        'upgrade.billing.opening',
                        'Opening…'
                      )
                    : t(
                        'upgrade.billing.manage',
                        'Manage Billing'
                      ))
                : (loadingCheckout
                    ? t(
                        'upgrade.checkout.redirecting',
                        'Redirecting…'
                      )
                    : t(
                        'upgrade.plans.plus.cta',
                        'Go Ad-Free'
                      ))
              : t('upgrade.auth.continue', 'Continue')
          }
          onClick={() =>
            isAuthed
              ? isPlus || isPremium
                ? openBillingPortal()
                : startCheckout('PLUS_MONTHLY')
              : navigate('/login?next=/upgrade')
          }
          loading={
            isAuthed
              ? isPlus || isPremium
                ? loadingPortal
                : loadingCheckout
              : false
          }
        />

        {/* Premium — Monthly */}
        <PlanCard
          testId="plan-premium-monthly"
          title={t(
            'upgrade.plans.premiumMonthly.title',
            'Premium (Monthly)'
          )}
          price={t(
            'upgrade.plans.premiumMonthly.price',
            '$24.99 / mo'
          )}
          features={[
            t(
              'upgrade.plans.premiumMonthly.features.plusAll',
              'Everything in Plus'
            ),
            t(
              'upgrade.plans.premiumMonthly.features.ringtones',
              'Custom ringtones & message tones'
            ),
            t(
              'upgrade.plans.premiumMonthly.features.powerAi',
              'Power AI features'
            ),
            t(
              'upgrade.plans.premiumMonthly.features.priorityUpdates',
              'Priority updates'
            ),
            t(
              'upgrade.plans.premiumMonthly.features.backups',
              'Backups & device syncing'
            ),
          ]}
          highlight
          badge={t('upgrade.plans.premiumMonthly.badge', 'Best value')}
          cta={
            isAuthed
              ? isPremium
                ? (loadingPortal
                    ? t(
                        'upgrade.billing.opening',
                        'Opening…'
                      )
                    : t(
                        'upgrade.billing.manage',
                        'Manage Billing'
                      ))
                : (loadingCheckout
                    ? t(
                        'upgrade.checkout.redirecting',
                        'Redirecting…'
                      )
                    : t(
                        'upgrade.plans.premiumMonthly.cta',
                        'Upgrade (Monthly)'
                      ))
              : t('upgrade.auth.continue', 'Continue')
          }
          onClick={() =>
            isAuthed
              ? isPremium
                ? openBillingPortal()
                : startCheckout('PREMIUM_MONTHLY')
              : navigate('/login?next=/upgrade')
          }
          loading={
            isAuthed
              ? isPremium
                ? loadingPortal
                : loadingCheckout
              : false
          }
        />

        {/* Premium — Annual */}
        <PlanCard
          testId="plan-premium-annual"
          title={t(
            'upgrade.plans.premiumAnnual.title',
            'Premium (Annual)'
          )}
          price={t(
            'upgrade.plans.premiumAnnual.price',
            '$225 / year'
          )}
          features={[
            t(
              'upgrade.plans.premiumAnnual.features.allPremium',
              'Everything in Premium'
            ),
            t(
              'upgrade.plans.premiumAnnual.features.annualBilling',
              'Billed annually'
            ),
            t(
              'upgrade.plans.premiumAnnual.features.save25',
              'Save ~25% vs monthly'
            ),
            t(
              'upgrade.plans.premiumAnnual.features.sameFeatures',
              'Same features as Monthly'
            ),
          ]}
          badge={t('upgrade.plans.premiumAnnual.badge', 'Save 25%')}
          cta={
            isAuthed
              ? isPremium
                ? (loadingPortal
                    ? t(
                        'upgrade.billing.opening',
                        'Opening…'
                      )
                    : t(
                        'upgrade.billing.manage',
                        'Manage Billing'
                      ))
                : (loadingCheckout
                    ? t(
                        'upgrade.checkout.redirecting',
                        'Redirecting…'
                      )
                    : t(
                        'upgrade.plans.premiumAnnual.cta',
                        'Upgrade (Annual)'
                      ))
              : t('upgrade.auth.continue', 'Continue')
          }
          onClick={() =>
            isAuthed
              ? startCheckout('PREMIUM_ANNUAL')
              : navigate('/login?next=/upgrade')
          }
          loading={isAuthed ? loadingCheckout : false}
        />
      </SimpleGrid>

      {!isAuthed && (
        <Group mt="xs" gap="sm">
          <Button
            component={Link}
            to="/register?next=/upgrade"
            variant="light"
          >
            {t('upgrade.auth.createAccount', 'Create account')}
          </Button>
          <Button
            component={Link}
            to="/login?next=/upgrade"
            variant="subtle"
          >
            {t('upgrade.auth.signIn', 'Sign in')}
          </Button>
        </Group>
      )}
    </Stack>
  );
}
