import {
  SkeletonCard,
  SkeletonPacingGrid,
  SkeletonPulse,
} from "@/app/components/SkeletonCard";

export default function Loading() {
  return (
    <div
      className="bg-adte-page"
      style={{
        minHeight: "100vh",
        /* Inline so first paint isn’t white while Tailwind/CSS chunk loads (PWA cold open). */
        background:
          "radial-gradient(ellipse 120% 80% at 50% 0%, #1a1a1a 0%, #0a0a0a 50%, #000000 100%)",
      }}
    >
      <main className="mx-auto max-w-5xl px-4 py-10">
        <SkeletonPulse className="mb-6 h-4 w-52" />
        <div className="stagger-children flex flex-col gap-8">
          <SkeletonCard lines={3} />
          <SkeletonPacingGrid />
          <SkeletonCard lines={2} />
          <SkeletonCard lines={4} />
        </div>
      </main>
    </div>
  );
}
