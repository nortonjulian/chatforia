import {
  Title,
  Text,
  Stack,
  List,
  Anchor,
  Alert,
  Group,
  Button,
} from '@mantine/core';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export default function GettingStarted() {
  const { t } = useTranslation();

  return (
    <Stack maw={820} mx="auto" p="md" gap="md">
      <Title order={1}>
        {t('gettingStarted.title', 'Getting Started')}
      </Title>

      <Text c="dimmed">
        {t(
          'gettingStarted.subtitle',
          'New to Chatforia? This quick start shows the essentials so you can be productive in minutes.'
        )}
      </Text>

      <Alert variant="light" color="blue">
        {t(
          'gettingStarted.alert.text',
          'This guide will grow as we launch new features. If something’s missing, let us know via'
        )}{' '}
        <Anchor component={Link} to="/contact">
          {t('gettingStarted.alert.contactLink', 'Contact Us')}
        </Anchor>
        {'.'}
      </Alert>

      <Title order={2}>
        {t('gettingStarted.section1.title', '1) Create your account')}
      </Title>
      <List withPadding>
        <List.Item>
          <Anchor component={Link} to="/register">
            {t('gettingStarted.section1.signup', 'Sign up')}
          </Anchor>{' '}
          {t('gettingStarted.section1.or', 'or')}{' '}
          <Anchor component={Link} to="/">
            {t('gettingStarted.section1.login', 'log in')}
          </Anchor>{' '}
          {t(
            'gettingStarted.section1.loginText',
            'with your existing account.'
          )}
        </List.Item>

        <List.Item>
          {t(
            'gettingStarted.section1.prefsStart',
            'In the app, open Settings to set your preferences'
          )}{' '}
          {t(
            'gettingStarted.section1.prefsRest',
            '(language, read receipts, themes).'
          )}
        </List.Item>
      </List>

      <Title order={2}>
        {t('gettingStarted.section2.title', '2) Start messaging')}
      </Title>
      <List withPadding>
        <List.Item>
          {t(
            'gettingStarted.section2.item1',
            'Create a DM or Group and send your first message.'
          )}
        </List.Item>
        <List.Item>
          {t(
            "gettingStarted.section2.item2Audit20261103",
          "Enable optional translation to communicate across languages. Translation sends message text to an external provider and is unavailable in strict end-to-end encryption mode."
          )}
        </List.Item>
        <List.Item>
          {t(
            'gettingStarted.section2.privacySettings',
            'On the web, manage read receipts in Settings → Privacy. Explore your profile controls for disappearing messages.'
          )}
        </List.Item>
      </List>

      <Title order={2}>
        {t('gettingStarted.section3.title', '3) Go further')}
      </Title>
      <List withPadding>
        <List.Item>
          {t(
            'gettingStarted.section3.item1',
            'You can upgrade to a paid plan anytime inside the app.'
          )}
        </List.Item>

        <List.Item>
          {t(
            'gettingStarted.section3.item2Part1',
            'Once you’re signed in, you can link additional devices and set up encrypted backups from Settings in the app.'
          )}
        </List.Item>
      </List>

      <Group>
        <Button component={Link} to="/pricing" variant="light">
          {t('gettingStarted.cta.seePlans', 'See plans & pricing')}
        </Button>
        <Button component={Link} to="/register" variant="subtle">
          {t('gettingStarted.cta.createAccount', 'Create an account')}
        </Button>
      </Group>
    </Stack>
  );
}
