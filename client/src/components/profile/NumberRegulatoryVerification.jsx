import { Alert, Button, Group, Stack, Text, Title } from '@mantine/core';
import { IconAlertTriangle, IconArrowLeft } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';

export default function NumberRegulatoryVerification({
  e164,
  initialDecision,
  initialResponse,
  onBack,
}) {
  const { t } = useTranslation();

  const rejected = initialDecision === 'VERIFICATION_REJECTED';

  return (
    <Stack gap="md">
      <div>
        <Title order={4}>
          {t(
            'phoneNumberManager.regulatoryVerificationHeading',
            'Identity verification required'
          )}
        </Title>
        <Text size="sm" c="dimmed">
          {t(
            'phoneNumberManager.regulatoryVerificationDescription',
            'Local regulations require additional information before this number can be assigned.'
          )}
        </Text>
      </div>

      <Text fw={600}>{e164}</Text>

      {rejected && (
        <Alert color="red" icon={<IconAlertTriangle size={16} />}>
          {initialResponse?.rejectionReason ||
            t(
              'phoneNumberManager.regulatoryVerificationRejected',
              'The previous verification was not approved. Review the requirements and submit updated information.'
            )}
        </Alert>
      )}

      <Text size="sm">
        {t(
          'phoneNumberManager.regulatoryVerificationPreparing',
          'Verification requirements will appear here.'
        )}
      </Text>

      <Group justify="space-between">
        <Button
          variant="subtle"
          leftSection={<IconArrowLeft size={16} />}
          onClick={onBack}
        >
          {t('common.back', 'Back')}
        </Button>
      </Group>
    </Stack>
  );
}
