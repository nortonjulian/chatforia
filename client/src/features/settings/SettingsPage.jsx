import { Stack, Title, Divider } from '@mantine/core';
import SoundSettings from '@/components/SoundSettings';
import ThemePicker from '@/features/settings/ThemePicker';
import PrivacyToggles from '@/features/settings/PrivacyToggles';
import AgeSettings from '@/features/settings/AgeSettings';
import ForwardingSettings from '@/features/settings/ForwardingSettings.jsx';
import { useTranslation } from 'react-i18next';

export default function SettingsPage() {
  const { t } = useTranslation();

  return (
    <Stack gap="lg">
      {/* Appearance */}
      <Title order={3}>{t('profile.appearance', 'Appearance')}</Title>
      <ThemePicker />

      <Divider />

      {/* Notification Sounds */}
      <Title order={3}>{t('sounds.notificationSounds', 'Notification Sounds')}</Title>
      <SoundSettings />

      <Divider />

      {/* Privacy */}
      <Title order={3}>{t('profile.privacy', 'Privacy')}</Title>
      <PrivacyToggles />

      <Divider />

      {/* Safety & Age */}
      <Title order={3}>{t('profile.safetyAge', 'Safety & Age')}</Title>
      <AgeSettings />

      <Divider />

      {/* Call & Text Forwarding */}
      <Title order={3}>{t('profile.forwarding', 'Call & Text Forwarding')}</Title>
      <ForwardingSettings />
    </Stack>
  );
}
