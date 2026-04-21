import axiosClient from '@/api/axiosClient';

export async function getCsrf() {
  const { data } = await axiosClient.get('/auth/csrf');
  return data?.csrfToken || data?.token || undefined;
}

export async function reserveEsim(region = 'US') {
  const { data } = await axiosClient.post('/esim/profiles', { region });
  return data;
  // {
  //   providerProfileId,
  //   iccid,
  //   iccidHint,
  //   smdp,
  //   activationCode,
  //   lpaUri,
  //   qrPayload,
  //   region
  // }
}

export async function getMyEsim() {
  const { data } = await axiosClient.get('/esim/me');
  return data;
  // { subscriber: {...} | null }
}

export async function activateEsim({ iccid, activationCode, providerProfileId }) {
  const { data } = await axiosClient.post('/esim/activate', {
    iccid,
    code: activationCode,
    providerProfileId,
  });
  return data;
}

export async function suspendEsim({ iccid, providerProfileId }) {
  const { data } = await axiosClient.post('/esim/suspend', {
    iccid,
    providerProfileId,
  });
  return data;
}

export async function resumeEsim({ iccid, providerProfileId }) {
  const { data } = await axiosClient.post('/esim/resume', {
    iccid,
    providerProfileId,
  });
  return data;
}