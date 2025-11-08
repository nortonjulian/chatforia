const ORIGINAL_ENV = process.env;

let fetchMock;

const reload = async (env = {}) => {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV, ...env };

  fetchMock = jest.fn();
  jest.doMock('node-fetch', () => ({
    __esModule: true,
    default: fetchMock,
  }));

  return import('../tealEsim.js');
};

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('tealEsim provider', () => {
  const BASE = 'https://api.teal.example';
  const KEY = 'teal-api-key-123';

  test('reserveEsimProfile: posts to /esims/profiles with auth + JSON body and returns JSON', async () => {
    const { reserveEsimProfile } = await reload({
      TEAL_BASE_URL: BASE,
      TEAL_API_KEY: KEY,
    });

    const fakeResp = { activationCode: 'AC-XYZ', smdp: 'smdp.example' };
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => fakeResp,
    });

    const userId = 42;
    const region = 'us';
    const out = await reserveEsimProfile({ userId, region });

    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/esims/profiles`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userId, region }),
    });
    expect(out).toEqual(fakeResp);
  });

  test('reserveEsimProfile: throws on non-ok status', async () => {
    const { reserveEsimProfile } = await reload({
      TEAL_BASE_URL: BASE,
      TEAL_API_KEY: KEY,
    });

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: 'unauthorized' }),
    });

    await expect(
      reserveEsimProfile({ userId: 1, region: 'eu' })
    ).rejects.toThrow('Teal reserve failed: 401');
  });

  test('suspendLine: posts to /lines/:iccid/suspend with auth headers and returns JSON', async () => {
    const { suspendLine } = await reload({
      TEAL_BASE_URL: BASE,
      TEAL_API_KEY: KEY,
    });

    const iccid = '8904903200000000000';
    const resp = { ok: true, status: 'suspended' };

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => resp,
    });

    const out = await suspendLine({ iccid });

    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/lines/${iccid}/suspend`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${KEY}`,
        'Content-Type': 'application/json',
      },
    });
    expect(out).toEqual(resp);
  });

  test('suspendLine: throws on non-ok status', async () => {
    const { suspendLine } = await reload({
      TEAL_BASE_URL: BASE,
      TEAL_API_KEY: KEY,
    });

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    await expect(suspendLine({ iccid: 'x' })).rejects.toThrow(
      'Teal suspend failed: 500'
    );
  });

  test('resumeLine: posts to /lines/:iccid/resume with auth headers and returns JSON', async () => {
    const { resumeLine } = await reload({
      TEAL_BASE_URL: BASE,
      TEAL_API_KEY: KEY,
    });

    const iccid = '8904903200000000001';
    const resp = { ok: true, status: 'active' };

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => resp,
    });

    const out = await resumeLine({ iccid });

    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/lines/${iccid}/resume`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${KEY}`,
        'Content-Type': 'application/json',
      },
    });
    expect(out).toEqual(resp);
  });

  test('resumeLine: throws on non-ok status', async () => {
    const { resumeLine } = await reload({
      TEAL_BASE_URL: BASE,
      TEAL_API_KEY: KEY,
    });

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({}),
    });

    await expect(resumeLine({ iccid: 'missing' })).rejects.toThrow(
      'Teal resume failed: 404'
    );
  });
});
