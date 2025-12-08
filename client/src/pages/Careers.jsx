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
          'We’re a small founding team building Chatforia — a private, global messenger launching on web, iOS, and Android. If you care about privacy, encryption, and delightful user experiences, we’d love to hear from you.'
        )}
      >
        {t(
          'careers.intro',
          'We’re a small founding team building Chatforia — a private, global messenger launching on web, iOS, and Android. If you care about privacy, encryption, and delightful user experiences, we’d love to hear from you.'
        )}
      </Text>

      <Stack gap="xs" mb="lg">
        {/* Open founding roles */}
        <Text
          aria-label={t(
            'careers.openRoles',
            'Open founding roles: Lead Full-stack Engineer, Backend Engineer (Node.js), Frontend/Web Engineer (React), Mobile Engineer (iOS), Mobile Engineer (Android), DevOps/SRE, Security & Encryption Engineer, Telecom Engineer (Twilio + eSIM).'
          )}
          dangerouslySetInnerHTML={{
            __html: t(
              'careers.openRoles',
              '<b>Open founding roles:</b> Lead Full-stack Engineer, Backend Engineer (Node.js), Frontend/Web Engineer (React), Mobile Engineer (iOS), Mobile Engineer (Android), DevOps/SRE, Security &amp; Encryption Engineer, Telecom Engineer (Twilio + eSIM).'
            ),
          }}
        />

        {/* Future leadership opportunities */}
        <Text
          aria-label={t(
            'careers.futureRoles',
            'Future leadership opportunities (accepting interest): CTO (founding-level role — future hire), Engineering Manager (future leadership position).'
          )}
          dangerouslySetInnerHTML={{
            __html: t(
              'careers.futureRoles',
              '<b>Future leadership opportunities (accepting interest):</b> CTO (founding-level role — future hire), Engineering Manager (future leadership position).'
            ),
          }}
        />

        {/* How to apply */}
        <Text
          aria-label={t(
            'careers.apply',
            'How to apply: Use the button below to email your resume, GitHub, and links.'
          )}
        >
          {t(
            'careers.apply',
            'How to apply: Use the button below to email your resume, GitHub, and links.'
          )}
        </Text>
      </Stack>

      {/* Why join now */}
      <Text
        fw={500}
        aria-label={t('careers.whyNow', 'Why join now?')}
        mb="xs"
      >
        {t('careers.whyNow', 'Why join now?')}
      </Text>

      <Text
        c="dimmed"
        mb="lg"
        aria-label={t(
          'careers.whyBullets',
          '• Help build the foundation of a new global messenger.\n• Ship improvements used across web, iOS, and Android.\n• Work directly with the founder on architecture and product direction.\n• Own high-impact areas of the stack: messaging, voice, video, encryption, telecom, AI.\n• Join at the beginning — before the user base scales.'
        )}
        style={{ whiteSpace: 'pre-line' }}
      >
        {t(
          'careers.whyBullets',
          '• Help build the foundation of a new global messenger.\n• Ship improvements used across web, iOS, and Android.\n• Work directly with the founder on architecture and product direction.\n• Own high-impact areas of the stack: messaging, voice, video, encryption, telecom, AI.\n• Join at the beginning — before the user base scales.'
        )}
      </Text>

      {/* CTA button */}
      <Button
        mt="lg"
        size="md"
        component="a"
        href="mailto:careers@chatforia.com"
        aria-label={t('careers.emailCta', 'Email your resume')}
      >
        {t('careers.emailCta', 'Email your resume')}
      </Button>
    </Container>
  );
}
