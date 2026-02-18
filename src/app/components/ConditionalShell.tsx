"use client";

import { usePathname } from "next/navigation";
import { FilterProvider } from "@/app/context/FilterContext";
import DashboardShell from "./DashboardShell";

export default function ConditionalShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  if (pathname === "/login") {
    return <>{children}</>;
  }
  return (
    <FilterProvider>
      <DashboardShell>{children}</DashboardShell>
    </FilterProvider>
  );
}
