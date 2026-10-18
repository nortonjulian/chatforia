// Message-scoped authorization and user-scoped storage. No message content is modified.
export function createVoiceNoteHandlers({ db, transcribe, hasPremiumAccess, config, now = () => new Date() }) {
  const pending = new Map();
  const fail = (status, code) => Object.assign(new Error(code), { status, code });
  const positiveId = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0;

  async function context(req) {
    if (!positiveId(req.params.messageId)) throw fail(400, 'INVALID_MESSAGE_ID');
    const messageId = Number(req.params.messageId);
    const userId = Number(req.user?.id);
    if (!positiveId(userId)) throw fail(401, 'UNAUTHORIZED');
    const msg = await db.message.findUnique({
      where: { id: messageId },
      include: { attachments: true, deletions: { where: { userId } } },
    });
    if (!msg || msg.deletedForAll || msg.deletedAt || msg.isHiddenByModeration ||
        (msg.deletedBySender && msg.senderId === userId) || msg.deletions?.length ||
        (msg.expiresAt && new Date(msg.expiresAt) <= now())) throw fail(404, 'MESSAGE_UNAVAILABLE');
    const member = await db.participant.findFirst({
      where: { chatRoomId: msg.chatRoomId, userId }, select: { id: true, clearedAt: true },
    });
    if (!member) throw fail(403, 'FORBIDDEN');
    if (member.clearedAt && new Date(msg.createdAt) <= new Date(member.clearedAt)) throw fail(404, 'MESSAGE_UNAVAILABLE');
    const me = await db.user.findUnique({ where: { id: userId } });
    if (!me?.a11yVoiceNoteSTT) throw fail(403, 'TRANSCRIPTION_DISABLED');
    const attachments = (msg.attachments || []).filter(a => !a.deletedAt &&
      (a.kind === 'AUDIO' || String(a.mimeType || '').startsWith('audio/')));
    const audio = attachments[0] || (msg.audioUrl ? { url: msg.audioUrl, durationSec: msg.audioDurationSec } : null);
    if (!audio?.url) throw fail(404, 'NO_AUDIO');
    // The existing endpoint represents one voice note, not a concatenation of unrelated files.
    if (attachments.length > 1) throw fail(422, 'MULTIPLE_AUDIO_UNSUPPORTED');
    const language = String(req.body?.language || me.preferredLanguage || 'en-US');
    if (!/^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/.test(language)) throw fail(400, 'INVALID_LANGUAGE');
    return { msg, me, audio, userId, messageId, language };
  }

  function premium(c) { return hasPremiumAccess(c.me, now()); }
  function freeLanguage(c) {
    return (config.FREE_STT_LANGS || ['en-US']).some(l => l === c.language || l.split('-')[0] === c.language);
  }
  async function cached(c) {
    if (c.me.a11yStoreTranscripts === false) return null;
    const cutoff = Math.max(new Date(c.msg.editedAt || c.msg.createdAt).getTime(),
      ...((c.msg.attachments || []).map(a => new Date(a.createdAt || c.msg.createdAt).getTime())),
      c.me.a11yTranscriptRetentionDays > 0 ? now().getTime() - c.me.a11yTranscriptRetentionDays * 86400000 : 0);
    const row = await db.transcript.findFirst({
      where: { userId: c.userId, messageId: c.messageId, language: c.language, createdAt: { gte: new Date(cutoff) } },
      orderBy: { createdAt: 'desc' }, select: { id: true, segments: true, language: true, createdAt: true },
    });
    // Discard synthetic data produced by the old mock adapter.
    if (row?.segments?.some?.(s => ['This is a mock transcription.', 'Replace me with a real STT provider.', '(transcript coming soon)'].includes(s?.text))) return null;
    return row;
  }
  async function generate(req) {
    const c = await context(req);
    if (!premium(c) && !freeLanguage(c)) throw fail(402, 'PREMIUM_REQUIRED');
    const existing = await cached(c);
    if (existing) return { ok: true, transcript: existing };
    const seconds = Math.max(1, Math.ceil(Number(c.audio.durationSec ?? c.msg.audioDurationSec) || 60));
    const date = now();
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const key = { userId: c.userId, monthKey };
    await db.sTTUsage.upsert({ where: { userId_monthKey: key }, create: { ...key, seconds: 0 }, update: {} });
    const budget = Math.max(0, Number(config.FREE_STT_MIN_PER_MONTH || 0) * 60);
    const reserved = await db.sTTUsage.updateMany({
      where: { ...key, ...(!premium(c) ? { seconds: { lte: budget - seconds } } : {}) },
      data: { seconds: { increment: seconds } },
    });
    if (!reserved.count) throw fail(402, 'TRANSCRIPTION_QUOTA_EXCEEDED');
    try {
      const result = await transcribe(c.audio.url, c.language);
      const text = String(result?.text || '').trim();
      const transcript = { language: c.language, segments: text ? [{ text }] : [], createdAt: now() };
      // A slow provider response must not disclose text after deletion, expiry, or opt-out.
      const current = await context(req);
      if (!premium(current) && !freeLanguage(current)) throw fail(402, 'PREMIUM_REQUIRED');
      if (current.audio.url !== c.audio.url || current.msg.revision !== c.msg.revision) throw fail(409, 'MESSAGE_CHANGED');
      if (current.me.a11yStoreTranscripts === false) return { ok: true, transcript: { ...transcript, ephemeral: true } };
      const saved = await db.transcript.create({
        data: { userId: c.userId, messageId: c.messageId, language: c.language, segments: transcript.segments },
        select: { id: true, segments: true, language: true, createdAt: true },
      });
      return { ok: true, transcript: saved };
    } catch (error) {
      await db.sTTUsage.updateMany({ where: { ...key, seconds: { gte: seconds } }, data: { seconds: { decrement: seconds } } });
      throw error;
    }
  }
  function replyError(res, error) {
    // Do not log audio URLs, credentials, or transcript text.
    return res.status(error.status || 503).json({ error: 'Voice-note transcription unavailable', code: error.code || 'TRANSCRIPTION_UNAVAILABLE' });
  }
  return {
    async post(req, res) {
      try {
        // Coalesce duplicate delivery/remounts for this account/message only.
        const key = `${req.user?.id}:${req.params.messageId}:${req.body?.language || ''}`;
        if (!pending.has(key)) {
          const job = generate(req).finally(() => { if (pending.get(key) === job) pending.delete(key); });
          pending.set(key, job);
        }
        const value = await pending.get(key);
        await context(req);
        res.set?.('Cache-Control', 'private, no-store');
        return res.json(value);
      } catch (error) { return replyError(res, error); }
    },
    async get(req, res) {
      try {
        const c = await context(req);
        if (!premium(c) && !freeLanguage(c)) throw fail(402, 'PREMIUM_REQUIRED');
        res.set?.('Cache-Control', 'private, no-store');
        return res.json({ transcript: await cached(c) });
      } catch (error) { return replyError(res, error); }
    },
  };
}
