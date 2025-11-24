import logger from '../utils/logger.js';
import { sendMail } from '../utils/mailer.js';

export async function sendVoicemailForwardEmail({
  toEmail,
  fromNumber,
  toNumber,
  transcript,
  audioUrl,
  durationSec,
  createdAt,
}) {
  if (!toEmail) {
    logger?.warn?.({ toEmail }, 'No toEmail provided for voicemail forward');
    return;
  }

  const subject = `New voicemail from ${fromNumber || 'Unknown caller'}`;
  const created = createdAt ? new Date(createdAt) : new Date();

  const plainLines = [
    `You have a new voicemail in Chatforia.`,
    '',
    `From: ${fromNumber || 'Unknown caller'}`,
    `To:   ${toNumber || 'Your Chatforia number'}`,
    `Time: ${created.toLocaleString()}`,
  ];

  if (typeof durationSec === 'number') {
    plainLines.push(`Duration: ${durationSec}s`);
  }

  if (transcript) {
    plainLines.push('', 'Transcript:', transcript);
  }

  if (audioUrl) {
    plainLines.push('', `Audio: ${audioUrl}`);
  }

  const text = plainLines.join('\n');

  const html = `
    <p>You have a new voicemail in <strong>Chatforia</strong>.</p>
    <ul>
      <li><strong>From:</strong> ${fromNumber || 'Unknown caller'}</li>
      <li><strong>To:</strong> ${toNumber || 'Your Chatforia number'}</li>
      <li><strong>Time:</strong> ${created.toLocaleString()}</li>
      ${
        typeof durationSec === 'number'
          ? `<li><strong>Duration:</strong> ${durationSec}s</li>`
          : ''
      }
    </ul>
    ${
      transcript
        ? `<p><strong>Transcript:</strong></p><pre>${escapeHtml(
            transcript
          )}</pre>`
        : ''
    }
    ${
      audioUrl
        ? `<p><a href="${audioUrl}" target="_blank" rel="noopener noreferrer">Listen to voicemail</a></p>`
        : ''
    }
  `;

  try {
    await sendMail({
      to: toEmail,
      subject,
      text,
      html,
    });
    logger?.info?.({ toEmail }, 'Voicemail forward email sent');
  } catch (err) {
    logger?.error?.({ err, toEmail }, 'Failed to send voicemail forward email');
  }
}

function escapeHtml(str = '') {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
