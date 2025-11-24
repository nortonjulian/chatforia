import { transporter } from '../services/mailer.js';

/**
 * sendMail({ to, subject, text, html })
 *
 * @param {Object} options
 * @param {string|string[]} options.to
 * @param {string} options.subject
 * @param {string} [options.text]
 * @param {string} [options.html]
 */
export async function sendMail({ to, subject, text, html }) {
  if (!transporter) {
    throw new Error('Mailer transporter is not configured');
  }

  const from =
    process.env.MAIL_FROM ||
    process.env.SMTP_FROM ||
    'no-reply@chatforia.com';

  const mailOptions = {
    from,
    to,
    subject,
    text,
    html,
  };

  return transporter.sendMail(mailOptions);
}
