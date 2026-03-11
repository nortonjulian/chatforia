import { Resend } from 'resend';
import dotenv from 'dotenv';

dotenv.config();

const apiKey = process.env.RESEND_API_KEY;

if (!apiKey) {
  throw new Error('RESEND_API_KEY is missing from environment variables');
}

const resend = new Resend(apiKey);

export async function sendMail({
  to,
  subject,
  html,
  text,
  replyTo,
  from = process.env.EMAIL_FROM || 'Chatforia <hello@chatforia.com>',
  attachments,
}) {
  try {
    const { data, error } = await resend.emails.send({
      from,
      to,
      subject,
      html,
      text,
      reply_to: replyTo,
      attachments,
    });

    if (error) {
      console.error('Email send error:', error);
      return { success: false, error };
    }

    console.log('📧 Email sent:', data?.id);
    return { success: true, data };
  } catch (error) {
    console.error('Email send exception:', error);
    return { success: false, error };
  }
}

export async function sendTransactionalEmail(to, subject, { template, substitutions = {} }) {
  let html;

  switch (template) {
    case 'verify-email':
      html = `
        <div style="font-family: Arial, sans-serif; max-width:600px;margin:auto">
          <h1>Verify your Chatforia email</h1>
          <p>Click the button below to verify your email.</p>
          <p>
            <a href="${substitutions.link}"
               style="display:inline-block;padding:12px 20px;background:#ffb844;color:#111;
                      text-decoration:none;border-radius:8px;font-weight:600;">
              Verify Email
            </a>
          </p>
          <p>If you did not create this account, you can ignore this email.</p>
        </div>
      `;
      break;

    case 'password-reset':
      html = `
        <div style="font-family: Arial, sans-serif; max-width:600px;margin:auto">
          <h1>Reset your Chatforia password</h1>
          <p>Click below to reset your password.</p>
          <p>
            <a href="${substitutions.link}"
               style="display:inline-block;padding:12px 20px;background:#ffb844;color:#111;
                      text-decoration:none;border-radius:8px;font-weight:600;">
              Reset Password
            </a>
          </p>
        </div>
      `;
      break;

    default:
      throw new Error(`Unknown email template: ${template}`);
  }

  return sendMail({
    to,
    subject,
    html,
  });
}
