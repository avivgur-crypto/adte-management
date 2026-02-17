"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("App error:", error);
  }, [error]);

  const isEnvError =
    error.message?.includes("SUPABASE") ||
    error.message?.includes("env") ||
    error.message?.includes(".env");

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-zinc-100 px-4 dark:bg-zinc-950">
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
        Something went wrong
      </h1>
      <p className="max-w-md text-center text-sm text-zinc-600 dark:text-zinc-400">
        {isEnvError ? (
          <>
            Configuration error: {error.message}. Make sure{" "}
            <code className="rounded bg-zinc-200 px-1 dark:bg-zinc-800">
              .env.local
            </code>{" "}
            exists with <code>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
            <code>SUPABASE_SERVICE_ROLE_KEY</code>.
          </>
        ) : (
          error.message || "An unexpected error occurred."
        )}
      </p>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          Try again
        </button>
        <Link
          href="/"
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Go home
        </Link>
      </div>
    </div>
  );
}
