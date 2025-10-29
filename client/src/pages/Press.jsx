import { Container, Title, Text, Paper, Stack } from '@mantine/core';
import { useTranslation } from 'react-i18next';

export default function Press() {
  const { t } = useTranslation();

  return (
    <Container size="md" py="xl">
      {/* Page title */}
      <Title
        order={2}
        aria-label={t('press.title', 'Press')}
      >
        {t('press.title', 'Press')}
      </Title>

      {/* Contact line with mailto link */}
      <Text
        c="dimmed"
        mb="md"
        aria-label={t(
          'press.contactText',
          'For media inquiries, reach us at press@chatforia.com.'
        )}
        dangerouslySetInnerHTML={{
          __html: t(
            'press.contact',
            'For media inquiries, reach us at <a href="mailto:press@chatforia.com">press@chatforia.com</a>.'
          ),
        }}
      />

      <Stack>
        {/* Boilerplate card */}
        <Paper withBorder p="md" radius="md">
          <Title
            order={4}
            aria-label={t('press.boilerplateTitle', 'Boilerplate')}
          >
            {t('press.boilerplateTitle', 'Boilerplate')}
          </Title>

          <Text
            aria-label={t(
              'press.boilerplateText',
              'Chatforia is a secure messenger with instant translation and E2E encryption, designed to make global conversations private and effortless.'
            )}
          >
            {t(
              'press.boilerplateText',
              'Chatforia is a secure messenger with instant translation and E2E encryption, designed to make global conversations private and effortless.'
            )}
          </Text>
        </Paper>

        {/* Brand assets card */}
        <Paper withBorder p="md" radius="md">
          <Title
            order={4}
            aria-label={t('press.assetsTitle', 'Brand assets')}
          >
            {t('press.assetsTitle', 'Brand assets')}
          </Title>

          <Text
            aria-label={t(
              'press.assetsText',
              'Logos, screenshots, and product imagery (coming soon).'
            )}
          >
            {t(
              'press.assetsText',
              'Logos, screenshots, and product imagery (coming soon).'
            )}
          </Text>
        </Paper>
      </Stack>
    </Container>
  );
}
