import prisma from '../../utils/prismaClient.js';

function monthKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export async function addUsageSeconds(userId, seconds) {
  const key = monthKey();
  await prisma.sTTUsage.upsert({
    where: { userId_monthKey: { userId, monthKey: key } },
    create: { userId, monthKey: key, seconds },
    update: { seconds: { increment: Math.max(0, Math.floor(seconds)) } },
  });
}

export async function getUsageSeconds(userId) {
  const row = await prisma.sTTUsage.findUnique({
    where: { userId_monthKey: { userId, monthKey: monthKey() } },
  });
  return row?.seconds || 0;
}

// -----------------------------------------------------------------------------
// B3) WebSocket captions (mock) — server/ws/captions.js
// Minimal WS server that streams fake partials; swap backend to real STT later.
import ws from 'ws';
const { WebSocketServer } = ws;

export function attachCaptionWS(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    if (!req.url.startsWith('/ws/captions')) return; // skip other upgrades
    wss.handleUpgrade(req, socket, head, (ws) =>
      wss.emit('connection', ws, req),
    );
  });

  wss.on('connection', (ws, req) => {
    // In real life, auth the user & callId from query or cookie
    ws.send(JSON.stringify({ type: 'hello', ok: true }));
    let i = 0;
    const timer = setInterval(() => {
      i += 1;
      if (ws.readyState === ws.OPEN) {
        ws.send(
          JSON.stringify({ type: 'partial', text: `mock caption ${i}` }),
        );
        if (i >= 10) {
          ws.send(
            JSON.stringify({ type: 'final', text: `final caption ${i}` }),
          );
        }
      }
    }, 1200);
    ws.on('close', () => clearInterval(timer));
    ws.on('error', () => clearInterval(timer));
  });
}
