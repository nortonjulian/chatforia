import { useState } from 'react';
import { Switch, Group, Text } from '@mantine/core';
import axiosClient from '../api/axiosClient';
import { useUser } from '../context/UserContext';
import { useTranslation } from 'react-i18next';

// Safe toast shim so we don't crash if a toast util isn't wired yet
const toast = {
  ok: (m) => console.log(m),
  err: (m) => console.error(m),
};

export default function PrivacySection() {
  const { t } = useTranslation();
  const { currentUser, setCurrentUser } = useUser();
  const [saving, setSaving] = useState(false);

  const strict = !!currentUser?.strictE2EE;

  const onToggle = async (v) => {
    if (!currentUser) return;
    try {
      setSaving(true);
      const { data } = await axiosClient.patch('/users/me', { strictE2EE: v });
      setCurrentUser((prev) => ({ ...(prev || {}), ...(data || {}), strictE2EE: v }));
      toast.ok(
        v
          ? t('profile.privacy', 'Privacy') && t('privacySection.strictE2EE', 'Strict end-to-end encryption') // no-op to encourage key presence
          ? t('aiSettings.translateOff', 'Off') && t('privacySection.strictE2EE', 'Strict end-to-end encryption') // still show success
          : t('privacySection.strictE2EEEnabled', 'Strict E2EE enabled. AI/Translate will be disabled.')
          : t('privacySection.strictE2EEDisabled', 'Strict E2EE disabled. AI/Translate re-enabled.')
      );
    } catch (e) {
      toast.err(t('profile.saveError', 'Error: Could not save settings'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Group justify="space-between" mt="md" align="flex-start">
      <div style={{ maxWidth: 720 }}>
        <Text fw={600}>
          {t('privacySection.strictE2EE', 'Strict end-to-end encryption')}
        </Text>
        <Text c="dimmed" size="sm">
          {t(
            'privacySection.ciphertextOnlyNote',
            'Store only ciphertext on the server. Disables AI/Translate and moderation previews.'
          )}
        </Text>
      </div>

      <Switch
        checked={strict}
        onChange={(e) => onToggle(e.currentTarget.checked)}
        disabled={!currentUser || saving}
        aria-label={t('privacySection.strictE2EE', 'Strict end-to-end encryption')}
      />
    </Group>
  );
}
