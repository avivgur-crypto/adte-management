import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { hashPassword } from "@/lib/auth-server";
import { AUTH_COOKIE_NAME } from "@/lib/auth";
import LoginForm from "./LoginForm";

export default async function LoginPage() {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) {
    redirect("/");
  }
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  const expected = hashPassword(password);
  if (token === expected) {
    redirect("/");
  }
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-100 px-4 dark:bg-zinc-950">
      <div className="w-full max-w-sm">
        <div className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <h1 className="mb-1 text-xl font-semibold text-zinc-900 dark:text-zinc-100">
            Dashboard
          </h1>
          <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
            Enter the password to continue.
          </p>
          <LoginForm />
        </div>
      </div>
    </div>
  );
}
