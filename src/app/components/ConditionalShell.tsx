"use client";

import { usePathname } from "next/navigation";
import { FilterProvider } from "@/app/context/FilterContext";
import { AuthProvider } from "@/app/context/AuthContext";
import { SyncStatusProvider } from "@/app/context/SyncStatusContext";
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
    <AuthProvider>
      <FilterProvider>
        <SyncStatusProvider>
          <DashboardShell>{children}</DashboardShell>
        </SyncStatusProvider>
      </FilterProvider>
    </AuthProvider>
  );
}
