import { useMemo, useState } from 'react';
import {
  Paper, Title, Stack, Group, Text, Button, Switch,
  NumberInput, Select, TextInput, Alert, Divider
} from '@mantine/core';
import { DateTimePicker } from '@mantine/dates';
import { useUser } from '@/context/UserContext';
import axiosClient from '@/api/axiosClient';
import PremiumGuard from '@/components/PremiumGuard';
import { setPref, PREF_SMART_REPLIES } from '@/utils/prefsStore';
import { useTranslation } from 'react-i18next';

export default function AISettings() {
  const { t } = useTranslation();
  const { currentUser, setCurrentUser } = useUser();
  const [status, setStatus] = useState({ kind: '', msg: '' });
  const u = currentUser || {};

  // local state mirrors user preferences
  const [enableSmartReplies, setEnableSmartReplies] = useState(!!u.enableSmartReplies);
  const [aiFilterProfanity, setAiFilterProfanity] = useState(!!u.aiFilterProfanity);
  const [showOriginalWithTranslation, setShowOriginalWithTranslation] = useState(
    u.showOriginalWithTranslation ?? true
  );
  const [autoTranslateMode, setAutoTranslateMode] = useState(
    (u.autoTranslateMode || 'off').toLowerCase()
  );

  // Auto-responder (ForiaBot)
  const [enableAIResponder, setEnableAIResponder] = useState(!!u.enableAIResponder);
  const [autoResponderMode, setAutoResponderMode] = useState(u.autoResponderMode || 'off');
  const [autoResponderCooldownSec, setAutoResponderCooldownSec] = useState(
    Number.isFinite(u.autoResponderCooldownSec) ? u.autoResponderCooldownSec : 120
  );
  const [autoResponderSignature, setAutoResponderSignature] = useState(
    u.autoResponderSignature || '🤖 Auto-reply'
  );
  const initialUntil = useMemo(
    () => (u.autoResponderActiveUntil ? new Date(u.autoResponderActiveUntil) : null),
    [u.autoResponderActiveUntil]
  );
  const [autoResponderActiveUntil, setAutoResponderActiveUntil] = useState(initialUntil);

  // i18n’d select data (memoized so it doesn’t recreate on every render)
  const AUTO_TRANSLATE_OPTIONS = useMemo(
    () => [
      { value: 'off', label: t('aiSettings.translateOff', 'Off') },
      { value: 'tagged', label: t('aiSettings.translateTagged', 'Only when @translated or tagged') },
      { value: 'all', label: t('aiSettings.translateAll', 'Translate all incoming messages') },
    ],
    [t]
  );

  const save = async () => {
    try {
      const payload = {
        enableSmartReplies,
        aiFilterProfanity,
        showOriginalWithTranslation,
        autoTranslateMode: (autoTranslateMode || 'off').toUpperCase(), // OFF|TAGGED|ALL
        enableAIResponder,
        autoResponderMode,
        autoResponderCooldownSec: Number(autoResponderCooldownSec) || 120,
        autoResponderSignature,
        autoResponderActiveUntil: autoResponderActiveUntil
          ? autoResponderActiveUntil.toISOString()
          : null,
      };
      const { data } = await axiosClient.patch(`/users/${u.id}`, payload);
      setCurrentUser((prev) => ({ ...prev, ...payload, ...data }));
      // keep local pref in sync for instant UI reactions
      await setPref(PREF_SMART_REPLIES, enableSmartReplies);
      setStatus({ kind: 'success', msg: t('aiSettings.saved', 'AI preferences saved') });
    } catch (e) {
      console.error(e);
      setStatus({ kind: 'error', msg: t('aiSettings.saveFailed', 'Failed to save AI settings') });
    } finally {
      setTimeout(() => setStatus({ kind: '', msg: '' }), 3000);
    }
  };

  return (
    <Paper withBorder shadow="sm" radius="xl" p="lg">
      <Title order={3} mb="sm">{t('aiSettings.title', 'AI Settings')}</Title>
      <Text size="sm" c="dimmed" mb="md">
        {t('aiSettings.controlIntro', 'Control translation, smart replies, and ForiaBot auto-responses.')}
      </Text>

      <Stack gap="md">
        {/* Translation */}
        <Divider label={t('aiSettings.translation', 'Translation')} labelPosition="center" />
        <Stack gap="xs">
          <Select
            label={t('aiSettings.autoTranslateIncoming', 'Auto-translate incoming messages')}
            value={autoTranslateMode}
            onChange={(v) => v && setAutoTranslateMode(v)}
            data={AUTO_TRANSLATE_OPTIONS}
            withinPortal
          />
          <Switch
            checked={showOriginalWithTranslation}
            onChange={(e) => setShowOriginalWithTranslation(e.currentTarget.checked)}
            label={t('aiSettings.showOriginalAlongside', 'Show original text alongside translation')}
          />
        </Stack>

        {/* Smart Replies */}
        <Divider label={t('aiSettings.smartReplies', 'Smart Replies')} labelPosition="center" />
        <Switch
          checked={enableSmartReplies}
          onChange={(e) => setEnableSmartReplies(e.currentTarget.checked)}
          label={t('aiSettings.enableSmartReplies', 'Enable Smart Replies')}
          description={t('aiSettings.smartRepliesHint', 'Send the last few received messages (sanitized) to AI to suggest quick replies.')}
        />
        <Switch
          checked={aiFilterProfanity}
          onChange={(e) => setAiFilterProfanity(e.currentTarget.checked)}
          label={t('aiSettings.maskProfanity', 'Mask profanity in AI suggestions')}
          description={t('aiSettings.maskProfanityHint', 'If on, suggestions returned by AI will have flagged words masked')}
        />

        {/* Auto-Responder (ForiaBot) */}
        <Divider label={t('aiSettings.foriaBot', 'ForiaBot Auto-Responder')} labelPosition="center" />
        <Switch
          checked={enableAIResponder}
          onChange={(e) => setEnableAIResponder(e.currentTarget.checked)}
          label={t('aiSettings.enableAutoReply', 'Enable auto-reply when I’m busy')}
        />
        <Group grow>
          <Select
            label={t('aiSettings.autoReplyMode', 'Auto-reply mode')}
            value={autoResponderMode}
            onChange={setAutoResponderMode}
            data={[
              { value: 'dm', label: t('aiSettings.modeDm', '1:1 chats only') },
              { value: 'mention', label: t('aiSettings.modeMention', 'Only when I’m @mentioned') },
              { value: 'all', label: t('aiSettings.modeAll', 'All inbound messages') },
              { value: 'off', label: t('aiSettings.off', 'Off') },
            ]}
            disabled={!enableAIResponder}
            withinPortal
          />
          <NumberInput
            label={t('aiSettings.cooldownSeconds', 'Cooldown (seconds)')}
            min={10}
            value={autoResponderCooldownSec}
            onChange={(v) => setAutoResponderCooldownSec(Number(v) || 120)}
            disabled={!enableAIResponder}
          />
        </Group>
        <TextInput
          label={t('aiSettings.signature', 'Signature')}
          value={autoResponderSignature}
          onChange={(e) => setAutoResponderSignature(e.target.value)}
          placeholder={t('aiSettings.autoReply', '🤖 Auto-reply')}
          disabled={!enableAIResponder}
        />
        <DateTimePicker
          label={t('aiSettings.activeUntilOptional', 'Active until (optional)')}
          value={autoResponderActiveUntil}
          onChange={setAutoResponderActiveUntil}
          disabled={!enableAIResponder}
          clearable
        />

        {status.msg && (
          <Alert color={status.kind === 'error' ? 'red' : 'green'} variant="light">
            {status.msg}
          </Alert>
        )}

        <Group justify="flex-end">
          <Button onClick={save}>{t('aiSettings.save', 'Save AI Settings')}</Button>
        </Group>

        <PremiumGuard variant="inline" silent />
      </Stack>
    </Paper>
  );
}
