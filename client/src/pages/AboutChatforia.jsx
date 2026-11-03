import { useTranslation } from "react-i18next";

export default function AboutChatforia() {
  const { t } = useTranslation();

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "2rem" }}>
      <h1>{t("about.title", "About Chatforia")}</h1>

      <p>
        {t(
          "about.description",
          "Chatforia is a modern messaging platform designed for secure, multilingual communication. It offers encrypted messaging, real-time translation, and voice/video calling to help people connect across languages and borders."
        )}
      </p>

      <p>{t("about.encryptionScopeAudit20261103", "Encryption depends on the communication method. SMS/MMS and calls to ordinary phone numbers are not end-to-end encrypted. Optional translation and AI features process the text submitted to them.")}</p>

      <div
        style={{
          marginTop: "1.5rem",
          padding: "1rem",
          borderRadius: "8px",
          background: "var(--mantine-color-default)",
        }}
      >
        <h2>{t("about.valuesTitle", "What we value")}</h2>

        <ul>
          <li>
            <strong>{t("about.privacyTitle", "Privacy-first")}:</strong>{" "}
            {t(
              "about.privacyDesc",
              "Strong encryption and user-controlled privacy settings"
            )}
          </li>

          <li>
            <strong>{t("about.accessTitle", "Access for all")}:</strong>{" "}
            {t(
              "about.accessDesc",
              "Built-in translation across multiple languages"
            )}
          </li>

          <li>
            <strong>{t("about.controlTitle", "Control")}:</strong>{" "}
            {t(
              "about.controlDesc",
              "Features like disappearing messages and read receipts"
            )}
          </li>
        </ul>
      </div>
    </div>
  );
}