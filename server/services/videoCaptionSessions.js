// Per-viewer authorization and lifecycle for ephemeral video captions.
export function createVideoCaptionSessions({ db, provider, hasPremiumAccess,
  now = () => Date.now(), schedule = setInterval, cancel = clearInterval }) {
  const sessions = new Map();
  const fail = (status, code) => Object.assign(new Error(code), { status, code });
  const validId = id => Number.isSafeInteger(Number(id)) && Number(id) > 0;
  function identity(req) {
    const userId = Number(req.user?.id), callId = Number(req.params.callId);
    const sessionId = req.params.sessionId;
    if (!validId(userId)) throw fail(401, 'UNAUTHORIZED');
    if (!validId(callId) || !/^[A-Za-z0-9_-]{20,80}$/.test(sessionId || '')) throw fail(400, 'INVALID_CAPTION_SESSION');
    return { userId, callId, sessionId };
  }
  async function authorize({ userId, callId }) {
    const me = await db.user.findUnique({ where: { id: userId }, select: {
      id: true, role: true, plan: true, subscriptionStatus: true, subscriptionEndsAt: true, a11yLiveCaptions: true,
    } });
    if (!hasPremiumAccess(me, new Date(now()))) throw fail(402, 'PREMIUM_REQUIRED');
    if (me.a11yLiveCaptions !== true) throw fail(403, 'CAPTIONS_DISABLED');
    const call = await db.call.findFirst({ where: { id: callId, mode: 'VIDEO', status: 'ACTIVE', endedAt: null,
      OR: [{ callerId: userId }, { calleeId: userId }, { participants: { some: { userId, status: 'JOINED', leftAt: null } } }],
    }, select: { id: true, participants: { where: { userId }, select: { status: true, leftAt: true } } } });
    if (!call || call.participants?.some(p => p.leftAt || p.status !== 'JOINED')) throw fail(403, 'CALL_UNAVAILABLE');
  }
  async function close(entry) {
    entry.closed = true;
    if (entry.timer) cancel(entry.timer);
    if (sessions.get(entry.userId) === entry) sessions.delete(entry.userId);
    if (entry.providerId) await provider.stop(entry.providerId).catch(() => {});
  }
  function matching(req) {
    const ids = identity(req), entry = sessions.get(ids.userId);
    if (!entry || entry.callId !== ids.callId || entry.sessionId !== ids.sessionId || entry.closed) throw fail(404, 'CAPTION_SESSION_ENDED');
    return entry;
  }
  function error(res, err) {
    // Never log SDP, tokens, audio, or transcript text.
    return res.status(err.status || 503).json({ code: err.code || 'VIDEO_CAPTIONS_UNAVAILABLE' });
  }
  return {
    async start(req, res) {
      let entry;
      try {
        const ids = identity(req);
        const sdp = req.body?.sdp;
        if (typeof sdp !== 'string' || sdp.length > 80000 || !/^v=0\r?\n/.test(sdp) ||
            !/^m=audio /m.test(sdp) || /^m=video /m.test(sdp)) throw fail(400, 'INVALID_AUDIO_OFFER');
        await authorize(ids);
        // One caption connection per account, including while provider setup is pending.
        if (sessions.has(ids.userId)) throw fail(409, 'CAPTIONS_ALREADY_ACTIVE');
        entry = { ...ids, expires: now() + 20000, started: now(), closed: false };
        sessions.set(ids.userId, entry);
        const connection = await provider.start(sdp);
        entry.providerId = connection.id;
        await authorize(ids);
        if (entry.closed || sessions.get(ids.userId) !== entry || req.aborted) throw fail(409, 'CAPTION_SESSION_ENDED');
        entry.expires = now() + 20000;
        entry.timer = schedule(async () => {
          if (entry.checking || entry.closed) return;
          entry.checking = true;
          try {
            if (now() > entry.expires || now() - entry.started > 55 * 60000) throw fail(403, 'CAPTION_SESSION_ENDED');
            await authorize(entry);
          } catch { await close(entry); }
          finally { entry.checking = false; }
        }, 5000);
        entry.timer?.unref?.();
        res.set?.('Cache-Control', 'private, no-store');
        return res.json({ sdp: connection.sdp });
      } catch (err) { if (entry) await close(entry); return error(res, err); }
    },
    async lease(req, res) {
      let entry;
      try {
        entry = matching(req);
        await authorize(entry);
        if (now() > entry.expires || now() - entry.started > 55 * 60000) throw fail(403, 'CAPTION_SESSION_ENDED');
        entry.expires = now() + 20000;
        return res.json({ ok: true, reconnect: now() - entry.started >= 50 * 60000 });
      } catch (err) { if (entry) await close(entry); return error(res, err); }
    },
    async stop(req, res) {
      try {
        const ids = identity(req), entry = sessions.get(ids.userId);
        if (entry?.callId === ids.callId && entry.sessionId === ids.sessionId) await close(entry);
        return res.json({ ok: true });
      } catch (err) { return error(res, err); }
    },
  };
}
