import { Checkbox, Stack, Text } from '@mantine/core';

export default function SmsConsentBlock({
  checked,
  onChange,
  disabled = false,
  companyName = 'Chatforia',
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
            I consent to receive SMS notifications and alerts from {companyName}. Message
            frequency may vary. Msg &amp; data rates may apply. Reply <b>STOP</b> to unsubscribe at
            any time. Reply <b>HELP</b> for help.
          </Text>
        }
      />

      {/* No Terms/Privacy links here — telecom consent only. */}
      {!!error && (
        <Text size="xs" c="red.6">
          {error}
        </Text>
      )}
    </Stack>
  );
}