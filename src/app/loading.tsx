import { SkeletonCard, SkeletonPacingGrid } from "@/app/components/SkeletonCard";

export default function Loading() {
  return (
    <div className="bg-adte-page">
      <main className="mx-auto max-w-5xl px-4 py-10">
        <div className="flex flex-col gap-8">
          <SkeletonCard lines={3} />
          <SkeletonPacingGrid />
        </div>
      </main>
    </div>
  );
}
