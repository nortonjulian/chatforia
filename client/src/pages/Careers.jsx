import { Accordion, Container, Title, Text, Button, Stack } from '@mantine/core';
import { useTranslation } from 'react-i18next';

const opportunityAreas = [
  [
    "engineering",
    "Engineering & quality",
    "Full-stack, backend, web, iOS, Android, QA and test automation."
  ],
  [
    "infrastructure",
    "Infrastructure, security & telecom",
    "DevOps/SRE, security and encryption, voice/SMS, eSIM and carrier integrations."
  ],
  [
    "product",
    "Product, design & accessibility",
    "Product management, product design, UX research and accessibility."
  ],
  [
    "support",
    "Customer support & trust and safety",
    "Customer support, technical support, moderation, and fraud and abuse prevention."
  ],
  [
    "growth",
    "Marketing & creative",
    "Growth marketing, social media and content, copywriting, and graphic and video design."
  ],
  [
    "partnerships",
    "Sales & partnerships",
    "Creator and affiliate partnerships, advertising sales, business development and carrier partnerships."
  ],
  [
    "operations",
    "Data & business operations",
    "Data analytics, operations, and project and program management."
  ],
  [
    "business",
    "Finance, people & legal",
    "Accounting and finance, recruiting, people operations, and legal, privacy and compliance."
  ]
];

export default function Careers() {
  const { t } = useTranslation();
  const copy = (key, fallback) => t(`careers.talentNetwork.${key}`, fallback);

  return (
    <Container size="md" py={{ base: 'xl', sm: 48 }} px={{ base: 'sm', sm: 'md' }} style={{ width: '100%', minWidth: 0 }}>
      <Stack gap={40}>
        <Stack gap="md">
          <Text fw={700} size="sm" style={{ color: 'var(--accent)', letterSpacing: '0.18em', textTransform: 'uppercase' }}>
            {t('careers.title', 'Careers')}
          </Text>
          <Title order={1} style={{ fontSize: 'clamp(2rem, 4.5vw, 3.5rem)', lineHeight: 1.1 }}>
            {copy('designHeadline', 'Build what connects us.')}
          </Title>
          <Text size="xl" lh={1.55}>
            {copy('designIntro', 'Help shape Chatforia—a private, global messenger connecting people across languages on web, iOS, and Android.')}
          </Text>
        </Stack>

        <Stack gap="sm">
          <Title order={2}>{copy('workingTitle', 'How we work')}</Title>
          <Text lh={1.7}>
            {copy('designWorkingBody', 'We work with AI to build, test, and learn faster. People own the decisions and the results. Clear communication, privacy, security, and real-world testing guide our work.')}
          </Text>
        </Stack>

        <Stack gap="md">
          <Title order={2}>{copy('designOpportunitiesTitle', 'Explore future opportunities')}</Title>
          <Text lh={1.7}>
            {copy('designStatus', 'We welcome résumés for future employment and project-based contract work. These are areas of interest, not current vacancies. Hiring timelines have not been set.')}
          </Text>
          <Accordion
            multiple
            defaultValue={['engineering']}
            variant="default"
            styles={{
              item: { background: 'transparent', borderColor: 'var(--mantine-color-default-border)' },
              control: { paddingInline: 8 },
              label: { fontWeight: 600, fontSize: 'clamp(1rem, 2vw, 1.2rem)', paddingBlock: 18, overflowWrap: 'anywhere' },
              content: { paddingInline: 8, paddingBottom: 20 },
              chevron: { color: 'var(--accent)' },
            }}
          >
            {opportunityAreas.map(([id, label, description]) => (
              <Accordion.Item key={id} value={id}>
                <Accordion.Control>
                  {copy(`areas.${id}.title`, label)}
                </Accordion.Control>
                <Accordion.Panel>
                  <Text lh={1.6}>{copy(`areas.${id}.description`, description)}</Text>
                </Accordion.Panel>
              </Accordion.Item>
            ))}
          </Accordion>
        </Stack>

        <Stack gap="md">
          <Title order={2}>{copy('designApplyTitle', 'Where could you make a difference?')}</Title>
          <Text lh={1.7}>
            {copy('designApplyBody', 'Send your résumé or professional profile, your area of interest, and whether you prefer employment, project-based contract work, or either. Relevant work links are welcome.')}
          </Text>
          <Text>{copy('otherSpecialties', 'Don’t see your specialty? Tell us how you could contribute.')}</Text>
          <Button component="a" href="mailto:careers@chatforia.com" size="md" radius="md" style={{ alignSelf: 'flex-start', maxWidth: '100%' }}>
            {copy('resumeCta', 'Send your résumé')}
          </Button>
          <Text size="sm" c="dimmed">
            {copy('designExpectations', 'We may contact you when a suitable opportunity arises.')}
          </Text>
        </Stack>
      </Stack>
    </Container>
  );
}
