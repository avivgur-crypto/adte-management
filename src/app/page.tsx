import { Suspense } from "react";
import { getLastDataUpdate } from "@/app/actions/financials";
import FinancialTab from "@/app/components/FinancialTab";
import DashboardTabs from "@/app/components/DashboardTabs";
import AutoSync from "@/app/components/AutoSync";
import LastSyncLine from "@/app/components/LastSyncLine";
import WebPushSubscribe from "@/app/components/WebPushSubscribe";
import { SkeletonCard, SkeletonPacingGrid } from "@/app/components/SkeletonCard";

/**
 * revalidate = 0: every navigation re-renders on the server so the initial
 * render always shows the latest DB values.  Per-query `unstable_cache`
 * (tagged "financial-data") deduplicates within a burst of concurrent
 * requests; `refreshTodayHome` / cron sync invalidate the tag after writes.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

function FinancialSkeleton() {
  return (
    <div className="stagger-children flex flex-col gap-8">
      <SkeletonCard lines={3} />
      <SkeletonPacingGrid />
      <SkeletonCard lines={2} />
      <SkeletonCard lines={4} />
    </div>
  );
}

async function LastSyncContent() {
  const lastDataUpdate = await getLastDataUpdate();
  return <LastSyncLine syncedAt={lastDataUpdate?.syncedAt ?? null} />;
}

export default function Home() {
  return (
    <div
      className="bg-adte-page"
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(ellipse 120% 80% at 50% 0%, #1a1a1a 0%, #0a0a0a 50%, #000000 100%)",
      }}
    >
      <AutoSync />
      <main className="mx-auto max-w-5xl px-3 pb-8 pt-6 sm:px-4 sm:pb-10 sm:pt-10">
        <Suspense
          fallback={
            <div
              className="h-5 w-48 animate-pulse rounded bg-white/10"
              style={{
                height: 20,
                width: 192,
                borderRadius: 8,
                backgroundColor: "rgba(255,255,255,0.1)",
              }}
            />
          }
        >
          <LastSyncContent />
        </Suspense>
        <WebPushSubscribe />
        <DashboardTabs>
          <Suspense fallback={<FinancialSkeleton />}>
            <FinancialTab />
          </Suspense>
        </DashboardTabs>
      </main>
    </div>
  );
}
