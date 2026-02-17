"use client";

import FilterSidebar, { filterSidebarWidth } from "./FilterSidebar";

export default function DashboardShell({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
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
