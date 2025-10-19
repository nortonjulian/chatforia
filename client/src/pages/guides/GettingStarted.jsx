import { Title, Text, Stack, List, Anchor, Alert, Group, Button } from '@mantine/core';
import { Link } from 'react-router-dom';

export default function GettingStarted() {
  return (
    <Stack maw={820} mx="auto" p="md" gap="md">
      <Title order={2}>Getting Started</Title>
      <Text c="dimmed">
        New to Chatforia? This quick start shows the essentials so you can be productive in minutes.
      </Text>

      <Alert variant="light" color="blue">
        This guide will grow as we launch new features. If something’s missing, let us know via
        {' '}<Anchor component={Link} to="/contact">Contact Us</Anchor>.
      </Alert>

      <Title order={4}>1) Create your account</Title>
      <List withPadding>
        <List.Item>
          <Anchor component={Link} to="/register">Sign up</Anchor> or{' '}
          <Anchor component={Link} to="/">log in</Anchor> with your existing account.
        </List.Item>
        <List.Item>
          Set your <Anchor component={Link} to="/settings">preferences</Anchor> (language, read receipts, themes).
        </List.Item>
      </List>

      <Title order={4}>2) Start messaging</Title>
      <List withPadding>
        <List.Item>Create a DM or Group and send your first message.</List.Item>
        <List.Item>Use instant translation to chat across 100+ languages.</List.Item>
        <List.Item>Try disappearing messages and read receipts in Profile → Privacy.</List.Item>
      </List>

      <Title order={4}>3) Go further</Title>
      <List withPadding>
        <List.Item>
          Manage your plan on the{' '}
          <Anchor component={Link} to="/upgrade">Upgrade</Anchor> page (Plus = ad-free, Premium = full features).
        </List.Item>
        <List.Item>
          Link additional devices and set up encrypted backups in{' '}
          <Anchor component={Link} to="/settings">Settings</Anchor>.
        </List.Item>
      </List>

      <Group>
        <Button component={Link} to="/upgrade" variant="light">See plans</Button>
        <Button component={Link} to="/settings" variant="subtle">Open settings</Button>
      </Group>
    </Stack>
  );
}
