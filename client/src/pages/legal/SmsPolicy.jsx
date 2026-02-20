import React from 'react';

export default function SmsPolicy() {
  return (
    <main style={{ maxWidth: 900, margin: '40px auto', padding: '0 20px', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <h1>Chatforia — SMS Policy & Opt-in</h1>

      <section>
        <h2>What we send</h2>
        <p>
          Chatforia sends only account-related and conversational SMS to phone numbers a user has
          explicitly provided and consented to. Typical messages include login/verification codes,
          message delivery alerts, security notices, and transactional account updates.
        </p>
      </section>

      <section>
        <h2>How users opt in</h2>
        <p>
          Users opt in by entering their phone number during registration and checking the SMS consent
          checkbox on the registration page or the dedicated
          <a href="/sms-consent"> opt-in form</a>.
        </p>
      </section>

      <section>
        <h2>How users opt out</h2>
        <ul>
          <li>Reply <strong>STOP</strong> to any Chatforia SMS to opt out.</li>
          <li>Reply <strong>START</strong> to resubscribe.</li>
          <li>Contact support at <a href="mailto:support@chatforia.com">support@chatforia.com</a>.</li>
        </ul>
      </section>

      <section>
        <h2>Help</h2>
        <p>Reply <strong>HELP</strong> for assistance or email <a href="mailto:support@chatforia.com">support@chatforia.com</a>.</p>
      </section>

      <section>
        <h2>Privacy & Terms</h2>
        <p>
          By consenting to SMS, users also agree to our
          <a href="/legal/terms"> Terms of Service</a> and
          <a href="/privacy"> Privacy Policy</a>.
        </p>
      </section>

      <footer style={{ marginTop: 40, fontSize: 13, color: '#666' }}>
        © {new Date().getFullYear()} Chatforia Inc.
      </footer>
    </main>
  );
}