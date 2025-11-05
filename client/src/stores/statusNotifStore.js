import { create } from 'zustand';

export const useStatusNotifStore = create((set) => ({
  unseen: 0,
  lastEvent: null,
  inc: () => set((s) => ({ unseen: s.unseen + 1 })),
  reset: () => set({ unseen: 0 }),
  setLastEvent: (evt) => set({ lastEvent: evt }),
}));
