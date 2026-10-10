import prisma from '../utils/prismaClient.js';
import OpenAI from 'openai';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { promisify } from 'util';
import logger from '../utils/logger.js';
import { emitToUser } from './socketBus.js';
import { fetchTwilioMedia } from '../utils/twilioMediaProxy.js';
import {
  assertAndConsumeUsage,
  releaseUsage,
} from './planUsageService.js';

const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);

let openai = null;

try {
  if (process.env.OPENAI_API_KEY) {
    openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    console.log("✅ OpenAI initialized");
  } else {
    console.warn("⚠️ OpenAI disabled (no API key)");
  }
} catch (err) {
  console.error("❌ OpenAI init failed", err);
}

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
  if (!openai) {
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

  const durationSec = Math.max(
    0,
    Math.floor(Number(voicemail.durationSec || 0)),
  );

  if (durationSec <= 0) {
    logger?.warn?.(
      { voicemailId, userId: voicemail.user?.id },
      'Skipping transcription because voicemail duration is unavailable',
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

  const usageEventKey = `voicemail-transcription:${voicemail.id}`;
  let usageReserved = false;

  try {
    await prisma.voiceUsageCharge.create({
      data: {
        eventKey: usageEventKey,
        userId: Number(voicemail.user.id),
        meter: 'voicemailTranscriptionSeconds',
        seconds: durationSec,
      },
    });

    try {
      await assertAndConsumeUsage({
        userId: Number(voicemail.user.id),
        plan: voicemail.user.plan,
        meter: 'voicemailTranscriptionSeconds',
        amount: durationSec,
      });

      usageReserved = true;
    } catch (error) {
      await prisma.voiceUsageCharge.deleteMany({
        where: { eventKey: usageEventKey },
      });
      throw error;
    }
  } catch (error) {
    if (error?.code === 'P2002') {
      logger?.info?.(
        { voicemailId, userId: voicemail.user.id },
        'Skipping duplicate voicemail transcription job',
      );
      return;
    }

    if (error?.code === 'PLAN_ALLOWANCE_EXCEEDED') {
      logger?.info?.(
        {
          voicemailId,
          userId: voicemail.user.id,
          plan: voicemail.user.plan,
          durationSec,
        },
        'Skipping voicemail transcription because plan allowance is exhausted',
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

    throw error;
  }

  const audioUrl = voicemail.audioUrl;
  let tmpPath = null;

  try {
    const response = await fetchTwilioMedia(audioUrl);

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

    if (usageReserved) {
      try {
        await releaseUsage({
          userId: Number(voicemail.user.id),
          meter: 'voicemailTranscriptionSeconds',
          amount: durationSec,
        });

        await prisma.voiceUsageCharge.deleteMany({
          where: { eventKey: usageEventKey },
        });
      } catch (releaseError) {
        logger?.error?.(
          { releaseError, voicemailId },
          'Failed to release voicemail transcription usage',
        );
      }
    }

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