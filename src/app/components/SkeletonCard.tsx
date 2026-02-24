export function SkeletonPulse({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-white/[0.06] ${className ?? ""}`} />;
}

export function SkeletonCard({ lines = 4 }: { lines?: number }) {
  return (
    <div className="w-full max-w-5xl rounded-2xl border border-white/[0.08] bg-[var(--adte-funnel-bg)] p-6">
      <SkeletonPulse className="mb-4 h-7 w-48" />
      <div className="space-y-3">
        {Array.from({ length: lines }).map((_, i) => (
          <SkeletonPulse key={i} className={`h-4 ${i % 2 === 0 ? "w-full" : "w-3/4"}`} />
        ))}
      </div>
    </div>
  );
}

export function SkeletonPacingGrid() {
  return (
    <div className="w-full max-w-5xl rounded-2xl border border-white/[0.08] bg-[var(--adte-funnel-bg)] p-6">
      <SkeletonPulse className="mb-4 h-7 w-56" />
      <SkeletonPulse className="mb-5 h-4 w-40" />
      <div className="grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-xl border border-white/[0.08] bg-black/30 p-4">
            <SkeletonPulse className="mb-3 h-4 w-24" />
            <div className="space-y-2.5">
              <SkeletonPulse className="h-3 w-20" />
              <SkeletonPulse className="h-5 w-28" />
              <SkeletonPulse className="h-3 w-20" />
              <SkeletonPulse className="h-5 w-28" />
              <SkeletonPulse className="h-3 w-full rounded-full" />
              <SkeletonPulse className="h-14 w-full rounded-md" />
              <SkeletonPulse className="h-3 w-36" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SkeletonDonutGrid() {
  return (
    <div className="w-full max-w-5xl rounded-2xl border border-white/[0.08] bg-[var(--adte-funnel-bg)] p-6">
      <SkeletonPulse className="mb-5 h-7 w-48" />
      <div className="grid gap-8 lg:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className="rounded-xl border border-white/[0.08] bg-[var(--adte-funnel-bg)] p-5">
            <SkeletonPulse className="mb-3 h-4 w-28" />
            <SkeletonPulse className="mx-auto mb-4 h-52 w-52 rounded-full" />
            <div className="space-y-2">
              {[0, 1, 2, 3, 4].map((j) => (
                <SkeletonPulse key={j} className="h-9 w-full rounded-md" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
