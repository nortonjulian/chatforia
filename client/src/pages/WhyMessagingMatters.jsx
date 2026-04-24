import { useTranslation } from "react-i18next";

export default function WhyMessagingMatters() {
  const { t } = useTranslation();

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "2rem" }}>
      <h1>
        {t(
          "blog.whyMessaging.title",
          "Why Messaging Platforms Matter More Than Ever"
        )}
      </h1>

      <p>
        {t(
          "blog.whyMessaging.intro",
          "Messaging platforms have become one of the most important tools for communication in today’s world. From personal conversations to business interactions, messaging apps allow people to stay connected instantly and efficiently."
        )}
      </p>

      <h2>{t("blog.whyMessaging.everydayTitle", "Everyday Communication")}</h2>
      <p>
        {t(
          "blog.whyMessaging.everydayDesc",
          "People rely on messaging apps for daily communication with friends, family, and colleagues. Whether it's a quick update or a long conversation, messaging provides a convenient and flexible way to stay in touch."
        )}
      </p>

      <h2>{t("blog.whyMessaging.speedTitle", "Speed and Convenience")}</h2>
      <p>
        {t(
          "blog.whyMessaging.speedDesc",
          "One of the main advantages of messaging platforms is their speed. Messages are delivered instantly, allowing users to communicate in real time. This level of convenience has made messaging the preferred method of communication for many people."
        )}
      </p>

      <h2>{t("blog.whyMessaging.globalTitle", "Global Reach")}</h2>
      <p>
        {t(
          "blog.whyMessaging.globalDesc",
          "Messaging platforms connect people across the globe. With internet access, users can communicate regardless of location, making it easier to build relationships and collaborate internationally."
        )}
      </p>

      <h2>{t("blog.whyMessaging.privacyTitle", "Privacy and Control")}</h2>
      <p>
        {t(
          "blog.whyMessaging.privacyDesc",
          "Modern messaging platforms focus on giving users control over their data and conversations. Features like encryption, privacy settings, and message controls allow users to communicate with confidence."
        )}
      </p>

      <h2>{t("blog.whyMessaging.futureTitle", "The Future of Messaging")}</h2>
      <p>
        {t(
          "blog.whyMessaging.futureDesc",
          "Messaging continues to evolve with new features such as AI-powered responses, translation, and multimedia sharing. As technology advances, messaging platforms will become even more powerful and versatile."
        )}
      </p>

      <p>
        {t(
          "blog.whyMessaging.outro",
          "Chatforia is built with these principles in mind, offering a fast, secure, and user-friendly messaging experience for a connected world."
        )}
      </p>
    </div>
  );
}