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
      <Title order={2}>
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

      <Title order={4}>
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
            'Set your'
          )}{' '}
          <Anchor component={Link} to="/settings">
            {t('gettingStarted.section1.prefsLink', 'preferences')}
          </Anchor>{' '}
          {t(
            'gettingStarted.section1.prefsRest',
            '(language, read receipts, themes).'
          )}
        </List.Item>
      </List>

      <Title order={4}>
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
            'gettingStarted.section2.item2',
            'Use instant translation to chat across 100+ languages.'
          )}
        </List.Item>
        <List.Item>
          {t(
            'gettingStarted.section2.item3',
            'Try disappearing messages and read receipts in Profile → Privacy.'
          )}
        </List.Item>
      </List>

      <Title order={4}>
        {t('gettingStarted.section3.title', '3) Go further')}
      </Title>
      <List withPadding>
        <List.Item>
          {t(
            'gettingStarted.section3.item1Part1',
            'Manage your plan on the'
          )}{' '}
          <Anchor component={Link} to="/upgrade">
            {t('gettingStarted.section3.upgradeLink', 'Upgrade')}
          </Anchor>{' '}
          {t(
            'gettingStarted.section3.item1Part2',
            'page (Plus = ad-free, Premium = full features).'
          )}
        </List.Item>

        <List.Item>
          {t(
            'gettingStarted.section3.item2Part1',
            'Link additional devices and set up encrypted backups in'
          )}{' '}
          <Anchor component={Link} to="/settings">
            {t('gettingStarted.section3.settingsLink', 'Settings')}
          </Anchor>
          {'.'}
        </List.Item>
      </List>

      <Group>
        <Button component={Link} to="/upgrade" variant="light">
          {t('gettingStarted.cta.seePlans', 'See plans')}
        </Button>
        <Button component={Link} to="/settings" variant="subtle">
          {t('gettingStarted.cta.openSettings', 'Open settings')}
        </Button>
      </Group>
    </Stack>
  );
}
