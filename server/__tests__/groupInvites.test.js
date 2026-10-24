import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { readFileSync } from 'node:fs';

const db = {
  chatRoom: { findUnique: jest.fn() },
  chatRoomInvite: {
    create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(),
    deleteMany: jest.fn(), updateMany: jest.fn(),
  },
  participant: { findUnique: jest.fn(), create: jest.fn() },
  $transaction: jest.fn(),
};
await jest.unstable_mockModule('../utils/prismaClient.js', () => ({ default: db }));
await jest.unstable_mockModule('../middleware/auth.js', () => ({
  requireAuth: (req, _res, next) => { req.user = { id: 1 }; next(); },
}));
const router = (await import('../routes/groupInvites.js')).default;
function app() {
  const a = express();
  a.use(express.json());
  a.use('/', router);
  return a;
}
const group = { isGroup: true, ownerId: 1, participants: [{ role: 'ADMIN' }] };
const future = () => new Date(Date.now() + 3_600_000);
const invite = (extra = {}) => ({
  id: 7, chatRoomId: 10, code: 'test-code', maxUses: 5, uses: 0,
  expiresAt: future(), chatRoom: { isGroup: true, id: 10, name: 'Test group' },
  ...extra,
});

beforeEach(() => {
  jest.clearAllMocks();
  process.env.APP_BASE_URL = 'https://www.chatforia.com';
  db.chatRoom.findUnique.mockResolvedValue(group);
  db.chatRoomInvite.create.mockResolvedValue({ code: 'newcode', expiresAt: future(), maxUses: 2, uses: 0 });
  db.chatRoomInvite.findUnique.mockImplementation(async () => invite());
  db.chatRoomInvite.findMany.mockResolvedValue([]);
  db.chatRoomInvite.deleteMany.mockResolvedValue({ count: 1 });
  db.chatRoomInvite.updateMany.mockResolvedValue({ count: 1 });
  db.participant.findUnique.mockResolvedValue(null);
  db.participant.create.mockResolvedValue({ id: 42 });
  db.$transaction.mockImplementation(async cb => cb(db));
});

test('production app registers group invite router explicitly', () => {
  const code = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  expect(code).toMatch(/import groupInvitesRouter from '\.\/routes\/groupInvites\.js'/);
  expect(code).toMatch(/app\.use\('\/', groupInvitesRouter\)/);
});
test('owner creates real invite URL using schema `uses` field', async () => {
  const r = await request(app()).post('/chatrooms/10/invites')
    .send({ expiresInMinutes: 60, maxUses: 2 }).expect(200);
  expect(r.body.url).toBe('https://www.chatforia.com/join/newcode');
  expect(r.body.uses).toBe(0);
  expect(db.chatRoomInvite.create.mock.calls[0][0].select).toHaveProperty('uses', true);
  expect(db.chatRoomInvite.create.mock.calls[0][0].data.expiresAt).toBeInstanceOf(Date);
});
test('rejects invalid limits and refuses to create', async () => {
  await request(app()).post('/chatrooms/10/invites').send({ maxUses: -1 }).expect(400);
  await request(app()).post('/chatrooms/10/invites').send({ expiresInMinutes: 999999 }).expect(400);
  expect(db.chatRoomInvite.create).not.toHaveBeenCalled();
});
test('a regular member cannot generate invites', async () => {
  db.chatRoom.findUnique.mockResolvedValue({ isGroup: true, ownerId: 2, participants: [{ role: 'MEMBER' }] });
  await request(app()).post('/chatrooms/10/invites').send({}).expect(403);
  expect(db.chatRoomInvite.create).not.toHaveBeenCalled();
});
test('a direct chat cannot create group invites', async () => {
  db.chatRoom.findUnique.mockResolvedValue({ isGroup: false, ownerId: 1, participants: [{ role: 'ADMIN' }] });
  await request(app()).post('/chatrooms/10/invites').send({}).expect(400);
});
test('list uses valid schema fields and owner permission', async () => {
  db.chatRoomInvite.findMany.mockResolvedValue([{ code:'one', uses:0, maxUses:5 }]);
  const r=await request(app()).get('/chatrooms/10/invites').expect(200);
  expect(r.body).toHaveLength(1);
  expect(db.chatRoomInvite.findMany.mock.calls[0][0].select.uses).toBe(true);
});
test('revoking removes token only from current group', async () => {
  await request(app()).delete('/chatrooms/10/invites/safe').expect(200);
  expect(db.chatRoomInvite.deleteMany).toHaveBeenCalledWith({where:{code:'safe',chatRoomId:10}});
});
test('missing invite cannot be revoked', async () => {
  db.chatRoomInvite.deleteMany.mockResolvedValue({count:0});
  await request(app()).delete('/chatrooms/10/invites/missing').expect(404);
});
test('preview returns room name, valid state, and no secret membership data', async () => {
  const r=await request(app()).get('/invites/test-code').expect(200);
  expect(r.body).toEqual({ code:'test-code',roomId:10,roomName:'Test group',status:'ok'});
});
test('expired and exhausted invites report their status', async () => {
  db.chatRoomInvite.findUnique.mockResolvedValueOnce(invite({expiresAt:new Date(0)}));
  expect((await request(app()).get('/invites/old')).body.status).toBe('expired');
  db.chatRoomInvite.findUnique.mockResolvedValueOnce(invite({uses:5,maxUses:5}));
  expect((await request(app()).get('/invites/used')).body.status).toBe('exhausted');
});
test('missing invite returns 404 without revealing participants', async () => {
  db.chatRoomInvite.findUnique.mockResolvedValue(null);
  await request(app()).get('/invites/missing').expect(404);
});
test('accept atomically claims a usage and creates membership', async () => {
  const r=await request(app()).post('/invites/test-code/accept').send({}).expect(200);
  expect(r.body).toEqual({ok:true, roomId:10, alreadyMember:false});
  expect(db.$transaction).toHaveBeenCalledTimes(1);
  expect(db.chatRoomInvite.updateMany).toHaveBeenCalledWith(expect.objectContaining({
    data:{uses:{increment:1}},
  }));
  expect(db.participant.create).toHaveBeenCalledWith({data:{chatRoomId:10,userId:1,role:'MEMBER'}});
});
test('already joined member does not use another invite slot', async () => {
  db.participant.findUnique.mockResolvedValue({id:99});
  const r=await request(app()).post('/invites/test-code/accept').expect(200);
  expect(r.body.alreadyMember).toBe(true);
  expect(db.chatRoomInvite.updateMany).not.toHaveBeenCalled();
});
test('expired invitation cannot join', async () => {
  db.chatRoomInvite.findUnique.mockResolvedValue(invite({expiresAt:new Date(0)}));
  await request(app()).post('/invites/test-code/accept').expect(410);
  expect(db.participant.create).not.toHaveBeenCalled();
});
test('when conditional quota claim fails, no participant is created', async () => {
  db.chatRoomInvite.updateMany.mockResolvedValue({count:0});
  await request(app()).post('/invites/test-code/accept').expect(410);
  expect(db.participant.create).not.toHaveBeenCalled();
});
test('revoked invitation is invalid because token was deleted', async () => {
  db.chatRoomInvite.findUnique.mockResolvedValue(null);
  await request(app()).post('/invites/deleted/accept').expect(404);
});
test('failure during transaction never reports membership as successful', async () => {
  db.participant.create.mockRejectedValue(new Error('db failed'));
  await request(app()).post('/invites/test-code/accept').expect(409);
});
