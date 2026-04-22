import prisma from '../utils/prismaClient.js';
import OpenAI from 'openai';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { promisify } from 'util';
import logger from '../utils/logger.js';
import { emitToUser } from './socketBus.js';

const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Fire-and-forget entry point.
 */
export async function enqueueVoicemailTranscription(voicemailId) {
  try {
    await transcribeVoicemail(voicemailId);
  } catch (err) {
    logger?.error?.({ err, voicemailId }, 'Voicemail transcription failed in enqueue');
  }
}

async function transcribeVoicemail(voicemailId) {
  if (!process.env.OPENAI_API_KEY) {
    logger?.warn?.('OPENAI_API_KEY not set, skipping voicemail transcription');

    const failed = await prisma.voicemail.update({
      where: { id: voicemailId },
      data: { transcriptStatus: 'FAILED' },
      select: {
        id: true,
        userId: true,
        transcript: true,
        transcriptStatus: true,
      },
    });

    emitToUser(failed.userId, 'voicemail:updated', {
      id: failed.id,
      transcript: failed.transcript,
      transcriptStatus: failed.transcriptStatus,
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

  if (voicemail.user?.plan === 'FREE') {
    logger?.info?.(
      { voicemailId, userId: voicemail.user.id },
      'Skipping transcription for FREE plan user',
    );

    const failed = await prisma.voicemail.update({
      where: { id: voicemailId },
      data: { transcriptStatus: 'FAILED' },
      select: {
        id: true,
        userId: true,
        transcript: true,
        transcriptStatus: true,
      },
    });

    emitToUser(failed.userId, 'voicemail:updated', {
      id: failed.id,
      transcript: failed.transcript,
      transcriptStatus: failed.transcriptStatus,
    });

    return;
  }

  const audioUrl = voicemail.audioUrl;
  let tmpPath = null;

  try {
    const response = await fetch(audioUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch voicemail audio: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const tmpDir = os.tmpdir();
    tmpPath = path.join(tmpDir, `voicemail-${voicemailId}-${Date.now()}.mp3`);

    await writeFile(tmpPath, buffer);

    const fileStream = fs.createReadStream(tmpPath);

    const result = await openai.audio.transcriptions.create({
      file: fileStream,
      model: 'gpt-4o-transcribe',
    });

    const text = result.text || '';

    const updated = await prisma.voicemail.update({
      where: { id: voicemailId },
      data: {
        transcript: text,
        transcriptStatus: 'COMPLETE',
      },
      select: {
        id: true,
        userId: true,
        transcript: true,
        transcriptStatus: true,
      },
    });

    emitToUser(updated.userId, 'voicemail:updated', {
      id: updated.id,
      transcript: updated.transcript,
      transcriptStatus: updated.transcriptStatus,
    });

    logger?.info?.(
      { voicemailId, userId: voicemail.user?.id },
      'Voicemail transcription completed',
    );
  } catch (err) {
    logger?.error?.({ err, voicemailId }, 'Error during voicemail transcription');

    const failed = await prisma.voicemail.update({
      where: { id: voicemailId },
      data: {
        transcriptStatus: 'FAILED',
      },
      select: {
        id: true,
        userId: true,
        transcript: true,
        transcriptStatus: true,
      },
    });

    emitToUser(failed.userId, 'voicemail:updated', {
      id: failed.id,
      transcript: failed.transcript,
      transcriptStatus: failed.transcriptStatus,
    });
  } finally {
    if (tmpPath) {
      try {
        await unlink(tmpPath);
      } catch (cleanupErr) {
        logger?.warn?.({ cleanupErr, tmpPath }, 'Failed to cleanup temp voicemail file');
      }
    }
  }
}