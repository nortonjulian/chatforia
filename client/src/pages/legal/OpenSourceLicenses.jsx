import { Container, Title, Text, List, Anchor, Divider } from "@mantine/core";
import { useTranslation } from "react-i18next";

const LAST_UPDATED = "November 3, 2026";

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

];

export default function OpenSourceLicenses() {
  const { t } = useTranslation();

  return (
    <Container size="md" py="xl">
      <Title order={1} mb="sm">
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
          "openSource.noticeAudit20261103",
          "The browser notices below include package versions and available license and attribution texts from the website build. Native app lists are an overview, not a complete license inventory. Some third-party SDKs use proprietary terms; listing them here does not mean they are open source."
        )}
      </Text>

      <Title order={2} mt="lg" mb="xs">Website &amp; Web App</Title>
      <Text mb="md">Browser package notices are generated for each production build. They do not cover native apps, server-only software, externally loaded SDKs, or separately supplied static assets.</Text>
      <Anchor href="/third-party-notices.txt">Read browser third-party notices (plain text)</Anchor>
      <Text mt="xs"><Anchor href="/third-party-notices.json" download>Download browser package inventory (JSON)</Anchor></Text>
      <Divider my="lg" />

      {sections.map((section) => (
        <div key={section.title}>
          <Title order={2} mt="lg" mb="xs">
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

      <Title order={2} mt="md" mb="xs">
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