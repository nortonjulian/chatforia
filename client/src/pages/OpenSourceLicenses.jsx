import { Container, Title, Text, List, Anchor, Divider } from "@mantine/core";
import { useTranslation } from "react-i18next";

const LAST_UPDATED = "July 1, 2026";

const sections = [
  {
    title: "iOS App",
    items: [
      "App Check",
      "AppAuth-iOS",
      "Google Mobile Ads SDK",
      "Google Mobile Ads Unity Mediation",
      "Google Sign-In iOS",
      "Google User Messaging Platform",
      "GoogleUtilities",
      "GTMSessionFetcher",
      "GTMAppAuth",
      "PostHog iOS",
      "Promises",
      "Socket.IO Client Swift",
      "Starscream",
      "Twilio Video iOS",
      "Twilio Voice iOS",
    ],
  },
  {
    title: "Android App",
    items: [
      "AndroidX / Jetpack",
      "Jetpack Compose",
      "Material 3",
      "Google Mobile Ads SDK",
      "Firebase Messaging",
      "AndroidX Security Crypto",
      "OkHttp",
      "Kotlinx Serialization",
      "Kotlinx Coroutines",
      "Coil",
      "PostHog Android",
      "AppCompat",
      "Socket.IO Client",
      "LazySodium Android",
      "Twilio Voice Android",
      "Twilio Video Android",
      "JNA",
      "AndroidX Credentials",
      "Google Identity / Google ID",
    ],
  },
  {
    title: "Website & Web App",
    items: [
      "React",
      "Vite",
      "Mantine",
      "Emotion",
      "React Router",
      "Axios",
      "Socket.IO",
      "Sentry",
      "PostHog",
      "i18next",
      "Giphy SDK",
      "Twilio Voice SDK",
      "Twilio Video",
      "OpenAI SDK",
      "Prisma",
      "Express",
      "Redis / ioredis",
      "Day.js",
      "Luxon",
      "Lucide React",
      "Tabler Icons",
      "TweetNaCl",
      "Zustand",
    ],
  },
];

export default function OpenSourceLicenses() {
  const { t } = useTranslation();

  return (
    <Container size="md" py="xl" pt="3.5rem">
      <Title order={2} mb="sm">
        {t("openSource.title", "Open Source Licenses")}
      </Title>

      <Text c="dimmed" mb="md">
        {t("openSource.lastUpdated", "Last updated:")} {LAST_UPDATED}
      </Text>

      <Text mb="md">
        {t(
          "openSource.intro",
          "Chatforia uses open-source and third-party software to provide messaging, calling, security, analytics, advertising, and web features. We are grateful to the developers and communities behind these projects."
        )}
      </Text>

      <Text mb="xl">
        {t(
          "openSource.notice",
          "This page lists key third-party software used in Chatforia. Each project remains governed by its own license terms."
        )}
      </Text>

      {sections.map((section) => (
        <div key={section.title}>
          <Title order={4} mt="lg" mb="xs">
            {section.title}
          </Title>

          <List spacing="xs">
            {section.items.map((item) => (
              <List.Item key={item}>{item}</List.Item>
            ))}
          </List>

          <Divider my="lg" />
        </div>
      ))}

      <Title order={4} mt="md" mb="xs">
        Contact
      </Title>

      <Text>
        Questions about open-source notices can be sent to{" "}
        <Anchor href="mailto:support@chatforia.com">
          support@chatforia.com
        </Anchor>
        .
      </Text>
    </Container>
  );
}