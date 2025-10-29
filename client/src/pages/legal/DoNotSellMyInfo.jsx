import { Container, Title, Text, Button } from '@mantine/core';
import { useTranslation } from 'react-i18next';

export default function DoNotSellMyInfo() {
  const { t } = useTranslation();

  return (
    <Container size="md" py="xl">
      <Title order={2}>
        {t(
          'doNotSell.title',
          'Do Not Sell or Share My Personal Information'
        )}
      </Title>

      <Text c="dimmed" mb="md">
        {t(
          'doNotSell.body',
          'Chatforia does not sell personal information. California residents can still submit requests under CPRA using the button below.'
        )}
      </Text>

      <Button
        component="a"
        href="mailto:privacy@chatforia.com?subject=CPRA%20Request"
      >
        {t(
          'doNotSell.cta',
          'Submit a request'
        )}
      </Button>
    </Container>
  );
}
