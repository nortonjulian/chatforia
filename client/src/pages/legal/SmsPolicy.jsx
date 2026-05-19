import { useTranslation } from 'react-i18next';

const LAST_UPDATED = 'April 13, 2026';

export default function SmsPolicy() {
  const { t } = useTranslation();

  return (
    <main
      style={{
        maxWidth: 900,
        margin: '0 auto',
        padding: '100px 20px 40px',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      <h1>{t('smsPolicy.title', 'Chatforia — SMS Policy & Opt-in')}</h1>

      <p style={{ color: '#666', marginBottom: 24 }}>
        {t('smsPolicy.lastUpdated', 'Last updated:')} {LAST_UPDATED}
      </p>

      <section>
        <h2>{t('smsPolicy.whatWeSend.title', 'What we send')}</h2>

        <p>
          {t(
            'smsPolicy.whatWeSend.body',
            'Chatforia sends only account-related and conversational SMS to phone numbers a user has explicitly provided and consented to. Typical messages include login/verification codes, message delivery alerts, security notices, and transactional account updates.'
          )}
        </p>
      </section>

      <section>
        <h2>{t('smsPolicy.optIn.title', 'How users opt in')}</h2>

        <p>
          {t(
            'smsPolicy.optIn.body',
            'Users opt in by entering their phone number during registration and checking the SMS consent checkbox on the registration page or the dedicated'
          )}{' '}

          <a href="/legal/consent">
            {t('smsPolicy.optIn.link', 'opt-in form')}
          </a>.
        </p>
      </section>

      <section>
        <h2>{t('smsPolicy.optOut.title', 'How users opt out')}</h2>

        <ul>
          <li>
            {t(
              'smsPolicy.optOut.stop',
              'Reply STOP to any Chatforia SMS to opt out.'
            )}
          </li>

          <li>
            {t(
              'smsPolicy.optOut.start',
              'Reply START to resubscribe.'
            )}
          </li>

          <li>
            {t(
              'smsPolicy.optOut.contactPrefix',
              'Contact support at'
            )}{' '}

            <a href="mailto:support@chatforia.com">
              support@chatforia.com
            </a>.
          </li>
        </ul>
      </section>

      <section>
        <h2>{t('smsPolicy.help.title', 'Help')}</h2>

        <p>
          {t(
            'smsPolicy.help.bodyPrefix',
            'Reply HELP for assistance or email'
          )}{' '}

          <a href="mailto:support@chatforia.com">
            support@chatforia.com
          </a>.
        </p>
      </section>

      <section>
        <h2>{t('smsPolicy.privacyTerms.title', 'Privacy & Terms')}</h2>

        <p>
          {t(
            'smsPolicy.privacyTerms.bodyStart',
            'By consenting to SMS, users also agree to our'
          )}{' '}

          <a href="/legal/terms">
            {t('smsPolicy.privacyTerms.terms', 'Terms of Service')}
          </a>{' '}

          {t('smsPolicy.privacyTerms.and', 'and')}{' '}

          <a href="/privacy">
            {t('smsPolicy.privacyTerms.privacy', 'Privacy Policy')}
          </a>.
        </p>
      </section>

      <footer
        style={{
          marginTop: 40,
          fontSize: 13,
          color: '#666',
        }}
      >
        {t('smsPolicy.footer', '© 2026 Chatforia Inc.')}
      </footer>
    </main>
  );
}