import { useTranslation } from 'react-i18next';

export default function ChatSafelyOnline() {
  const { t } = useTranslation();

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '2rem' }}>
      <h1>
        {t(
          'blog.chatSafely.title',
          'How to Chat Safely Online'
        )}
      </h1>

      <p>
        {t(
          'blog.chatSafely.intro',
          'Online communication has made it easier than ever to connect with people across the world. Whether you\'re messaging friends, meeting new people, or collaborating professionally, messaging platforms play a major role in everyday life. However, staying safe online is just as important as staying connected.'
        )}
      </p>

      <h2>
        {t(
          'blog.chatSafely.personalInfo.title',
          'Protect Your Personal Information'
        )}
      </h2>

      <p>
        {t(
          'blog.chatSafely.personalInfo.body',
          'One of the most important rules of online safety is to avoid sharing sensitive personal information. This includes your home address, financial details, passwords, or any identifying information that could be misused. Even in casual conversations, it\'s best to be mindful of what you share and who you share it with.'
        )}
      </p>

      <h2>
        {t(
          'blog.chatSafely.safetyFeatures.title',
          'Use Built-In Safety Features'
        )}
      </h2>

      <p>
        {t(
          'blog.chatSafely.safetyFeatures.body',
          'Modern messaging platforms like Chatforia provide tools to help users stay safe. Features such as blocking, reporting, and privacy controls are designed to give users control over their experience. If someone behaves inappropriately or makes you uncomfortable, you should use these tools immediately.'
        )}
      </p>

      <h2>
        {t(
          'blog.chatSafely.scams.title',
          'Be Aware of Scams'
        )}
      </h2>

      <p>
        {t(
          'blog.chatSafely.scams.body',
          'Scammers often use messaging platforms to trick users into sharing personal information or sending money. Be cautious of messages that seem too good to be true, such as unexpected offers, urgent requests, or unfamiliar links. Always verify the identity of the person you\'re communicating with before taking any action.'
        )}
      </p>

      <h2>
        {t(
          'blog.chatSafely.responsibly.title',
          'Communicate Responsibly'
        )}
      </h2>

      <p>
        {t(
          'blog.chatSafely.responsibly.body',
          'Respectful communication helps create a safer environment for everyone. Avoid engaging in harmful or abusive conversations, and be mindful of how your words may affect others. Positive interactions contribute to a better experience for all users.'
        )}
      </p>

      <h2>
        {t(
          'blog.chatSafely.whySafety.title',
          'Why Online Safety Matters'
        )}
      </h2>

      <p>
        {t(
          'blog.chatSafely.whySafety.body',
          'As digital communication continues to grow, maintaining safety and trust becomes increasingly important. By following basic safety practices and using available tools, users can enjoy the benefits of messaging while minimizing risks.'
        )}
      </p>

      <p>
        {t(
          'blog.chatSafely.conclusion',
          'Staying safe online doesn’t require advanced technical knowledge—just awareness, caution, and good judgment. With the right habits, you can communicate confidently and securely.'
        )}
      </p>
    </div>
  );
}