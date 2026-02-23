"use client";

import { useActionState } from "react";
import { login, type LoginResult } from "@/app/actions/login";

export default function LoginForm() {
  const [state, formAction, isPending] = useActionState(
    async (_: LoginResult | null, formData: FormData) => {
      return await login(formData);
    },
    null as LoginResult | null
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div>
        <label
          htmlFor="password"
          className="mb-1.5 block text-sm font-medium text-[var(--adte-text-muted)]"
        >
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          disabled={isPending}
          className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-white placeholder-white/40 transition-colors focus:border-[var(--adte-mid)] focus:outline-none focus:ring-1 focus:ring-[var(--adte-mid)] disabled:opacity-50"
          placeholder="Enter password"
        />
      </div>
      {state && !state.ok && (
        <p className="text-sm text-red-400">{state.error}</p>
      )}
      <button
        type="submit"
        disabled={isPending}
        className="focus-ring-brand bg-gradient-brand rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition-all disabled:opacity-50"
      >
        {isPending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
