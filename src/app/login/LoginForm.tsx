"use client";

type LoginFormProps = {
  /** Redirect path after login (e.g. from ?from=) */
  from?: string | null;
  /** Error to show (e.g. from ?error=invalid) */
  error?: string | null;
};

export default function LoginForm({ from, error }: LoginFormProps) {
  const action = from ? `/api/login?from=${encodeURIComponent(from)}` : "/api/login";

  return (
    <form action={action} method="post" className="flex flex-col gap-4">
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
          className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-white placeholder-white/40 transition-colors focus:border-[var(--adte-mid)] focus:outline-none focus:ring-1 focus:ring-[var(--adte-mid)]"
          placeholder="Enter password"
        />
      </div>
      {error && (
        <p className="text-sm text-red-400">
          {error === "invalid" ? "Invalid password." : error === "config" ? "Login is not configured." : "Something went wrong."}
        </p>
      )}
      <button
        type="submit"
        className="focus-ring-brand bg-gradient-brand rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition-all disabled:opacity-50"
      >
        Sign in
      </button>
    </form>
  );
}
