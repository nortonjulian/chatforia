import { useMemo, useState, useEffect } from 'react';
import {
  Affix,
  Transition,
  Button,
  Drawer,
  TextInput,
  Textarea,
  Group,
  Stack,
  SegmentedControl,
  Title,
  Text,
  Badge,
  ScrollArea,
  Divider,
} from '@mantine/core';
import { IconMessageCircle, IconSearch } from '@tabler/icons-react';
import axiosClient from '@/api/axiosClient';
import { useUser } from '@/context/UserContext';
import { useTranslation } from 'react-i18next';

// Keep value identifiers here; labels will be localized inside the component.
const QUICK_TOPICS = [
  { value: 'login', defaultLabel: 'Can’t log in' },
  { value: 'billing', defaultLabel: 'Payments / billing' },
  { value: 'abuse', defaultLabel: 'Report abuse' },
];

export default function SupportWidget({
  excludeRoutes = [],
  placement = { bottom: 20, right: 20 },
}) {
  const { t } = useTranslation();
  const { currentUser } = useUser();

  const [opened, setOpened] = useState(false);
  const [tab, setTab] = useState('help'); // 'help' | 'contact'
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  const [topic, setTopic] = useState('login');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [ok, setOk] = useState('');
  const [err, setErr] = useState('');
  const [diagnosis, setDiagnosis] = useState(null);
  const [stage, setStage] = useState('idle');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState('');

  // Theme-safe CTA label style (fixes Help button + gradient/filled labels)
  const ctaLabelStyles = {
    label: {
      color: 'var(--cta-on)',
      textShadow: 'var(--cta-on-shadow)',
    },
  };

  const shouldHide = useMemo(() => {
    const path = window.location.pathname;
    return excludeRoutes.some((p) => path.startsWith(p));
  }, [excludeRoutes]);

  useEffect(() => {
    if (!opened) {
      setQ('');
      setResults([]);
      setOk('');
      setErr('');
      setMessage('');
    }
  }, [opened]);

  const searchHelp = async () => {
    const query = q.trim();
    if (!query) return;
    setLoading(true);
    try {
      const { data } = await axiosClient.get('/help/search', { params: { q: query } });
      const items = Array.isArray(data) ? data : (data?.results || []);
      setResults(items.slice(0, 8));
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const topicToCategory = {
    login: 'auth_or_verification',
    billing: 'billing_or_premium',
    abuse: 'safety_or_abuse',
  };

  const runSupportAction = async (action) => {
    if (!action) return;

    setActionLoading(true);
    setActionMessage('');
    setErr('');

    try {
      const { data } = await axiosClient.post('/support/actions', {
        action,
        email: currentUser?.email || null,
      });

      if (data?.redirectTo) {
        window.location.href = data.redirectTo;
        return;
      }

      setActionMessage(data?.message || 'Action completed.');
    } catch {
      setErr('Could not complete that action. Please try again.');
    } finally {
      setActionLoading(false);
    }
};

  const submitTicket = async () => {
    const trimmed = message.trim();
    if (!trimmed) return;

    setSubmitting(true);
    setErr('');
    setOk('');
    setDiagnosis(null);
    setStage('diagnosing');

    try {
      // STEP 1: Diagnose first
      const { data } = await axiosClient.post('/support/diagnose', {
        email: currentUser?.email || null,
        message: trimmed,
        categoryHint: topicToCategory[topic] || null,
      });

      setDiagnosis(data);

      // STEP 2: If resolved → STOP here
      if (data?.resolved) {
        setStage('resolved');
        setSubmitting(false);
        return;
      }

      // STEP 3: Escalate (create ticket)
      setStage('escalating');

      await axiosClient.post('/support/tickets', {
        name: currentUser?.username || currentUser?.displayName || 'Chatforia User',
        email: currentUser?.email || '',
        message: trimmed,
        categoryHint: topicToCategory[topic] || null,
        meta: {
          userId: currentUser?.id || null,
          path: window.location.pathname,
          userAgent: navigator.userAgent,
          app: 'web',
          version: import.meta.env?.VITE_APP_VERSION || 'web',
        },
      });

      setOk('We couldn’t resolve this automatically. Our team will follow up.');
      setMessage('');
    } catch (e) {
      setErr('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
};

  if (shouldHide) return null;

  // Localized quick topics with hardcoded fallbacks
  const localizedQuickTopics = QUICK_TOPICS.map(({ value, defaultLabel }) => ({
    value,
    label: t(`support.quickTopics.${value}`, defaultLabel),
  }));

  return (
    <>
      {/* FAB */}
      <Affix position={placement}>
        <Transition mounted={!opened} transition="slide-up" duration={180} timingFunction="ease-out">
          {(styles) => (
            <Button
              leftSection={<IconMessageCircle size={16} />}
              style={styles}
              radius="xl"
              onClick={() => setOpened(true)}
              aria-label={t('support.openSupportAria', 'Open support')}
              styles={ctaLabelStyles}
            >
              {t('support.helpFab', 'Help')}
            </Button>
          )}
        </Transition>
      </Affix>

      {/* Drawer / Sheet */}
      <Drawer
        opened={opened}
        onClose={() => setOpened(false)}
        position="right"
        size="md"
        withCloseButton
        closeOnEscape
        closeOnClickOutside
        title={
          <Group gap="xs">
            <Badge variant="light">{t('support.badge', 'Support')}</Badge>
            <Title order={4} m={0}>
              {t('support.heading', 'How can we help?')}
            </Title>
          </Group>
        }
        overlayProps={{ opacity: 0.55, blur: 2 }}
        radius="lg"
      >
        <Stack gap="md">
          <SegmentedControl
            value={tab}
            onChange={setTab}
            data={[
              { label: t('support.tabs.help', 'Help Center'), value: 'help' },
              { label: t('support.tabs.contact', 'Contact us'), value: 'contact' },
            ]}
          />

          {tab === 'help' ? (
            <Stack gap="sm">
              <Group wrap="nowrap">
                <TextInput
                  placeholder={t('support.searchPlaceholder', 'Search help articles…')}
                  leftSection={<IconSearch size={16} />}
                  value={q}
                  onChange={(e) => setQ(e.currentTarget.value)}
                  onKeyDown={(e) => e.key === 'Enter' && searchHelp()}
                  style={{ flex: 1 }}
                  aria-label={t('support.searchAria', 'Search help')}
                />
                <Button onClick={searchHelp} loading={loading} styles={ctaLabelStyles}>
                  {t('support.searchBtn', 'Search')}
                </Button>
              </Group>

              <Divider label={t('support.quickTopicsLabel', 'Quick topics')} labelPosition="center" />

              <Group gap="xs" wrap="wrap">
                {localizedQuickTopics.map((tItem) => (
                  <Button
                    key={tItem.value}
                    size="xs"
                    variant={topic === tItem.value ? 'filled' : 'light'}
                    onClick={() => {
                      setTopic(tItem.value);
                      setTab('contact');
                    }}
                    styles={topic === tItem.value ? ctaLabelStyles : undefined}
                  >
                    {tItem.label}
                  </Button>
                ))}
              </Group>

              <ScrollArea.Autosize mah={280}>
                <Stack gap="xs">
                  {results.length === 0 && !loading ? (
                    <Text c="dimmed" size="sm">
                      {t('support.trySearching', 'Try searching for “translate”, “backups”, or “privacy”.')}
                    </Text>
                  ) : (
                    results.map((r, i) => (
                      <Stack
                        key={i}
                        gap={2}
                        p="xs"
                        style={{ border: '1px solid var(--border)', borderRadius: 8 }}
                      >
                        <Text fw={600}>{r.title || t('support.article', 'Article')}</Text>
                        <Text size="sm" c="dimmed" lineClamp={3}>
                          {r.snippet || r.excerpt || ''}
                        </Text>
                        {r.url && (
                          <Button
                            component="a"
                            href={r.url}
                            target="_blank"
                            variant="subtle"
                            size="xs"
                          >
                            {t('support.openArticle', 'Open article')}
                          </Button>
                        )}
                      </Stack>
                    ))
                  )}
                </Stack>
              </ScrollArea.Autosize>
            </Stack>
          ) : (
            <Stack gap="sm">
              <Text size="sm" c="dimmed">
                {t(
                  'support.contactIntro',
                  'We’ll try to resolve this instantly. If not, our team will follow up.'
                )}
              </Text>

              <SegmentedControl
                value={topic}
                onChange={setTopic}
                data={localizedQuickTopics}
                aria-label={t('support.topicAria', 'Select a topic')}
              />

              <Textarea
                placeholder={t('support.messagePlaceholder', 'Write your message…')}
                minRows={6}
                value={message}
                onChange={(e) => setMessage(e.currentTarget.value)}
              />

              {stage === 'diagnosing' && (
                <Text size="sm" c="dimmed">
                  Analyzing your issue...
                </Text>
              )}

              {diagnosis && (
                <Stack gap={4} mt="xs">
                  <Text fw={500}>{diagnosis.message}</Text>

                  {diagnosis.nextAction && (
                    <Text size="sm" c="dimmed">
                      {diagnosis.nextAction}
                    </Text>
                  )}
                </Stack>
              )}

              {diagnosis?.autoAction &&
                diagnosis.autoAction !== 'no_action_needed' &&
                diagnosis.autoAction !== 'queue_for_support_review' && (
                  <Button
                    size="xs"
                    variant="light"
                    loading={actionLoading}
                    onClick={() => runSupportAction(diagnosis.autoAction)}
                  >
                    Take recommended action
                  </Button>
                )}

              {actionMessage && (
                <Text size="sm" c="green">
                  {actionMessage}
                </Text>
              )}

              <Group justify="flex-end">
                <Button
                  onClick={submitTicket}
                  loading={submitting}
                  disabled={!message.trim()}
                  styles={ctaLabelStyles}
                >
                  {t('support.sendBtn', 'Send')}
                </Button>
              </Group>

              {stage === 'resolved' && (
                <Text c="green">
                  Issue resolved instantly — no ticket needed.
                </Text>
              )}

              {stage === 'escalating' && (
                <Text c="yellow">
                  Escalating to support...
                </Text>
              )}

              {ok && <Text c="green">{ok}</Text>}
              {err && <Text c="red">{err}</Text>}
            </Stack>
          )}
        </Stack>
      </Drawer>
    </>
  );
}
