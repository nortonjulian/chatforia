import prisma from '../utils/prismaClient.js';
import OpenAI from 'openai';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { promisify } from 'util';
import logger from '../utils/logger.js';

const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Simple entry point.
 * In the future you can push this to a queue and have a worker call transcribeVoicemail.
 */
export async function enqueueVoicemailTranscription(voicemailId) {
  // Fire-and-forget wrapper if you want to call it without awaiting in HTTP handlers.
  try {
    await transcribeVoicemail(voicemailId);
  } catch (err) {
    logger?.error?.({ err, voicemailId }, 'Voicemail transcription failed in enqueue');
  }
}

async function transcribeVoicemail(voicemailId) {
  if (!process.env.OPENAI_API_KEY) {
    logger?.warn?.('OPENAI_API_KEY not set, skipping voicemail transcription');
    await prisma.voicemail.update({
      where: { id: voicemailId },
      data: { transcriptStatus: 'FAILED' },
    });
    return;
  }

  const voicemail = await prisma.voicemail.findUnique({
    where: { id: voicemailId },
    include: {
      user: {
        select: {
          id: true,
          plan: true,
        },
      },
    },
  });

  if (!voicemail) {
    logger?.warn?.({ voicemailId }, 'Voicemail not found for transcription');
    return;
  }

  // Optional: gate transcription by plan (only non-FREE get it)
  if (voicemail.user?.plan === 'FREE') {
    logger?.info?.(
      { voicemailId, userId: voicemail.user.id },
      'Skipping transcription for FREE plan user',
    );
    await prisma.voicemail.update({
      where: { id: voicemailId },
      data: { transcriptStatus: 'FAILED' },
    });
    return;
  }

  // Fetch audio from Twilio (or wherever you stored it)
  // NOTE: depending on your Twilio settings, you may need to append ".mp3"
  // or include basic auth in the URL. For now we use the stored URL as-is.
  const audioUrl = voicemail.audioUrl;

  try {
    const response = await fetch(audioUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch voicemail audio: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Write buffer to a temp file so we can stream it to OpenAI
    const tmpDir = os.tmpdir();
    const tmpPath = path.join(tmpDir, `voicemail-${voicemailId}-${Date.now()}.mp3`);

    await writeFile(tmpPath, buffer);

    // Create a ReadStream for OpenAI
    const fileStream = fs.createReadStream(tmpPath);

    // Call OpenAI transcription
    // You can swap model to 'whisper-1' if you prefer.
    const result = await openai.audio.transcriptions.create({
      file: fileStream,
      model: 'gpt-4o-transcribe', // or 'whisper-1'
      // language: 'en', // optionally specify
    });

    const text = result.text || '';

    await prisma.voicemail.update({
      where: { id: voicemailId },
      data: {
        transcript: text,
        transcriptStatus: 'COMPLETE',
      },
    });

    logger?.info?.(
      { voicemailId, userId: voicemail.user?.id },
      'Voicemail transcription completed',
    );

    // Clean up temp file
    try {
      await unlink(tmpPath);
    } catch (cleanupErr) {
      logger?.warn?.({ cleanupErr, tmpPath }, 'Failed to cleanup temp voicemail file');
    }
  } catch (err) {
    logger?.error?.({ err, voicemailId }, 'Error during voicemail transcription');
    await prisma.voicemail.update({
      where: { id: voicemailId },
      data: {
        transcriptStatus: 'FAILED',
      },
    });
  }
}
