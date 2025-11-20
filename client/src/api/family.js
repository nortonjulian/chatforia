import axiosClient from './axiosClient';

// Get current user's family + members + usage
export async function getMyFamily() {
  const { data } = await axiosClient.get('/family/me');
  return data.family || null;
}

// Create an invite (owner only)
export async function createFamilyInvite({ email, phone } = {}) {
  const { data } = await axiosClient.post('/family/invite', { email, phone });
  return data.invite;
}

// Join family with invite token
export async function joinFamily(token) {
  const { data } = await axiosClient.post('/family/join', { token });
  return data;
}
