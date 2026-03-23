import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import pkg from '@prisma/client';
const { PrismaClient } = pkg;

import {
  buildQueues,
  areCompatible,
  enqueue,
  removeFromQueue,
  tryMatch,
  requestAddFriend,
  skipRandomChat,
  handleDisconnect,
} from '../services/randomChatService.js';

// 🔮 OpenAI (Ria bot brain)
import OpenAI from 'openai';

const prisma = new PrismaClient();
const router = express.Router();

/** ==== shared in-memory matchmaking state (kept as before) ==== */
let ioRef = null;
const queues = buildQueues();

/** Lazy OpenAI client so we don't crash if key is missing */
let openaiClient = null;
function getOpenAI() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: key });
  }
  return openaiClient;
}

function getSocketUser(socket) {
  return (
    socket.user ||
    socket.data?.user ||
    socket.request?.user ||
    socket.handshake?.auth?.user ||
    null
  );
}

function getSocketById(socketId) {
  return ioRef?.sockets?.sockets?.get(socketId) || null;
}

// ✅ helper: detect an AI room vs human room
function isAiRoom(roomId) {
  return typeof roomId === 'string' && roomId.startsWith('random:AI:');
}

// 🧠 Build a reply from Ria using gpt-4.1-mini, with optional per-user memory
async function buildRiaReply({ user, text }) {
  const client = getOpenAI();
  if (!client) {
    console.error('[Ria] Missing OPENAI_API_KEY env; returning fallback reply');
    return "I’m having trouble connecting to my brain right now, but I’m here to chat!";
  }

  // Default: remember is ON unless explicitly set false
  // (still using existing foriaRemember column for now)
  const remember = user?.foriaRemember !== false;
  const preferredLang = user?.preferredLanguage || 'en';

  // 1) Load recent history ONLY if remember is on
  let history = [];
  if (remember && user?.id) {
    try {
      history = await prisma.foriaMessage.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'asc' },
        take: 20,
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[Ria] Failed to load history', e);
    }
  }

  const messages = [
    {
      role: 'system',
      content: `
You are Ria, a friendly chat companion inside the Chatforia app.

- Always reply in the user's preferred language: ${preferredLang}.
- The user's internal id is ${user?.id ?? 'unknown'}.
- The user's memory setting is currently ${remember ? 'ON' : 'OFF'}.
  - When memory is ON, you may rely on earlier messages from this user to remember their name, preferences, work, hobbies, and past topics so it feels like an ongoing friendship.
  - When memory is OFF, DO NOT rely on earlier messages; treat each turn more like a fresh chat and don't claim to remember details.

- You are always talking to the SAME user in this conversation.
- If the user tells you their name or what they prefer to be called, use that name naturally in future replies (while memory is ON).
- If you don't know their name yet and it feels natural, you may politely ask once (for example: "What should I call you?").
- If the user has both a real name and a username/nickname, you can occasionally mix them in a friendly way (like a nickname), but don't switch so often that it feels unnatural.
- You may see previous messages between you and this user. Never mention "stored messages", databases, or logs.
- Speak casually, warmly, and helpfully.
- Answer questions directly, add little bits of personality, and ask simple follow-up questions sometimes.
- Keep responses short (1–3 sentences) unless the user clearly wants a longer explanation.
- Never just repeat what they said back to you.
      `.trim(),
    },
    ...history.map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    })),
    { role: 'user', content: text },
  ];

  let replyText;

  try {
    const response = await client.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages,
      max_tokens: 200,
      temperature: 0.8,
    });

    replyText =
      response.choices?.[0]?.message?.content?.trim() ||
      "Hmm, I'm not sure what to say. Want to try asking that another way?";
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Ria AI error:', err);
    replyText =
      "Oops, I had trouble replying just now. Want to try asking that again or change the topic?";
  }

  // 3) Persist this turn ONLY if remember is on
  if (remember && user?.id) {
    try {
      await prisma.foriaMessage.createMany({
        data: [
          { userId: user.id, role: 'user', content: text },
          { userId: user.id, role: 'assistant', content: replyText },
        ],
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[Ria] Failed to store memory', e);
    }
  }

  return replyText;
}

/**
 * Attach socket handlers for random chat.
 */
export function attachRandomChatSockets(io) {
  ioRef = io;

  io.on('connection', (socket) => {
  const u = getSocketUser(socket);
  if (!u?.id) return;

  // 🔍 JOIN RANDOM QUEUE
  socket.on('random:join', async (payload = {}) => {
    if (
      queues.waitingBySocket.has(socket.id) ||
      queues.activeRoomBySocket.get(socket.id)
    ) return;

    const entry = {
      socketId: socket.id,
      userId: u.id,
      username: u.username || `user:${u.id}`,
      ageBand: u.ageBand || null,
      wantsAgeFilter: !!u.wantsAgeFilter,
      topic: payload.topic || null,
      region: payload.region || null,
    };

    await tryMatch({
      queues,
      prisma,
      io,
      currentEntry: entry,
      getSocketById,
    });
  });

  // 🚪 LEAVE QUEUE
  socket.on('random:leave', () => {
    removeFromQueue(queues, socket.id);
  });

  // 💬 MESSAGE
  socket.on('random:message', async (payload) => {
    if (!payload?.content || !payload?.roomId) return;

    const senderId = u.id;
    const roomId = payload.roomId;

    const message = {
      content: payload.content,
      senderId,
      randomChatRoomId: roomId,
      sender: { id: senderId, username: u.username },
      createdAt: new Date().toISOString(),
    };

    if (isAiRoom(roomId)) {
      socket.emit('random:message', message);

      const reply = await buildRiaReply({
        user: u,
        text: payload.content,
      });

      socket.emit('random:message', {
        content: reply,
        senderId: 0,
        randomChatRoomId: roomId,
        sender: { id: 0, username: 'Ria' },
        createdAt: new Date().toISOString(),
      });

      return;
    }

    io.to(`random:${roomId}`).emit('random:message', message);
  });

  // 🤝 ADD FRIEND
  socket.on('random:add_friend', async ({ roomId }) => {
    const result = await requestAddFriend({
      queues,
      io,
      prisma,
      roomId,
      userId: u.id,
    });

    // handled internally (emit inside service)
  });

  // ⏭ SKIP
  socket.on('random:skip', () => {
    const result = skipRandomChat({
      queues,
      io,
      socketId: socket.id,
    });

    if (result?.roomId) {
      socket.emit('random:ended', {
        roomId: result.roomId,
        reason: 'you_skipped',
      });
    }
  });

  // 🤖 START RIA
  socket.on('random:ai_start', () => {
    const aiRoom = `random:AI:${socket.id}`;
    socket.join(aiRoom);

    socket.emit('random:ai_started', {
      roomId: aiRoom,
      name: 'Ria',
    });
  });

  // 🔌 DISCONNECT
  socket.on('disconnect', () => {
    const result = handleDisconnect({
      queues,
      io,
      socketId: socket.id,
    });

    if (result?.roomId) {
      const peerSocket = getSocketById(result.peerSocketId);
      if (peerSocket) {
        peerSocket.emit('random:ended', {
          roomId: result.roomId,
          reason: 'peer_disconnected',
        });
      }
    }
  });
});
}

/** ==== REST routes (mostly unchanged) ================================================= */

router.post('/', requireAuth, async (req, res) => {
  const { messages, participants } = req.body;
  if (!Array.isArray(messages))
    return res.status(400).json({ error: 'messages must be an array' });
  if (!Array.isArray(participants) || participants.length !== 2)
    return res
      .status(400)
      .json({ error: 'participants must be an array of two user IDs' });

  try {
    const savedChat = await prisma.randomChatRoom.create({
      data: {
        participants: { connect: participants.map((id) => ({ id: Number(id) })) },
        messages: {
          create: messages.map((msg) => ({
            content: msg.content,
            sender: { connect: { id: Number(msg.senderId) } },
          })),
        },
      },
      include: { participants: true, messages: { include: { sender: true } } },
    });
    res.status(201).json(savedChat);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error saving random chat:', error);
    res.status(500).json({ error: 'Failed to save chat' });
  }
});

router.get('/', requireAuth, async (req, res) => {
  try {
    const chats = await prisma.randomChatRoom.findMany({
      where: { participants: { some: { id: req.user.id } } },
      include: { participants: true, messages: { include: { sender: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json(chats);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error fetching saved chats:', error);
    res.status(500).json({ error: 'Failed to fetch chats' });
  }
});

router.get('/id/:id', requireAuth, async (req, res) => {
  const chatId = Number(req.params.id);
  const userId = req.user.id;
  if (!Number.isFinite(chatId))
    return res.status(400).json({ error: 'Invalid chat id' });

  try {
    const chat = await prisma.randomChatRoom.findUnique({
      where: { id: chatId },
      include: {
        participants: true,
        messages: {
          include: { sender: { select: { id: true, username: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!chat || !chat.participants.some((p) => p.id === userId))
      return res
        .status(403)
        .json({ error: 'You do not have access to this chat.' });
    res.json(chat);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to fetch random chat:', error);
    res.status(500).json({ error: 'Failed to load chat' });
  }
});

// 🧹 Clear Ria memory for the current user
// (still stored in prisma.foriaMessage table)
router.delete('/ria/memory', requireAuth, async (req, res) => {
  try {
    await prisma.foriaMessage.deleteMany({
      where: { userId: req.user.id },
    });
    res.json({ ok: true });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Failed to clear Ria memory', err);
    res.status(500).json({ error: 'Failed to clear Ria memory' });
  }
});

export default router;
