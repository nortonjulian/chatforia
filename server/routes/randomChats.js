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

    // 🔍 user wants to find a human match
    socket.on('find_random_chat', async () => {
      if (
        queues.waitingBySocket.has(socket.id) ||
        queues.activeRoomBySocket.get(socket.id)
      )
        return;

      const entry = {
        socketId: socket.id,
        userId: u.id,
        username: u.username || `user:${u.id}`,
        ageBand: u.ageBand || null,
        wantsAgeFilter: !!u.wantsAgeFilter,
      };

      await tryMatch({
        queues,
        prisma,
        io,
        currentEntry: entry,
        getSocketById,
      });
    });

    // 💬 sending a message (human or AI room)
    socket.on('send_message', async (payload) => {
      if (!payload?.content || !payload?.randomChatRoomId) return;

      const senderId = u.id;
      const roomId = payload.randomChatRoomId;

      const userMessage = {
        content: payload.content,
        senderId,
        randomChatRoomId: roomId,
        sender: { id: senderId, username: u.username || `user:${senderId}` },
        createdAt: new Date().toISOString(),
      };

      // 🤖 AI room: echo user message to UI, then send Ria reply
      if (isAiRoom(roomId)) {
        // show the user's bubble in the UI
        socket.emit('receive_message', userMessage);

        try {
          const replyText = await buildRiaReply({
            user: u,
            text: payload.content,
          });

          socket.emit('receive_message', {
            content: replyText,
            senderId: 0,
            randomChatRoomId: roomId,
            sender: { id: 0, username: 'Ria' },
            createdAt: new Date().toISOString(),
          });
        } catch (err) {
          // already logged in buildRiaReply; send a soft fallback
          socket.emit('receive_message', {
            content:
              'I had a hiccup replying just now, but I’m still here. Want to try again?',
            senderId: 0,
            randomChatRoomId: roomId,
            sender: { id: 0, username: 'Ria' },
            createdAt: new Date().toISOString(),
          });
        }

        return;
      }

      // 👥 Human–human random room: broadcast to the shared room
      io.to(`random:${roomId}`).emit('receive_message', userMessage);
    });

    // 🚪 user cancels / leaves random chat
    socket.on('skip_random_chat', () => {
      // If queued, remove and inform client
      if (queues.waitingBySocket.has(socket.id)) {
        removeFromQueue(queues, socket.id);
        // Let the client localize the status message
        socket.emit('chat_skipped');
        return;
      }

      // If in an active room, notify peer and cleanup
      const active = queues.activeRoomBySocket.get(socket.id);
      if (active) {
        const { roomId, peerSocketId } = active;
        const peerSocket = getSocketById(peerSocketId);
        if (peerSocket) {
          peerSocket.leave(`random:${roomId}`);
          // Client will show localized "partner disconnected" message
          peerSocket.emit('partner_disconnected');
          queues.activeRoomBySocket.delete(peerSocketId);
        }
        socket.leave(`random:${roomId}`);
        queues.activeRoomBySocket.delete(socket.id);
        // Localized "you left / cancelled" on client
        socket.emit('chat_skipped');
      }
    });

    // 🤖 Start AI-only room
    socket.on('start_ai_chat', () => {
      const aiRoom = `random:AI:${socket.id}`;
      socket.join(aiRoom);
      socket.emit('pair_found', {
        roomId: aiRoom,
        partner: 'Ria',
        partnerId: 0,
        isAI: true,
      });

      // 👇 Ria's intro message is now created client-side via i18n,
      // so we don't emit a hard-coded English string here.
    });

    socket.on('disconnect', () => {
      if (queues.waitingBySocket.has(socket.id)) {
        removeFromQueue(queues, socket.id);
      }
      const active = queues.activeRoomBySocket.get(socket.id);
      if (active) {
        const { roomId, peerSocketId } = active;
        const peerSocket = getSocketById(peerSocketId);
        if (peerSocket) {
          peerSocket.leave(`random:${roomId}`);
          // Again, client will localize the message
          peerSocket.emit('partner_disconnected');
          queues.activeRoomBySocket.delete(peerSocketId);
        }
        queues.activeRoomBySocket.delete(socket.id);
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
