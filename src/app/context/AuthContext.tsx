"use client";

import {
  createContext,
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { getSessionUser, type SessionUser } from "@/app/actions/auth";

interface AuthState {
  user: SessionUser;
  loading: boolean;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  refresh: async () => {},
});

/**
 * Provides auth identity to the client tree.
 *
 * When `initialUser` is supplied (resolved server-side in layout.tsx), the
 * provider initialises immediately — no post-hydration fetch.  When omitted
 * (e.g. tests), it falls back to a client-side fetch after first paint.
 */
export function AuthProvider({
  children,
  initialUser,
}: {
  children: ReactNode;
  initialUser?: SessionUser;
}) {
  const serverResolved = initialUser !== undefined;
  const [user, setUser] = useState<SessionUser>(initialUser ?? null);
  const [loading, setLoading] = useState(!serverResolved);

  const refresh = useCallback(async () => {
    try {
      const session = await getSessionUser();
      startTransition(() => {
        setUser(session);
        setLoading(false);
      });
    } catch {
      startTransition(() => {
        setUser(null);
        setLoading(false);
      });
    }
  }, []);

  useEffect(() => {
    if (serverResolved) return;
    const id = requestAnimationFrame(() => {
      void refresh();
    });
    return () => cancelAnimationFrame(id);
  }, [refresh, serverResolved]);

  return (
    <AuthContext.Provider value={{ user, loading, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
