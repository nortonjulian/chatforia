import { useState } from 'react';
import { Alert, Anchor, Button, Group, Paper, Stack, Switch, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import usePrivacy from './usePrivacy';
import { savePrivacy } from './preferences';

export function PrivacyChoices({ compact = false }) {
  const { t } = useTranslation();
  const privacy = usePrivacy();
  const [analytics, setAnalytics] = useState(privacy.analytics);
  const [advertising, setAdvertising] = useState(privacy.advertising);
  const [error, setError] = useState(false);
  const save = (choices) => {
    if (savePrivacy(choices)) window.location.reload();
    else setError(true);
  };
  return <Stack gap="sm">
    <Text>{t('privacyChoices.description', 'Optional analytics and third-party advertising are off until you allow them. Your choice applies to this browser, not your other devices. Essential sign-in and security features remain enabled.')}</Text>
    {privacy.gpc && <Alert>{t('privacyChoices.gpc', 'Global Privacy Control is enabled. Optional analytics and third-party advertising stay off in this browser.')}</Alert>}
    {!compact && <>
      <Switch label={t('privacyChoices.analytics', 'Allow analytics (PostHog)')} checked={!privacy.gpc && analytics} disabled={privacy.gpc} onChange={(e) => setAnalytics(e.currentTarget.checked)} />
      <Switch label={t('privacyChoices.advertising', 'Allow third-party advertising')} checked={!privacy.gpc && advertising} disabled={privacy.gpc} onChange={(e) => setAdvertising(e.currentTarget.checked)} />
      <Text size="sm">{t('privacyChoices.providers', 'Advertising providers may use identifiers and online activity. Additional regional consent choices may be presented by the advertising provider.')}{' '}<Anchor href="https://policies.google.com/technologies/partner-sites" target="_blank" rel="noopener noreferrer">Google</Anchor>{' · '}<Anchor href="https://posthog.com/privacy" target="_blank" rel="noopener noreferrer">PostHog</Anchor></Text>
    </>}
    <Text size="sm" c="dimmed">{t('privacyChoices.reload', 'Saving reloads this page to apply your choices. Save any unfinished work first. Previously stored provider data can be removed through your browser settings.')}</Text>
    <Group>
      <Button variant="default" onClick={() => save({ analytics: false, advertising: false })}>{t('privacyChoices.reject', 'Reject optional')}</Button>
      {compact ? <Anchor href="/legal/cookies">{t('privacyChoices.manage', 'Manage choices')}</Anchor> : <Button onClick={() => save({ analytics, advertising })}>{t('privacyChoices.save', 'Save choices')}</Button>}
    </Group>
    {error && <Alert color="red" role="alert">{t('privacyChoices.storageError', 'Your browser could not save this choice. Optional tracking remains off unless you previously allowed it. Check your browser storage settings and try again.')}</Alert>}
  </Stack>;
}

export default function PrivacyBanner() {
  const privacy = usePrivacy();
  if (privacy.decided || privacy.gpc || window.location.pathname === '/legal/cookies') return null;
  return <Paper component="section" aria-label="Privacy choices" withBorder p="md" m="md"><PrivacyChoices compact /></Paper>;
}
