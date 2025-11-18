/**
 * @jest-environment node
 */
import { jest } from '@jest/globals';

let execaMock;
let probeDurationSec;

beforeAll(async () => {
  // Mock execa BEFORE importing mediaProbe
  await jest.unstable_mockModule('execa', () => {
    execaMock = jest.fn();
    return {
      __esModule: true,
      execa: execaMock,
    };
  });

  // Mock ffprobe-static so ffprobe.path is predictable
  await jest.unstable_mockModule('ffprobe-static', () => ({
    __esModule: true,
    default: { path: '/usr/bin/ffprobe' },
  }));

  // Now import the function under test
  ({ probeDurationSec } = await import('../mediaProbe.js'));
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('probeDurationSec', () => {
  test('calls ffprobe via execa and returns rounded duration seconds', async () => {
    execaMock.mockResolvedValue({ stdout: '12.6' });

    const result = await probeDurationSec('/tmp/video.mp4');

    expect(execaMock).toHaveBeenCalledTimes(1);
    expect(execaMock).toHaveBeenCalledWith('/usr/bin/ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=nw=1:nk=1',
      '/tmp/video.mp4',
    ]);

    // 12.6 → rounded → 13
    expect(result).toBe(13);
  });

  test('returns null if stdout is not a finite number', async () => {
    execaMock.mockResolvedValue({ stdout: 'not-a-number' });

    const result = await probeDurationSec('/tmp/bad.mp4');

    expect(result).toBeNull();
  });

  test('returns null when execa throws', async () => {
    execaMock.mockRejectedValue(new Error('ffprobe failed'));

    const result = await probeDurationSec('/tmp/error.mp4');

    expect(result).toBeNull();
  });

  test('treats empty stdout as 0 seconds', async () => {
    execaMock.mockResolvedValue({ stdout: '' });

    const result = await probeDurationSec('/tmp/empty.mp4');

    // stdout '' → "0" → 0
    expect(result).toBe(0);
  });
});
