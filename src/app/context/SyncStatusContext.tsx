"use client";

import { createContext, useCallback, useContext, useState } from "react";

type SyncStatusContextValue = {
  isSyncing: boolean;
  setSyncing: (value: boolean) => void;
  lastSyncedAt: string | null;
  setLastSyncedAt: (value: string | null) => void;
  /** Monotonically increasing counter — bumped after every successful DB write. */
  syncVersion: number;
  bumpSyncVersion: () => void;
};

const SyncStatusContext = createContext<SyncStatusContextValue | null>(null);

export function SyncStatusProvider({ children }: { children: React.ReactNode }) {
  const [isSyncing, setSyncingRaw] = useState(false);
  const [lastSyncedAt, setLastSyncedAtRaw] = useState<string | null>(null);
  const [syncVersion, setSyncVersion] = useState(0);

  const setSyncing = useCallback((v: boolean) => setSyncingRaw(v), []);
  const setLastSyncedAt = useCallback((v: string | null) => setLastSyncedAtRaw(v), []);
  const bumpSyncVersion = useCallback(() => setSyncVersion((n) => n + 1), []);

  return (
    <SyncStatusContext.Provider
      value={{ isSyncing, setSyncing, lastSyncedAt, setLastSyncedAt, syncVersion, bumpSyncVersion }}
    >
      {children}
    </SyncStatusContext.Provider>
  );
}

export function useSyncStatus() {
  return useContext(SyncStatusContext);
}
