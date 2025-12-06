import { useMemo, useState } from 'react';
import {
  Paper,
  Title,
  Text,
  Stack,
  Group,
  Card,
  Badge,
  List,
  Grid,
  Anchor,
  Button,
  TextInput,
  Textarea,
  Divider,
  Alert,
} from '@mantine/core';
import { IconMail, IconInfoCircle, IconCheck } from '@tabler/icons-react';
import { PLACEMENTS } from '@/ads/placements';
import axiosClient from '@/api/axiosClient';
import { toast } from '@/utils/toast';
import { useTranslation } from 'react-i18next';

export default function Advertise() {
  const { t } = useTranslation();

  const [contact, setContact] = useState({
    name: '',
    email: '',
    company: '',
    budget: '',
    message: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // Pull sizes from your declared placements for a quick spec table
  const placementSpecs = useMemo(() => {
    try {
      return Object.entries(PLACEMENTS)
        .map(([key, cfg]) => {
          const sizes = Array.isArray(cfg?.sizes) ? cfg.sizes : [];
          // normalize sizes -> "WxH"
          const pretty = sizes.map((s) =>
            Array.isArray(s) ? `${s[0]}x${s[1]}` : String(s)
          );
          return {
            id: key,
            sizes: pretty,
            adsenseSlot: cfg?.adsenseSlot || null,
          };
        })
        // Only show placements that actually have configured sizes
        .filter((p) => p.sizes.length > 0);
    } catch {
      return [];
    }
  }, []);

  const pubId = import.meta.env.VITE_ADSENSE_PUB_ID || null;

  async function submit() {
    if (!contact.name || !contact.email || !contact.message) {
      toast.err(
        t(
          'advertise.form.missingRequired',
          'Please fill in name, email, and message.'
        )
      );
      return;
    }
    setSubmitting(true);
    try {
      // Preferred: send to your server
      await axiosClient.post('/ads/inquiries', contact);
      setSubmitted(true);
      toast.ok(
        t('advertise.form.successToast', "Thanks! We’ll be in touch soon.")
      );
    } catch (e) {
      // Fallback: open a mailto prefilled with the form content
      const body =
        `Name: ${contact.name}\n` +
        `Email: ${contact.email}\n` +
        `Company: ${contact.company}\n` +
        `Budget: ${contact.budget}\n\n` +
        `${contact.message}`;
      const mail = `mailto:ads@chatforia.com?subject=Advertising%20Inquiry&body=${encodeURIComponent(
        body
      )}`;
      window.location.href = mail;
      setSubmitted(true);
      toast.info(
        t(
          'advertise.form.mailtoInfo',
          'Opening your email client to send the inquiry…'
        )
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Paper withBorder shadow="sm" radius="xl" p="lg" maw={880} mx="auto">
      <Stack gap="md">
        <Title order={2}>
          {t('advertise.title', 'Advertise with Chatforia')}
        </Title>

        <Text c="dimmed">
          {t(
            'advertise.description',
            'Reach engaged messaging users with tasteful, brand-safe placements. We offer banner inventory in high-visibility spots, sponsorships, and house promos. Premium subscribers do not see ads.'
          )}
        </Text>

        {/* Programmatic / AdSense note */}
        <Alert
          icon={<IconInfoCircle size={16} />}
          color="blue"
          variant="light"
        >
          {pubId
            ? t(
                'advertise.adsense.withPubIdShort',
                'We also serve inventory via Google AdSense. You can target Chatforia with publisher ID {{pubId}}, or use the form below for direct sponsorships.'
              ).replace('{{pubId}}', pubId)
            : t(
                'advertise.adsense.noPubIdShort',
                'We also serve some inventory via Google AdSense. Direct sponsorships are available—use the form below.'
              )}
        </Alert>

        <Divider
          label={t('advertise.inventoryHeader', 'Inventory & Specs')}
          labelPosition="center"
        />

        <Grid gutter="md">
          {placementSpecs.length ? (
            placementSpecs.map((p) => (
              <Grid.Col key={p.id} span={{ base: 12, sm: 6 }}>
                <Card withBorder radius="lg" p="md">
                  <Group justify="space-between" align="flex-start" mb="xs">
                    <Text fw={600}>{p.id}</Text>
                    <Badge variant="light">
                      {t('advertise.placement.displayBadge', 'Display')}
                    </Badge>
                  </Group>

                  <Text size="sm" c="dimmed">
                    {t(
                      'advertise.placement.acceptedSizes',
                      'Accepted sizes'
                    )}
                  </Text>

                  <Group gap="xs" mt={6} wrap="wrap">
                    {p.sizes.map((s) => (
                      <Badge key={s} variant="outline">
                        {s}
                      </Badge>
                    ))}
                  </Group>

                  {p.adsenseSlot && (
                    <Text size="xs" mt="sm" c="dimmed">
                      {t(
                        'advertise.placement.adsenseSlot',
                        'AdSense slot:'
                      )}{' '}
                      <code>{p.adsenseSlot}</code>
                    </Text>
                  )}
                </Card>
              </Grid.Col>
            ))
          ) : (
            <Grid.Col span={12}>
              <Text c="dimmed">
                {t(
                  'advertise.noPlacementsPublic',
                  'We’re finalizing our ad inventory. Tell us about your campaign and we’ll recommend placements.'
                )}
              </Text>
            </Grid.Col>
          )}
        </Grid>

        <Card withBorder radius="lg" p="md">
          <Title order={4} mb="xs">
            {t('advertise.whyHeader', 'Why Chatforia?')}
          </Title>

          <List
            spacing="xs"
            icon={<IconCheck size={14} />}
            withPadding
            size="sm"
          >
            <List.Item>
              {t(
                'advertise.why.highSession',
                'High session frequency and dwell time in chat UI'
              )}
            </List.Item>
            <List.Item>
              {t(
                'advertise.why.brandSafe',
                'Brand-safe formats; respectful frequency capping'
              )}
            </List.Item>
            <List.Item>
              {t(
                'advertise.why.sponsoredMoments',
                'Sponsored moments (e.g., “Start a Chat” modal) available'
              )}
            </List.Item>
            <List.Item>
              {t(
                'advertise.why.deals',
                'Direct deals or programmatic via AdSense/Google Ads'
              )}
            </List.Item>
          </List>
        </Card>

        <Divider
          label={t('advertise.contactHeader', 'Contact')}
          labelPosition="center"
        />

        {submitted ? (
          <Alert color="green" variant="light">
            {t(
              'advertise.form.submittedMsg',
              'Thanks! Your inquiry is on its way. We’ll follow up shortly.'
            )}
          </Alert>
        ) : (
          <Card withBorder radius="lg" p="md">
            <Stack gap="sm">
              <Group grow wrap="wrap">
                <TextInput
                  label={t('advertise.form.nameLabel', 'Your name')}
                  placeholder={t(
                    'advertise.form.namePlaceholder',
                    'Jane Doe'
                  )}
                  value={contact.name}
                  onChange={(e) =>
                    setContact((c) => ({
                      ...c,
                      name: e.currentTarget.value,
                    }))
                  }
                  required
                />

                <TextInput
                  label={t('advertise.form.emailLabel', 'Email')}
                  placeholder={t(
                    'advertise.form.emailPlaceholder',
                    'you@company.com'
                  )}
                  value={contact.email}
                  onChange={(e) =>
                    setContact((c) => ({
                      ...c,
                      email: e.currentTarget.value,
                    }))
                  }
                  required
                  type="email"
                />
              </Group>

              <Group grow wrap="wrap">
                <TextInput
                  label={t('advertise.form.companyLabel', 'Company')}
                  placeholder={t(
                    'advertise.form.companyPlaceholder',
                    'Acme Inc.'
                  )}
                  value={contact.company}
                  onChange={(e) =>
                    setContact((c) => ({
                      ...c,
                      company: e.currentTarget.value,
                    }))
                  }
                />

                <TextInput
                  label={t(
                    'advertise.form.budgetLabel',
                    'Monthly budget (optional)'
                  )}
                  placeholder={t(
                    'advertise.form.budgetPlaceholder',
                    'e.g. $1,000–$20,000+'
                  )}
                  value={contact.budget}
                  onChange={(e) =>
                    setContact((c) => ({
                      ...c,
                      budget: e.currentTarget.value,
                    }))
                  }
                />
              </Group>

              <Textarea
                label={t(
                  'advertise.form.messageLabel',
                  'Tell us about your campaign'
                )}
                placeholder={t(
                  'advertise.form.messagePlaceholder',
                  'Targeting, dates, KPIs, placement preferences…'
                )}
                minRows={4}
                value={contact.message}
                onChange={(e) =>
                  setContact((c) => ({
                    ...c,
                    message: e.currentTarget.value,
                  }))
                }
                required
              />

              <Group justify="space-between" mt="xs">
                <Anchor href="mailto:ads@chatforia.com">
                  <Group gap={6}>
                    <IconMail size={16} /> ads@chatforia.com
                  </Group>
                </Anchor>

                <Button loading={submitting} onClick={submit}>
                  {t('advertise.form.sendCta', 'Send inquiry')}
                </Button>
              </Group>
            </Stack>
          </Card>
        )}

        <Text size="xs" c="dimmed" ta="center">
          {t('advertise.legal.disclaimerStart', 'By submitting, you agree to our')}{' '}
          <Anchor href="/terms" target="_blank">
            {t('advertise.legal.terms', 'Terms')}
          </Anchor>{' '}
          {t('advertise.legal.and', 'and')}{' '}
          <Anchor href="/privacy" target="_blank">
            {t('advertise.legal.privacy', 'Privacy Policy')}
          </Anchor>
          {'.'}
        </Text>
      </Stack>
    </Paper>
  );
}
