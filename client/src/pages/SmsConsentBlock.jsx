import { Checkbox, Stack, Text } from '@mantine/core';
import { useTranslation, Trans } from 'react-i18next';

export default function SmsConsentBlock({
  checked,
  onChange,
  disabled = false,
  companyName = 'Chatforia',
  error,
}) {
  const { t } = useTranslation();

  return (
    <Stack gap={6} mt="xs">
      <Checkbox
        checked={!!checked}
        disabled={disabled}
        onChange={(e) => onChange?.(e.currentTarget.checked)}
        label={
          <Text size="sm">
            <Trans
              i18nKey="smsConsent.label"
              values={{ companyName }}
              components={{
                stop: <b />,
                help: <b />,
              }}
            />
          </Text>
        }
      />

      {!!error && (
        <Text size="xs" c="red.6">
          {error}
        </Text>
      )}
    </Stack>
  );
}