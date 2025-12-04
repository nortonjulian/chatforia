import { jest } from '@jest/globals';

// Make sure env var exists so setApiKey is called cleanly
process.env.SENDGRID_API_KEY = 'test-sendgrid-key';

// ---- Mock SendGrid + Prisma BEFORE importing the module under test ----
jest.unstable_mockModule('@sendgrid/mail', () => ({
  __esModule: true,
  default: {
    setApiKey: jest.fn(),
    send: jest.fn(),
  },
}));

jest.unstable_mockModule('../utils/prismaClient.js', () => ({
  __esModule: true,
  default: {
    user: {
      findUnique: jest.fn(),
    },
  },
}));

// After mocks, import the mocked modules and the function under test
const sgMailModule = await import('@sendgrid/mail');
const prismaModule = await import('../utils/prismaClient.js');
const { notifyUserOfPendingRelease } = await import('./notifications.js');

const sgMail = sgMailModule.default;
const prisma = prismaModule.default;

describe('notifyUserOfPendingRelease', () => {
  const userId = 'user-123';
  const number = '+15551234567';
  const releaseDate = new Date('2100-01-01T00:00:00.000Z');
  const releaseDateStr = releaseDate.toDateString();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sets the SendGrid API key at module load', () => {
    // notifications.js calls setApiKey at top-level when imported
    expect(sgMail.setApiKey).toHaveBeenCalledTimes(1);
    expect(sgMail.setApiKey).toHaveBeenCalledWith('test-sendgrid-key');
  });

  it('logs a warning and returns when user is not found', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(null);

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    await notifyUserOfPendingRelease(userId, { number, releaseDate });

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: userId },
    });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toBe(
      `[Notify] No email found for user ${userId}`
    );

    expect(sgMail.send).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('logs a warning and returns when user has no email', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({
      id: userId,
      email: null,
      firstName: 'NoEmail',
      username: 'noemailuser',
    });

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    await notifyUserOfPendingRelease(userId, { number, releaseDate });

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: userId },
    });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toBe(
      `[Notify] No email found for user ${userId}`
    );

    expect(sgMail.send).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('sends email using firstName when present', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({
      id: userId,
      email: 'user@example.com',
      firstName: 'Julian',
      username: 'julian-username',
    });

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    await notifyUserOfPendingRelease(userId, { number, releaseDate });

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: userId },
    });

    expect(sgMail.send).toHaveBeenCalledTimes(1);
    const [msg] = sgMail.send.mock.calls[0];

    expect(msg).toMatchObject({
      to: 'user@example.com',
      from: 'no-reply@chatforia.com',
      subject: 'Your Chatforia number will be released soon',
    });

    // Greeting with firstName
    expect(msg.text).toContain(`Hi Julian,`);
    expect(msg.text).toContain(`number ${number}`);
    expect(msg.text).toContain(`will be released on ${releaseDateStr}`);

    expect(msg.html).toContain(`Hi Julian`);
    expect(msg.html).toContain(`<strong>${number}</strong>`);
    expect(msg.html).toContain(`<strong>${releaseDateStr}</strong>`);

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toBe(
      `[Notify] Email sent: userId=${userId}, email=user@example.com, number=${number}`
    );

    logSpy.mockRestore();
  });

  it('falls back to username when firstName is missing', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({
      id: userId,
      email: 'user2@example.com',
      firstName: null,
      username: 'ChatforiaUser',
    });

    await notifyUserOfPendingRelease(userId, { number, releaseDate });

    expect(sgMail.send).toHaveBeenCalledTimes(1);
    const [msg] = sgMail.send.mock.calls[0];

    // Greeting with username
    expect(msg.text).toContain(`Hi ChatforiaUser,`);
    expect(msg.html).toContain(`Hi ChatforiaUser`);
  });

  it('uses "there" as greeting when neither firstName nor username are present', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({
      id: userId,
      email: 'user3@example.com',
      firstName: null,
      username: null,
    });

    await notifyUserOfPendingRelease(userId, { number, releaseDate });

    expect(sgMail.send).toHaveBeenCalledTimes(1);
    const [msg] = sgMail.send.mock.calls[0];

    expect(msg.text).toContain(`Hi there,`);
    expect(msg.html).toContain(`Hi there`);
  });
});
