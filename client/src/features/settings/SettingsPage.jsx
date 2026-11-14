import { Stack, Title, Divider } from '@mantine/core';
import { useTranslation } from 'react-i18next';

import SecureMessageSettingsCard from '@/components/security/SecureMessageSettingsCard.jsx';
import SoundSettings from '@/components/SoundSettings';
import { useUser } from '@/context/UserContext';
import AgeSettings from '@/features/settings/AgeSettings';
import ForwardingSettings from '@/features/settings/ForwardingSettings.jsx';
import PrivacyToggles from '@/features/settings/PrivacyToggles';
import ThemePicker from '@/features/settings/ThemePicker';

export default function SettingsPage() {
  const { t } = useTranslation();
  const { currentUser } = useUser() || {};

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
      <ForwardingSettings key={currentUser?.id ?? 'anonymous'} />

      <Divider />

      {/* Security */}
      <Title order={3}>Security</Title>
      <SecureMessageSettingsCard />
    </Stack>
  );
}
