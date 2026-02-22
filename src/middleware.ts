import { type NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, hashPasswordEdge } from "@/lib/auth";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === "/login") {
    const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;
    const expected = process.env.DASHBOARD_PASSWORD
      ? await hashPasswordEdge(process.env.DASHBOARD_PASSWORD)
      : "";
    if (token && expected && token === expected) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) {
    return NextResponse.next();
  }

  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  const expected = await hashPasswordEdge(password);
  if (token === expected) {
    return NextResponse.next();
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("from", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
