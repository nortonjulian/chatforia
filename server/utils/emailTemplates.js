const BRAND_NAME = "Chatforia";
const PRIMARY_COLOR = "#ffb844";
const TEXT_COLOR = "#111";
const MUTED_TEXT = "#666";

/**
 * Wraps email content in the standard Chatforia email layout
 */
function baseTemplate({ title, body }) {
  return `
  <div style="margin:0;padding:0;background:#f4f6fb;">
    <div style="width:100%;background:#f4f6fb;padding:32px 12px;">
      <div style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e9edf5;border-radius:20px;overflow:hidden;box-shadow:0 8px 30px rgba(16,24,40,0.06);">

        <div style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);padding:28px 28px 22px 28px;text-align:left;">
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;letter-spacing:0.12em;text-transform:uppercase;color:#ffcf70;font-weight:700;margin-bottom:10px;">
            ${BRAND_NAME}
          </div>

          <div style="font-family:Arial,Helvetica,sans-serif;font-size:28px;line-height:1.2;font-weight:700;color:#ffffff;margin:0;">
            ${title}
          </div>

          <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#d6ddeb;margin-top:10px;">
            Private, modern communication built for real connection.
          </div>
        </div>

        <div style="padding:32px 28px 20px 28px;font-family:Arial,Helvetica,sans-serif;color:${TEXT_COLOR};">
          ${body}
        </div>

        <div style="padding:0 28px 28px 28px;">
          <hr style="border:none;border-top:1px solid #e8ecf3;margin:0 0 24px 0;" />

          <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.7;color:${MUTED_TEXT};margin-bottom:18px;">
            Need help? Reach us at
            <a href="mailto:hello@chatforia.com" style="color:${PRIMARY_COLOR};text-decoration:none;font-weight:600;">
              hello@chatforia.com
            </a>
          </div>

          <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.7;color:${MUTED_TEXT};margin-bottom:16px;">
            Follow Chatforia:
            <a href="https://instagram.com/chatforia" style="color:${PRIMARY_COLOR};text-decoration:none;margin-left:8px;">Instagram</a>
            <span style="color:#c7ced9;margin:0 8px;">•</span>
            <a href="https://x.com/chatforia" style="color:${PRIMARY_COLOR};text-decoration:none;">X</a>
            <span style="color:#c7ced9;margin:0 8px;">•</span>
            <a href="https://linkedin.com/company/chatforia" style="color:${PRIMARY_COLOR};text-decoration:none;">LinkedIn</a>
          </div>

          <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.7;color:#8a94a6;">
            This message was sent by ${BRAND_NAME}. If you did not expect this email, you can safely ignore it.
          </div>
        </div>

      </div>
    </div>
  </div>
  `;
}


/**
 * Email verification template
 */
export function verificationEmailTemplate({ username, link }) {
  const safeName = username || "there";

  const subject = "Verify your Chatforia email";

  const text = [
    `Hi ${safeName},`,
    ``,
    `Welcome to Chatforia.`,
    `Please verify your email by visiting the link below:`,
    link,
    ``,
    `If you didn't create this account, you can ignore this email.`,
  ].join("\n");

  const body = `
    <p style="font-size:16px;line-height:1.6;">
      Hi ${safeName},
    </p>

    <p style="font-size:16px;line-height:1.6;">
      Thanks for signing up for Chatforia. Please verify your email address to activate your account.
    </p>

    <p style="margin:28px 0;">
      <a href="${link}"
         style="display:inline-block;padding:14px 22px;background:${PRIMARY_COLOR};color:${TEXT_COLOR};
         text-decoration:none;border-radius:10px;font-weight:700;">
        Verify Email
      </a>
    </p>

    <p style="font-size:14px;color:${MUTED_TEXT};line-height:1.6;">
      If the button doesn't work, copy and paste this link into your browser:
    </p>

    <p style="font-size:14px;word-break:break-word;color:${MUTED_TEXT};">
      ${link}
    </p>
  `;

  const html = baseTemplate({
    title: "Verify your email",
    body
  });

  return { subject, text, html };
}

/**
 * Password reset template
 */
export function passwordResetEmailTemplate({ username, link, expiresAt }) {
  const safeName = username || "there";

  const subject = "Reset your Chatforia password";

  const text = [
    `Hi ${safeName},`,
    ``,
    `We received a request to reset your Chatforia password.`,
    `Use the link below to set a new password:`,
    link,
    ``,
    `This link expires at ${expiresAt.toISOString()}.`,
    `If you didn't request this, you can ignore this email.`,
  ].join("\n");

  const body = `
    <p style="font-size:16px;line-height:1.6;">
      Hi ${safeName},
    </p>

    <p style="font-size:16px;line-height:1.6;">
      We received a request to reset your Chatforia password.
    </p>

    <p style="margin:28px 0;">
      <a href="${link}"
         style="display:inline-block;padding:14px 22px;background:${PRIMARY_COLOR};color:${TEXT_COLOR};
         text-decoration:none;border-radius:10px;font-weight:700;">
        Reset Password
      </a>
    </p>

    <p style="font-size:14px;color:${MUTED_TEXT};line-height:1.6;">
      This link expires at <strong>${expiresAt.toISOString()}</strong>.
    </p>

    <p style="font-size:14px;color:${MUTED_TEXT};line-height:1.6;">
      If the button doesn't work, copy and paste this link into your browser:
    </p>

    <p style="font-size:14px;word-break:break-word;color:${MUTED_TEXT};">
      ${link}
    </p>
  `;

  const html = baseTemplate({
    title: "Reset your password",
    body
  });

  return { subject, text, html };
}
