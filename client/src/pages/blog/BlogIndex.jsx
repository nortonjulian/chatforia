import { Link } from "react-router-dom";

export default function BlogIndex() {
  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "2rem" }}>
      <h1>Chatforia Blog</h1>

      <ul>
        <li>
          <Link to="/blog/chat-safely-online">
            How to Chat Safely Online
          </Link>
        </li>
        <li>
          <Link to="/blog/global-communication">
            The Future of Global Communication
          </Link>
        </li>
        <li>
          <Link to="/blog/why-messaging-matters">
            Why Messaging Platforms Matter
          </Link>
        </li>
      </ul>
    </div>
  );
}