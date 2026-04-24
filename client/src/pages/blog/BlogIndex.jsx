import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

export default function BlogIndex() {
  const { t } = useTranslation();

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "2rem" }}>
      <h1>{t("blog.index.title", "Chatforia Blog")}</h1>

      <p>
        {t(
          "blog.index.intro",
          "Explore insights on communication, online safety, and how messaging technology is connecting people around the world."
        )}
      </p>

      <ul>
        <li>
          <Link to="/blog/chat-safely-online">
            {t(
              "blog.index.post1",
              "How to Chat Safely Online"
            )}
          </Link>
        </li>
        <li>
          <Link to="/blog/global-communication">
            {t(
              "blog.index.post2",
              "The Future of Global Communication"
            )}
          </Link>
        </li>
        <li>
          <Link to="/blog/why-messaging-matters">
            {t(
              "blog.index.post3",
              "Why Messaging Platforms Matter"
            )}
          </Link>
        </li>
      </ul>
    </div>
  );
}