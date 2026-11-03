import { useTranslation } from "react-i18next";

export default function Safety() {
  const { t } = useTranslation();

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "2rem" }}>
      <h1>{t("safety.title", "Safety & Community Guidelines")}</h1>

      <p>
        {t(
          "safety.intro",
          "Chatforia is committed to maintaining a safe and respectful environment for all users. These guidelines help ensure a positive experience for everyone."
        )}
      </p>

      <h2>{t("safety.respectTitle", "Respectful Communication")}</h2>
      <p>
        {t(
          "safety.respectDesc",
          "Users are expected to communicate respectfully. Harassment, abuse, or harmful behavior is not permitted."
        )}
      </p>

      <h2>{t("safety.prohibitedTitle", "Prohibited Content")}</h2>
      <ul>
        <li>{t("safety.prohibited.illegal", "Illegal activities")}</li>
        <li>{t("safety.prohibited.harassment", "Harassment or bullying")}</li>
        <li>{t("safety.prohibited.hate", "Hate speech or discrimination")}</li>
        <li>{t("safety.prohibited.explicit", "Explicit or harmful material")}</li>
        <li>{t("safety.prohibited.spam", "Spam or deceptive practices")}</li>
      </ul>

      <h2>{t("safety.toolsTitle", "User Safety Tools")}</h2>
      <ul>
        <li>{t("safety.tools.report", "Report inappropriate behavior or content")}</li>
        <li>{t("safety.tools.block", "Block users to prevent further interaction")}</li>
        <li>{t("safety.tools.control", "Manage privacy and communication settings")}</li>
      </ul>

      <h2>{t("safety.enforcementTitle", "Enforcement")}</h2>
      <p>
        {t(
          "safety.enforcementDesc",
          "We may take action against accounts that violate these guidelines, including warnings, restrictions, or permanent removal from the platform."
        )}
      </p>
    </div>
  );
}