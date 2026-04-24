import { useTranslation } from "react-i18next";

export default function HowItWorks() {
  const { t } = useTranslation();

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "2rem" }}>
      <h1>{t("howItWorks.title", "How Chatforia Works")}</h1>

      <p>
        {t(
          "howItWorks.intro",
          "Chatforia is designed to make communication simple, fast, and accessible. Getting started takes just a few steps."
        )}
      </p>

      <h2>{t("howItWorks.step1Title", "1. Create an Account")}</h2>
      <p>
        {t(
          "howItWorks.step1Desc",
          "Sign up using your email or username to create your Chatforia account."
        )}
      </p>

      <h2>{t("howItWorks.step2Title", "2. Start a Conversation")}</h2>
      <p>
        {t(
          "howItWorks.step2Desc",
          "Connect with others by selecting contacts or starting new chats."
        )}
      </p>

      <h2>{t("howItWorks.step3Title", "3. Real-Time Messaging")}</h2>
      <p>
        {t(
          "howItWorks.step3Desc",
          "Messages are delivered quickly to provide a smooth communication experience."
        )}
      </p>

      <h2>{t("howItWorks.step4Title", "4. Global Communication")}</h2>
      <p>
        {t(
          "howItWorks.step4Desc",
          "Built-in translation helps users communicate across different languages."
        )}
      </p>

      <h2>{t("howItWorks.step5Title", "5. Stay in Control")}</h2>
      <p>
        {t(
          "howItWorks.step5Desc",
          "Manage your preferences, contacts, and communication settings."
        )}
      </p>
    </div>
  );
}