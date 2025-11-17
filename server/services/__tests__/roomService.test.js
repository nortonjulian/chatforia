import { jest } from '@jest/globals';

// --- 1. Build a shared prisma mock object ---
const mockPrisma = {
  chatRoom: {
    findUnique: jest.fn(),
  },
  participant: {
    findUnique: jest.fn(),
  },
};

// --- 2. Mock prismaClient BEFORE importing roomService ---
await jest.unstable_mockModule('../utils/prismaClient.js', () => ({
  __esModule: true,
  default: mockPrisma,
}));

// --- 3. Now import the module under test ---
const {
  getRoomWithOwner,
  getParticipantRole,
  requireOwner,
  requireOwnerOrAdmin,
} = await import('../roomService.js');

describe('roomService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getRoomWithOwner', () => {
    it('calls prisma.chatRoom.findUnique with numeric roomId and returns result', async () => {
      mockPrisma.chatRoom.findUnique.mockResolvedValue({
        id: 123,
        ownerId: 10,
      });

      const room = await getRoomWithOwner('123');

      expect(mockPrisma.chatRoom.findUnique).toHaveBeenCalledWith({
        where: { id: 123 },
        select: { id: true, ownerId: true },
      });
      expect(room).toEqual({ id: 123, ownerId: 10 });
    });
  });

  describe('getParticipantRole', () => {
    it('returns the role when participant exists', async () => {
      mockPrisma.participant.findUnique.mockResolvedValue({ role: 'ADMIN' });

      const role = await getParticipantRole('50', '7');

      expect(mockPrisma.participant.findUnique).toHaveBeenCalledWith({
        where: {
          chatRoomId_userId: { chatRoomId: 50, userId: 7 },
        },
        select: { role: true },
      });

      expect(role).toBe('ADMIN');
    });

    it('returns null when participant does not exist', async () => {
      mockPrisma.participant.findUnique.mockResolvedValue(null);

      const role = await getParticipantRole(10, 99);

      expect(role).toBeNull();
    });
  });

  describe('requireOwner', () => {
    it('returns 404 when room is not found', async () => {
      mockPrisma.chatRoom.findUnique.mockResolvedValue(null);

      const req = { user: { id: 1 } };
      const result = await requireOwner(req, 123);

      expect(result).toEqual({
        ok: false,
        code: 404,
        error: 'Room not found',
      });
    });

    it('returns 403 when user is not the owner', async () => {
      mockPrisma.chatRoom.findUnique.mockResolvedValue({
        id: 123,
        ownerId: 99,
      });

      const req = { user: { id: 1 } };
      const result = await requireOwner(req, 123);

      expect(result).toEqual({
        ok: false,
        code: 403,
        error: 'Owner required',
      });
    });

    it('returns ok=true with room when user is the owner', async () => {
      const roomObj = { id: 123, ownerId: 1 };
      mockPrisma.chatRoom.findUnique.mockResolvedValue(roomObj);

      const req = { user: { id: 1 } };
      const result = await requireOwner(req, '123');

      expect(result).toEqual({
        ok: true,
        room: roomObj,
      });
    });
  });

  describe('requireOwnerOrAdmin', () => {
    it('returns 404 when room is not found', async () => {
      mockPrisma.chatRoom.findUnique.mockResolvedValue(null);

      const req = { user: { id: 5 } };
      const result = await requireOwnerOrAdmin(req, 555);

      expect(result).toEqual({
        ok: false,
        code: 404,
        error: 'Room not found',
      });
    });

    it('returns ok=true with role OWNER when user is the owner', async () => {
      const roomObj = { id: 200, ownerId: 5 };
      mockPrisma.chatRoom.findUnique.mockResolvedValue(roomObj);

      const req = { user: { id: 5 } };
      const result = await requireOwnerOrAdmin(req, 200);

      // Should not need to query participant in this case
      expect(mockPrisma.participant.findUnique).not.toHaveBeenCalled();

      expect(result).toEqual({
        ok: true,
        room: roomObj,
        role: 'OWNER',
      });
    });

    it('returns ok=true with role ADMIN when user is admin but not owner', async () => {
      const roomObj = { id: 300, ownerId: 10 };
      mockPrisma.chatRoom.findUnique.mockResolvedValue(roomObj);
      mockPrisma.participant.findUnique.mockResolvedValue({ role: 'ADMIN' });

      const req = { user: { id: 7 } };
      const result = await requireOwnerOrAdmin(req, '300');

      expect(mockPrisma.participant.findUnique).toHaveBeenCalledWith({
        where: {
          chatRoomId_userId: { chatRoomId: 300, userId: 7 },
        },
        select: { role: true },
      });

      expect(result).toEqual({
        ok: true,
        room: roomObj,
        role: 'ADMIN',
      });
    });

    it('returns 403 when user is neither owner nor ADMIN', async () => {
      const roomObj = { id: 400, ownerId: 1 };
      mockPrisma.chatRoom.findUnique.mockResolvedValue(roomObj);
      mockPrisma.participant.findUnique.mockResolvedValue({ role: 'MEMBER' });

      const req = { user: { id: 2 } };
      const result = await requireOwnerOrAdmin(req, 400);

      expect(result).toEqual({
        ok: false,
        code: 403,
        error: 'Owner or ADMIN required',
      });
    });

    it('returns 403 when participant record is missing', async () => {
      const roomObj = { id: 500, ownerId: 1 };
      mockPrisma.chatRoom.findUnique.mockResolvedValue(roomObj);
      mockPrisma.participant.findUnique.mockResolvedValue(null);

      const req = { user: { id: 2 } };
      const result = await requireOwnerOrAdmin(req, 500);

      expect(result).toEqual({
        ok: false,
        code: 403,
        error: 'Owner or ADMIN required',
      });
    });
  });
});
