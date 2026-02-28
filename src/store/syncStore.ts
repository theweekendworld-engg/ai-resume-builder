import { create } from 'zustand';

export type SyncState = 'idle' | 'syncing' | 'synced' | 'error';

interface SyncStore {
  status: SyncState;
  lastSyncedAt: Date | null;
  setStatus: (status: SyncState) => void;
  setLastSyncedAt: (date: Date | null) => void;
}

export const useSyncStore = create<SyncStore>((set) => ({
  status: 'idle',
  lastSyncedAt: null,
  setStatus: (status) => set({ status }),
  setLastSyncedAt: (date) => set({ lastSyncedAt: date }),
}));
