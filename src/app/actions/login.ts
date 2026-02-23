"use server";

import { cookies } from "next/headers";
import { AUTH_COOKIE_NAME } from "@/lib/auth";
import { hashPassword } from "@/lib/auth-server";

export type LoginResult = { ok: true } | { ok: false; error: string };

export async function login(formData: FormData): Promise<LoginResult> {
  const password = formData.get("password");
  const raw = typeof password === "string" ? password.trim() : "";
  const expected = (process.env.DASHBOARD_PASSWORD ?? "").trim();
  if (!expected) {
    return { ok: false, error: "Login is not configured." };
  }
  const token = hashPassword(raw);
  const expectedToken = hashPassword(expected);
  if (token !== expectedToken) {
    return { ok: false, error: "Invalid password." };
  }
  const cookieStore = await cookies();
  cookieStore.set(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });
  // Return success and let client redirect so cookie is applied before navigation (fixes preview/iframe)
  return { ok: true };
}
