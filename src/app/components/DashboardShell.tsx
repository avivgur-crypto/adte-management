"use client";

import FilterSidebar, { filterSidebarWidth } from "./FilterSidebar";
import { AdteLogoHeader } from "./AdteLogo";

export default function DashboardShell({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <header className="sticky top-0 z-30 border-b border-white/5 bg-black/95 backdrop-blur-sm">
        <div className="mx-auto flex h-[150px] max-w-5xl items-center px-4 py-3 md:py-4">
          <AdteLogoHeader />
        </div>
      </header>
      <main
        className="min-h-screen flex-1 pr-0 transition-[padding] lg:pr-[var(--filter-sidebar-width)]"
        style={{ ["--filter-sidebar-width" as string]: `${filterSidebarWidth}px` }}
      >
        {children}
      </main>
      <FilterSidebar />
    </>
  );
}
