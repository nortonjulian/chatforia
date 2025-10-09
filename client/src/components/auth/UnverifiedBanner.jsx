import { Alert, Button, Group, Text } from '@mantine/core';

export default function UnverifiedBanner({ user, onOpenPhone }) {
  const needsEmail = !user?.emailVerifiedAt;
  const needsPhone = !user?.phoneVerifiedAt;

  if (!needsEmail && !needsPhone) return null;

  const resend = async () => { await fetch('/auth/email/send', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email: user.email }) }); };

  return (
    <Alert color="yellow" title="Finish verification">
      <Group justify="space-between" wrap="wrap">
        <Text size="sm">
          {needsEmail ? 'Verify your email to unlock full features.' : 'Verify your phone to use calling/SMS.'}
        </Text>
        <Group gap="xs">
          {needsEmail && <Button size="xs" variant="light" onClick={resend}>Resend email</Button>}
          {needsPhone && <Button size="xs" onClick={onOpenPhone}>Verify phone</Button>}
        </Group>
      </Group>
    </Alert>
  );
}
