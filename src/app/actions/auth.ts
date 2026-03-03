"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LoginState = { error?: string };

export type SessionUser = {
  id: string;
  email: string;
  role: string;
  isAdmin: boolean;
} | null;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const loginSchema = z.object({
  email: z.string().email("Invalid email address.").max(254),
  password: z.string().min(1, "Password is required.").max(256),
});

// ---------------------------------------------------------------------------
// Server Actions
// ---------------------------------------------------------------------------

/**
 * Sign in with email + password via Supabase Auth.
 * Signature matches useActionState (prevState, formData) → newState.
 */
export async function login(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const rememberMe = formData.get("rememberMe") === "on" || formData.get("rememberMe") === "true";
  const supabase = await createClient({ rememberMe });
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    return { error: "Invalid email or password." };
  }

  const from = formData.get("from") as string | null;
  const safe = from && from.startsWith("/") && !from.startsWith("//") ? from : "/";
  redirect(safe);
}

/** Sign out and redirect to login page. */
export async function logout(): Promise<never> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

/**
 * Fetch the current user's profile (id, email, role) from the Supabase session.
 * Uses the admin client to read the profiles table (bypasses RLS).
 */
export async function getSessionUser(): Promise<SessionUser> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  const role = (profile?.role as string) ?? "viewer";
  return {
    id: user.id,
    email: user.email ?? "",
    role,
    isAdmin: role === "admin",
  };
}
