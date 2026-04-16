import { Suspense } from "react";
import { getLastDataUpdate } from "@/app/actions/financials";
import AutoSync from "@/app/components/AutoSync";
import FinancialTab from "@/app/components/FinancialTab";
import LastSyncLine from "@/app/components/LastSyncLine";

/**
 * Dedicated Financials view (same content as the Financial tab on `/`).
 * Uses force-dynamic so today’s pulse matches DB + AutoSync.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function LastSyncContent() {
  const lastDataUpdate = await getLastDataUpdate();
  return <LastSyncLine syncedAt={lastDataUpdate?.syncedAt ?? null} />;
}

export default function FinancialsPage() {
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
        <FinancialTab />
      </main>
    </div>
  );
}
