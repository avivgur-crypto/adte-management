"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import {
  getSystemHealth,
  type HealthDot,
  type SystemHealthPayload,
} from "@/app/actions/system-health";

const DOT_CLASS: Record<HealthDot, string> = {
  green: "bg-emerald-400",
  amber: "bg-amber-400",
  red: "bg-red-400",
  unknown: "bg-zinc-500",
};

function Dot({ tone }: { tone: HealthDot }) {
  return (
    <span
      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${DOT_CLASS[tone]}`}
      aria-hidden
    />
  );
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="w-full max-w-5xl rounded-2xl border border-white/[0.08] bg-[var(--adte-funnel-bg)] p-5 sm:p-6">
      <h2 className="mb-4 text-lg font-extrabold tracking-tight text-white sm:text-xl">
        {title}
      </h2>
      {children}
    </div>
  );
}

function EmptyQuiet({ text }: { text: string }) {
  return <p className="text-sm text-white/50">{text}</p>;
}

export default function SystemHealthTab() {
  const [data, setData] = useState<SystemHealthPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const load = useCallback(() => {
    startTransition(async () => {
      try {
        setError(null);
        const next = await getSystemHealth();
        setData(next);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-white">System Health</h1>
          <p className="mt-1 text-sm text-white/50">
            Sync freshness, failures, and data-integrity guards.
            {data?.fetchedAt ? (
              <>
                {" "}
                Updated{" "}
                <span className="tabular-nums text-white/70">
                  {new Date(data.fetchedAt).toLocaleTimeString("en-GB", {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </span>
              </>
            ) : null}
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={pending}
          className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-white/90 transition hover:bg-white/10 disabled:opacity-50"
        >
          {pending ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-950/30 p-4 text-sm text-red-200">
          {error}
        </div>
      )}

      {!data && !error && (
        <div className="h-40 animate-pulse rounded-2xl border border-white/[0.08] bg-[var(--adte-funnel-bg)]" />
      )}

      {data && (
        <>
          <Card title="Sync freshness">
            <ul className="divide-y divide-white/[0.06]">
              {data.freshness.map((row) => (
                <li
                  key={row.source}
                  className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Dot tone={row.dot} />
                    <span className="truncate font-mono text-sm text-white/85">
                      {row.source}
                    </span>
                  </div>
                  <span className="shrink-0 tabular-nums text-sm text-white/55">
                    {row.ageLabel}
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Failures (24h / 7d)">
            {data.failures.length === 0 ? (
              <EmptyQuiet text="no failures" />
            ) : (
              <ul className="space-y-3">
                {data.failures.map((row) => (
                  <li key={row.source} className="rounded-xl border border-white/[0.06] bg-black/20 p-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-mono text-sm text-white/85">
                        {row.source}
                      </span>
                      <span className="tabular-nums text-xs text-white/50">
                        {row.failures24h} / 24h · {row.failures7d} / 7d
                      </span>
                    </div>
                    {row.latestError && (
                      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-red-200/80">
                        {row.latestError}
                      </pre>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Guard activity (7d)">
            {data.guards.quiet ? (
              <EmptyQuiet text="guards quiet — system healthy" />
            ) : (
              <ul className="space-y-2.5">
                {data.guards.rows.map((row) => (
                  <li
                    key={row.event}
                    className="flex items-start justify-between gap-3"
                  >
                    <span className="text-sm text-white/75">{row.explanation}</span>
                    <span className="shrink-0 tabular-nums text-sm font-medium text-white/90">
                      ×{row.count}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Today's data age">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <Dot tone={data.today.dot} />
                <div>
                  <p className="text-sm text-white/85">
                    daily_home_totals · {data.today.ageLabel}
                  </p>
                  <p className="mt-0.5 text-xs text-white/45">
                    pulse: {data.today.pulseState}
                    {data.today.note ? ` — ${data.today.note}` : ""}
                  </p>
                </div>
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
