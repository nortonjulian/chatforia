import { useTranslation } from 'react-i18next';

const LAST_UPDATED = 'November 3, 2026';

export default function SmsPolicy() {
  const { t } = useTranslation();

  return (
    <main
      style={{
        maxWidth: 900,
        margin: '0 auto',
        padding: '32px 20px 40px',
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
            "smsPolicy.whatWeSend.bodyAudit20261103",
          "Chatforia supports account-related SMS, such as verification codes and notifications, and user-to-user SMS/MMS. Account messages follow the applicable opt-in flow. Users sending messages through Chatforia must obtain required recipient consent and respect opt-outs. Message frequency varies. Message and data rates may apply."
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
              "smsPolicy.optOut.stopAudit20261103",
          "Reply STOP to the sending number to opt out of that SMS conversation or program."
            )}
          </li>

          <li>
            {t(
              "smsPolicy.optOut.startAudit20261103",
          "Reply START to the same number to resubscribe where supported."
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
        {t("smsPolicy.footerAudit20261103",
          "© 2026 Chatforia LLC.")}
      </footer>
    </main>
  );
}