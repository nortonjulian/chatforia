import { Container, Title, Text, Button, Stack } from '@mantine/core';
import { useTranslation } from 'react-i18next';

export default function Careers() {
  const { t } = useTranslation();

  return (
    <Container size="md" py="xl">
      {/* Title */}
      <Title
        order={2}
        mb="sm"
        aria-label={t('careers.title', 'Careers')}
      >
        {t('careers.title', 'Careers')}
      </Title>

      {/* Intro paragraph */}
      <Text
        c="dimmed"
        mb="lg"
        aria-label={t(
          'careers.intro',
          'We’re a small team building a private, global messenger. If you care about encryption, accessibility, and delightful UX, we’d love to hear from you.'
        )}
      >
        {t(
          'careers.intro',
          'We’re a small team building a private, global messenger. If you care about encryption, accessibility, and delightful UX, we’d love to hear from you.'
        )}
      </Text>

      <Stack gap="xs">
        {/* Open roles line (bold inside text) */}
        <Text
          aria-label={t(
            'careers.openRoles',
            'Open roles: Engineering (Full-stack, iOS, Android), Product, Support.'
          )}
          dangerouslySetInnerHTML={{
            __html: t(
              'careers.openRoles',
              '<b>Open roles:</b> Engineering (Full-stack, iOS, Android), Product, Support.'
            ),
          }}
        />

        {/* How to apply line (includes mailto link) */}
        <Text
          aria-label={t(
            'careers.apply',
            'How to apply: Email your resume/links to jobs@chatforia.com.'
          )}
          dangerouslySetInnerHTML={{
            __html: t(
              'careers.apply',
              '<b>How to apply:</b> Email your resume/links to <a href="mailto:jobs@chatforia.com">jobs@chatforia.com</a>.'
            ),
          }}
        />
      </Stack>

      {/* CTA button */}
      <Button
        mt="lg"
        component="a"
        href="mailto:jobs@chatforia.com"
        aria-label={t(
          'careers.emailCta',
          'Email your resume'
        )}
      >
        {t('careers.emailCta', 'Email your resume')}
      </Button>
    </Container>
  );
}
