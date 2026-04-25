import axiosClient from './axiosClient';

export function getSupportSummary() {
  return axiosClient.get('/admin/support/summary').then((res) => res.data);
}

export function getSupportTickets(status) {
  return axiosClient
    .get('/admin/support/tickets', {
      params: status ? { status } : {},
    })
    .then((res) => res.data);
}

export function updateSupportTicket(id, status) {
  return axiosClient
    .patch(`/admin/support/tickets/${id}`, { status })
    .then((res) => res.data);
}