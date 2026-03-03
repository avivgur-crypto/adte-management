import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

const REMEMBER_ME_DAYS = 30;

export type CreateClientOptions = {
  /** When false, auth cookies are session-only (expire when browser closes). Default true. */
  rememberMe?: boolean;
};

export async function createClient(options?: CreateClientOptions) {
  const cookieStore = await cookies();
  const rememberMe = options?.rememberMe !== false;

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options: opts }) => {
              const options = rememberMe
                ? { ...opts, maxAge: opts?.maxAge ?? REMEMBER_ME_DAYS * 24 * 60 * 60 }
                : { ...opts, maxAge: undefined };
              cookieStore.set(name, value, options);
            });
          } catch {
            // Called from a Server Component (read-only context).
            // Middleware handles session refresh, so this is safe to ignore.
          }
        },
      },
    },
  );
}
