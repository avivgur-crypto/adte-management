"use client";

import { createContext, useCallback, useContext, useState } from "react";

type SyncStatusContextValue = {
  isSyncing: boolean;
  setSyncing: (value: boolean) => void;
  lastSyncedAt: string | null;
  setLastSyncedAt: (value: string | null) => void;
};

const SyncStatusContext = createContext<SyncStatusContextValue | null>(null);

export function SyncStatusProvider({ children }: { children: React.ReactNode }) {
  const [isSyncing, setSyncingRaw] = useState(false);
  const [lastSyncedAt, setLastSyncedAtRaw] = useState<string | null>(null);

  const setSyncing = useCallback((v: boolean) => setSyncingRaw(v), []);
  const setLastSyncedAt = useCallback((v: string | null) => setLastSyncedAtRaw(v), []);

  return (
    <SyncStatusContext.Provider value={{ isSyncing, setSyncing, lastSyncedAt, setLastSyncedAt }}>
      {children}
    </SyncStatusContext.Provider>
  );
}

export function useSyncStatus() {
  return useContext(SyncStatusContext);
}
