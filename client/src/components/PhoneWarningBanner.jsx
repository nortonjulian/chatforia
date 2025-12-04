import { Alert, Button, Group, Text } from '@mantine/core';
import axiosClient from '../api/axiosClient';
import { useTranslation, Trans } from 'react-i18next';

export default function PhoneWarningBanner({ phone, onReactivate }) {
  const { t } = useTranslation();

  const releaseDate = new Date(phone.releaseAfter);
  const now = new Date();
  const isExpiring = phone.status === 'HOLD' && releaseDate > now;

  if (!isExpiring) return null;

  const handleReactivate = async () => {
    try {
      await axiosClient.post(`/api/phone/${phone.id}/reactivate`);
      onReactivate?.();
    } catch (err) {
      console.error('Failed to reactivate number:', err);
    }
  };

  return (
    <Alert
      title={t('phoneWarning.title')}
      color="yellow"
      radius="md"
      withBorder
    >
      <Group justify="space-between" align="center">
        <Text size="sm">
          <Trans
            i18nKey="phoneWarning.body"
            values={{
              number: phone.e164,
              date: releaseDate.toDateString(),
            }}
            components={{ strong: <strong /> }}
          />
        </Text>

        <Button variant="outline" size="xs" onClick={handleReactivate}>
          {t('phoneWarning.button')}
        </Button>
      </Group>
    </Alert>
  );
}
