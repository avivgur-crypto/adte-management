"use client";

import { useEffect, useActionState } from "react";
import { login, type LoginState } from "@/app/actions/auth";

interface LoginFormProps {
  from?: string | null;
}

export default function LoginForm({ from }: LoginFormProps) {
  const [state, formAction, isPending] = useActionState<LoginState, FormData>(
    login,
    {},
  );

  // Client-side redirect so "Signing in..." ends as soon as auth succeeds.
  useEffect(() => {
    if (state.redirectTo) {
      window.location.href = state.redirectTo;
    }
  }, [state.redirectTo]);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {from && <input type="hidden" name="from" value={from} />}
      <div>
        <label
          htmlFor="email"
          className="mb-1.5 block text-sm font-medium text-[var(--adte-text-muted)]"
        >
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          autoFocus
          required
          className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-white placeholder-white/40 transition-colors focus:border-[var(--adte-mid)] focus:outline-none focus:ring-1 focus:ring-[var(--adte-mid)]"
          placeholder="you@example.com"
        />
      </div>
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
          required
          className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-white placeholder-white/40 transition-colors focus:border-[var(--adte-mid)] focus:outline-none focus:ring-1 focus:ring-[var(--adte-mid)]"
          placeholder="Enter password"
        />
      </div>
      <label className="flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          name="rememberMe"
          defaultChecked
          className="h-4 w-4 rounded border-white/20 bg-white/5 text-emerald-500 focus:ring-emerald-500/50"
        />
        <span className="text-sm text-[var(--adte-text-muted)]">
          Remember me
        </span>
      </label>
      {state.error && (
        <p className="text-sm text-red-400">{state.error}</p>
      )}
      <button
        type="submit"
        disabled={isPending}
        className="focus-ring-brand bg-gradient-brand rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition-all disabled:opacity-50"
      >
        {isPending ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
