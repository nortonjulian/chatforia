import { Accordion, Container, Title, Text, Button, Stack, List } from '@mantine/core';
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
    <Container size="md" py="xl">
      <Stack gap="xl">
        <Stack gap="sm">
          <Title order={1}>{t('careers.title', 'Careers')}</Title>
          <Title order={2}>{copy('headline', 'Help build Chatforia')}</Title>
          <Text c="dimmed">
            {copy('intro', 'Chatforia connects people across languages through messaging and calling on web, iOS, and Android. We’re building with care for privacy, security, and the people using our products.')}
          </Text>
          <Text>
            {copy('status', 'We’re accepting résumés for future employment and contract opportunities. The areas below represent potential future needs, not current vacancies. Hiring will depend on business priorities, and timelines have not been set.')}
          </Text>
          <Button component="a" href="mailto:careers@chatforia.com" size="md" style={{ alignSelf: 'flex-start' }}>
            {copy('introduceCta', 'Introduce yourself')}
          </Button>
        </Stack>

        <Stack gap="sm">
          <Title order={2}>{copy('workingTitle', 'How we work')}</Title>
          <Text c="dimmed">
            {copy('workingBody', 'AI-assisted work is central to how we build. We use tools such as ChatGPT to help with development, testing, research, and documentation, while taking responsibility for the results. We value sound judgment, clear communication, ownership, and collaboration. Privacy, security, and real-world testing guide what we ship.')}
          </Text>
        </Stack>

        <Stack gap="sm">
          <Title order={2}>{copy('opportunitiesTitle', 'Future opportunities')}</Title>
          <Text c="dimmed">
            {copy('opportunitiesIntro', 'Explore the areas where you could contribute. Some needs may be combined into broader roles or supported through specialist contract projects.')}
          </Text>
          <Accordion multiple variant="separated">
            {opportunityAreas.map(([id, label, description]) => (
              <Accordion.Item key={id} value={id}>
                <Accordion.Control>
                  {copy(`areas.${id}.title`, label)}
                </Accordion.Control>
                <Accordion.Panel>
                  <Text>{copy(`areas.${id}.description`, description)}</Text>
                </Accordion.Panel>
              </Accordion.Item>
            ))}
          </Accordion>
        </Stack>

        <Stack gap="sm">
          <Title order={2}>{copy('whyTitle', 'Why contribute to Chatforia?')}</Title>
          <List spacing="xs">
            <List.Item>{copy('whyCollaboration', 'Collaborate on meaningful product decisions that improve how people connect.')}</List.Item>
            <List.Item>{copy('whyOwnership', 'Own improvements across messaging, translation, voice, video, and connectivity.')}</List.Item>
            <List.Item>{copy('whyPractices', 'Help shape the product and how a small team works with AI responsibly.')}</List.Item>
          </List>
        </Stack>

        <Stack gap="sm">
          <Title order={2}>{copy('applyTitle', 'Introduce yourself')}</Title>
          <Text>
            {copy('applyBody', 'Send your résumé or professional profile, the areas you’re interested in, and whether you’re seeking employment or contract work. Include relevant work links if available.')}
          </Text>
          <Text>
            {copy('otherSpecialties', 'Don’t see your specialty? Tell us how you could contribute.')}
          </Text>
          <Text c="dimmed">
            {copy('expectations', 'We’ll review expressions of interest as hiring needs develop and may contact you if a suitable opportunity arises.')}
          </Text>
          <Button component="a" href="mailto:careers@chatforia.com" size="md" style={{ alignSelf: 'flex-start' }}>
            {copy('resumeCta', 'Send your résumé')}
          </Button>
        </Stack>
      </Stack>
    </Container>
  );
}
