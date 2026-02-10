import express from 'express';
import multer from 'multer';
import prisma from '../utils/prismaClient.js';

const upload = multer({ storage: multer.memoryStorage() });
const router = express.Router();

function parseGcalUrl(u) {
  try {
    const url = new URL(u);
    if (!url.hostname.includes('calendar.google.com')) return null;
    const eid = url.searchParams.get('eid');
    return { id: eid || url.pathname.split('/').pop(), url: u };
  } catch { return null; }
}

function parseIcs(buffer) {
  const text = buffer.toString('utf8');
  const get = (k) => {
    const m = text.match(new RegExp(`^${k}:(.+)$`, 'm'));
    return m ? m[1].replace(/\\n/g, '\n').replace(/\\,/g, ',') : null;
  };
  const toISO = (v) => {
    if (!v) return null;
    if (/\d{8}T\d{6}Z/.test(v)) return v.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z');
    return null;
  };
  return {
    uid: get('UID'),
    title: get('SUMMARY'),
    description: get('DESCRIPTION'),
    location: get('LOCATION'),
    startISO: toISO(get('DTSTART')),
    endISO: toISO(get('DTEND')),
  };
}

// POST /share-event  (supports: .ics upload OR googleUrl+fields OR fields)
router.post('/share-event', upload.single('file'), express.json(), async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'unauthorized' });

    const chatId = req.body.chatId || req.query.chatId;
    if (!chatId) return res.status(400).json({ error: 'chatId required' });

    let payload = null;

    if (req.file) {
      const p = parseIcs(req.file.buffer);
      if (!p?.title || !p?.startISO || !p?.endISO) return res.status(400).json({ error: 'Invalid ICS' });
      payload = {
        title: p.title,
        description: p.description || '',
        location: p.location || '',
        startUTC: new Date(p.startISO),
        endUTC: new Date(p.endISO),
        externalSource: 'ics',
        externalUid: p.uid || null,
        url: null,
      };
    }

    if (!payload && req.body.googleUrl) {
      const info = parseGcalUrl(req.body.googleUrl);
      if (!info) return res.status(400).json({ error: 'Unrecognized Google Calendar URL' });
      const { title, description = '', location = '', startISO, endISO } = req.body.fields || {};
      if (!title || !startISO || !endISO) {
        return res.status(400).json({ error: 'fields {title,startISO,endISO} required with googleUrl' });
      }
      payload = {
        title, description, location,
        startUTC: new Date(startISO),
        endUTC: new Date(endISO),
        externalSource: 'google',
        externalUid: info.id,
        url: info.url,
      };
    }

    if (!payload && req.body.fields) {
      const { title, description = '', location = '', startISO, endISO } = req.body.fields;
      if (!title || !startISO || !endISO) return res.status(400).json({ error: 'title,startISO,endISO required' });
      payload = {
        title, description, location,
        startUTC: new Date(startISO),
        endUTC: new Date(endISO),
        externalSource: null,
        externalUid: null,
        url: null,
      };
    }

    if (!payload) return res.status(400).json({ error: 'Provide an .ics file, googleUrl, or fields' });
    if (payload.startUTC >= payload.endUTC) return res.status(400).json({ error: 'start must be before end' });

    const roomId = Number(req.body.chatId || req.query.chatId); // rename param later
    if (!Number.isFinite(roomId)) return res.status(400).json({ error: 'chatId must be a number' });

    const event = await prisma.event.create({ data: { ...payload, createdById: userId } });

    const message = await prisma.message.create({
      data: {
        chatRoomId: roomId,
        senderId: userId,

        // store something in rawContent so your UI shows it
        rawContent: `📅 Event shared: ${event.title}`,

        // placeholders until you formalize "message type"
        contentCiphertext: null,
        translatedFrom: null,
        translatedTo: null,
        translatedContent: null,
        translations: null,

        isExplicit: false,
        isAutoReply: false,
      },
      include: { sender: { select: { id: true, username: true } } },
    });

    res.json({
      ok: true,
      eventId: event.id,
      message: {
        id: message.id,
        chatRoomId: message.chatRoomId,
        senderId: message.senderId,
        senderUsername: message.sender?.username ?? null,
        rawContent: message.rawContent,
        translatedContent: message.translatedContent,
        contentCiphertext: message.contentCiphertext,
        createdAt: message.createdAt,
      },
    });

  } catch (e) { next(e); }
});

export default router;
