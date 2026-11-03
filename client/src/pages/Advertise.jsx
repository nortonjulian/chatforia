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
import { PLACEMENT_CONFIG } from '@/ads/placements';
import axiosClient from '@/api/axiosClient';
import { toast } from '@/utils/toast';
import { openAdvertisingEmailDraft } from '@/utils/openAdvertisingEmailDraft';
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
      return Object.entries(PLACEMENT_CONFIG)
        .filter(([, cfg]) => !cfg.houseOnly)
        .map(([key, cfg]) => {
          const sizes = Array.isArray(cfg?.sizes) ? cfg.sizes : [];
          // normalize sizes -> "WxH"
          const pretty = sizes.map((s) =>
            Array.isArray(s) ? `${s[0]}x${s[1]}` : String(s)
          );
          return {
            id: key,
            sizes: pretty,
            label: key.replaceAll('_', ' '),
          };
        })
        // Only show placements that actually have configured sizes
        .filter((p) => p.sizes.length > 0);
    } catch {
      return [];
    }
  }, []);


  async function submit(event) {
    event.preventDefault();
    if (submitting) return;
    const inquiry = Object.fromEntries(
      Object.entries(contact).map(([key, value]) => [key, value.trim()])
    );
    if (!inquiry.name || !inquiry.email || !inquiry.message) {
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
      await axiosClient.post('/ads/inquiries', inquiry);
      setSubmitted(true);
      toast.ok(
        t('advertise.form.successToast', "Thanks! We’ll be in touch soon.")
      );
    } catch (e) {
      // Fallback: open a mailto prefilled with the form content
      const body =
        `Name: ${inquiry.name}\n` +
        `Email: ${inquiry.email}\n` +
        `Company: ${inquiry.company}\n` +
        `Budget: ${inquiry.budget}\n\n` +
        `${inquiry.message}`;
      const mail = `mailto:ads@chatforia.com?subject=Advertising%20Inquiry&body=${encodeURIComponent(
        body
      )}`;
      openAdvertisingEmailDraft(mail);
      // Opening a mail client does not mean the user sent the inquiry.
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
        <Title order={1}>
          {t('advertise.title', 'Advertise with Chatforia')}
        </Title>

        <Text c="dimmed">
          {t(
            'advertise.campaignIntro',
            'Discuss display advertising opportunities with Chatforia. Placement availability depends on platform, screen size, and campaign requirements.'
          )}
        </Text>

        {/* Programmatic / AdSense note */}
        <Alert
          icon={<IconInfoCircle size={16} />}
          color="blue"
          variant="light"
        >
          {t('advertise.availabilityNote', 'Tell us your campaign goals, dates, and budget. We will confirm available placements and specifications before any booking.')}
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
                    <Text fw={600}>{p.label}</Text>
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
            {t('advertise.planningHeader', 'Plan your campaign')}
          </Title>

          <List
            spacing="xs"
            icon={<IconCheck size={14} />}
            withPadding
            size="sm"
          >
            <List.Item>
              {t(
                'advertise.why.campaignGoals',
                'Share your audience and campaign goals'
              )}
            </List.Item>
            <List.Item>
              {t(
                'advertise.why.creativeReview',
                'Discuss creative requirements and placement fit'
              )}
            </List.Item>
            <List.Item>
              {t(
                'advertise.why.confirmAvailability',
                'Confirm availability before planning a launch'
              )}
            </List.Item>
            <List.Item>
              {t(
                'advertise.why.directContact',
                'Contact our advertising team for campaign details'
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
          <Card component="form" onSubmit={submit} withBorder radius="lg" p="md">
            <Stack gap="sm">
              <Group grow wrap="wrap">
                <TextInput
                  label={t('advertise.form.nameLabel', 'Your name')}
                  placeholder={t(
                    'advertise.form.namePlaceholder',
                    'Jane Doe'
                  )}
                  value={contact.name}
                  onChange={(e) => {
                    const value = e.currentTarget.value;
                    setContact((c) => ({
                      ...c,
                      name: value,
                    }));
                  }}
                  required
                />

                <TextInput
                  label={t('advertise.form.emailLabel', 'Email')}
                  placeholder={t(
                    'advertise.form.emailPlaceholder',
                    'you@company.com'
                  )}
                  value={contact.email}
                  onChange={(e) => {
                    const value = e.currentTarget.value;
                    setContact((c) => ({
                      ...c,
                      email: value,
                    }));
                  }}
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
                  onChange={(e) => {
                    const value = e.currentTarget.value;
                    setContact((c) => ({
                      ...c,
                      company: value,
                    }));
                  }}
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
                  onChange={(e) => {
                    const value = e.currentTarget.value;
                    setContact((c) => ({
                      ...c,
                      budget: value,
                    }));
                  }}
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
                onChange={(e) => {
                    const value = e.currentTarget.value;
                    setContact((c) => ({
                      ...c,
                      message: value,
                    }));
                  }}
                required
              />

              <Group justify="space-between" mt="xs">
                <Anchor href="mailto:ads@chatforia.com">
                  <Group gap={6}>
                    <IconMail size={16} /> ads@chatforia.com
                  </Group>
                </Anchor>

                <Button type="submit" loading={submitting} radius="xl" disabled={!contact.name.trim() || !contact.email.trim() || !contact.message.trim()}>
                  {t('advertise.form.sendCta', 'Send inquiry')}
                </Button>
              </Group>
            </Stack>
          </Card>
        )}

        <Text size="xs" c="dimmed" ta="center">
          {t('advertise.legal.disclaimerStart', 'By submitting, you agree to our')}{' '}
          <Anchor href="/legal/terms" target="_blank">
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
