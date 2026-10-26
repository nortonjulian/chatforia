import logger from '../utils/logger.js';
import { sendMail } from '../utils/sendMail.js';

export async function sendVoicemailForwardEmail({
  voicemailId,
  toEmail,
  fromNumber,
  fromDisplayName,
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

  const callerLabel =
    String(
      fromDisplayName ||
      fromNumber ||
      'Unknown caller'
    )
      .replace(/[\r\n]+/g, ' ')
      .trim() || 'Unknown caller';

  // Open the authenticated inbox; never send a provider recording URL.
  const safeId = typeof voicemailId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(voicemailId) ? voicemailId : null;
  const listenUrl = `https://www.chatforia.com/voicemail${safeId ? `?id=${encodeURIComponent(safeId)}` : ''}`;
  const subject = `New voicemail from ${callerLabel}`;
  const created = createdAt ? new Date(createdAt) : new Date();

  const plainLines = [
    `You have a new voicemail in Chatforia.`,
    '',
    `From: ${callerLabel}`,
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
    plainLines.push('', `Listen to voicemail: ${listenUrl}`, 'Sign in to the Chatforia account that received this voicemail.');
  }

  const text = plainLines.join('\n');

  const html = `
    <p>You have a new voicemail in <strong>Chatforia</strong>.</p>
    <ul>
      <li><strong>From:</strong> ${escapeHtml(callerLabel)}</li>
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
        ? `<p><a href="${listenUrl}" target="_blank" rel="noopener noreferrer">Listen to voicemail</a></p><p>Sign in to the Chatforia account that received this voicemail.</p>`
        : ''
    }
  `;

  try {
    const result = await sendMail({
      to: toEmail,
      subject,
      text,
      html,
    });

    // sendMail reports provider rejection as { success: false } rather
    // than throwing. Do not mark a failed submission as sent.
    if (result?.success !== true) {
      logger?.error?.(
        { err: result?.error ?? new Error('Email provider did not confirm submission'), toEmail },
        'Failed to send voicemail forward email'
      );
      return;
    }

    logger?.info?.({ toEmail }, 'Voicemail forward email accepted by provider');
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
