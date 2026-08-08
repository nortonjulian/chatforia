import {
  claimCallActive,
} from '../callAnswerArbitration.js';

function createCallModel() {
  let row = {
    id: 91,
    status: 'RINGING',
    answerSdp: null,
    startedAt: null,
  };

  return {
    row: () => ({ ...row }),

    async updateMany({ where, data }) {
      const allowed =
        where.status.in.includes(
          row.status
        );

      if (
        row.id !== where.id ||
        !allowed
      ) {
        return {
          count: 0,
        };
      }

      row = {
        ...row,
        ...data,
      };

      return {
        count: 1,
      };
    },

    async findUnique({ where }) {
      if (where.id !== row.id) {
        return null;
      }

      return {
        ...row,
      };
    },
  };
}

describe('claimCallActive', () => {
  test(
    'the first device atomically claims a ringing call',
    async () => {
      const callModel =
        createCallModel();

      const result =
        await claimCallActive({
          callModel,
          callId: 91,
          data: {
            status: 'ACTIVE',
            answerSdp: 'first-answer',
            startedAt:
              new Date(
                '2026-08-08T04:00:00.000Z'
              ),
          },
          select: {
            id: true,
            status: true,
            answerSdp: true,
          },
        });

      expect(result.won).toBe(true);

      expect(result.call).toMatchObject({
        id: 91,
        status: 'ACTIVE',
        answerSdp: 'first-answer',
      });
    }
  );

  test(
    'a second device loses without overwriting the winner',
    async () => {
      const callModel =
        createCallModel();

      const first =
        await claimCallActive({
          callModel,
          callId: 91,
          data: {
            status: 'ACTIVE',
            answerSdp: 'first-answer',
          },
          select: {
            id: true,
            status: true,
            answerSdp: true,
          },
        });

      const second =
        await claimCallActive({
          callModel,
          callId: 91,
          data: {
            status: 'ACTIVE',
            answerSdp: 'second-answer',
          },
          select: {
            id: true,
            status: true,
            answerSdp: true,
          },
        });

      expect(first.won).toBe(true);
      expect(second.won).toBe(false);

      expect(second.call).toMatchObject({
        id: 91,
        status: 'ACTIVE',
        answerSdp: 'first-answer',
      });

      expect(
        callModel.row().answerSdp
      ).toBe('first-answer');
    }
  );
});
