import { Checkbox, Stack, Text, Anchor } from '@mantine/core';

export default function SmsConsentBlock({
  checked,
  onChange,
  disabled = false,

  companyName = 'Chatforia',
  termsUrl = 'https://www.chatforia.com/terms',
  privacyUrl = 'https://www.chatforia.com/privacy',

  // Optional: show an inline error under the checkbox
  error,
}) {
  return (
    <Stack gap={6} mt="xs">
      <Checkbox
        checked={!!checked}
        disabled={disabled}
        onChange={(e) => onChange?.(e.currentTarget.checked)}
        label={
          <Text size="sm">
            I consent to receive SMS notifications and alerts from {companyName}. Message frequency may
            vary. Msg &amp; data rates may apply. Reply <b>STOP</b> to unsubscribe at any time. Reply{' '}
            <b>HELP</b> for help.
          </Text>
        }
      />

      <Text size="xs" c="dimmed">
        By checking this box, you also agree to our{' '}
        <Anchor href={termsUrl} target="_blank" rel="noreferrer">
          Terms of Service
        </Anchor>{' '}
        and{' '}
        <Anchor href={privacyUrl} target="_blank" rel="noreferrer">
          Privacy Policy
        </Anchor>
        .
      </Text>

      {!!error && (
        <Text size="xs" c="red.6">
          {error}
        </Text>
      )}
    </Stack>
  );
}