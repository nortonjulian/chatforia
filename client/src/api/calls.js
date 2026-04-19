import axiosClient from './axiosClient';

export async function getCallHistory() {
  const { data } = await axiosClient.get('/calls/history');
  return data?.items || [];
}