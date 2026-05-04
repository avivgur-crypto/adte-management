import AutoSync from "@/app/components/AutoSync";
import PnlTabClient from "@/app/components/PnlTabClient";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default function PnlPage() {
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
        <PnlTabClient />
      </main>
    </div>
  );
}
