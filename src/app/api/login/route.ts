import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, hashPasswordEdge } from "@/lib/auth";

/** POST: classic form login — sets cookie and redirects. Works in preview/iframe. */
export async function POST(request: NextRequest) {
  const expected = (process.env.DASHBOARD_PASSWORD ?? "").trim();
  if (!expected) {
    return NextResponse.redirect(new URL("/login?error=config", request.url));
  }

  const formData = await request.formData();
  const raw = (formData.get("password") as string | null)?.trim() ?? "";
  const token = await hashPasswordEdge(raw);
  const expectedToken = await hashPasswordEdge(expected);

  const fromParam = (request.nextUrl.searchParams.get("from") ?? "").trim();

  if (token !== expectedToken) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("error", "invalid");
    if (fromParam) loginUrl.searchParams.set("from", fromParam);
    return NextResponse.redirect(loginUrl);
  }

  const from = fromParam;
  const redirectTo = from.startsWith("/") ? from : "/";
  const url = new URL(redirectTo, request.url);
  const res = NextResponse.redirect(url, 302);

  res.cookies.set(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });

  return res;
}
