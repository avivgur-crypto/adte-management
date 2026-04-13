"use client";

import { usePathname } from "next/navigation";
import type { SessionUser } from "@/app/actions/auth";
import { FilterProvider } from "@/app/context/FilterContext";
import { AuthProvider } from "@/app/context/AuthContext";
import { SyncStatusProvider } from "@/app/context/SyncStatusContext";
import DashboardShell from "./DashboardShell";

export default function ConditionalShell({
  children,
  initialUser = null,
}: {
  children: React.ReactNode;
  initialUser?: SessionUser;
}) {
  const pathname = usePathname();
  if (pathname === "/login") {
    return <>{children}</>;
  }
  return (
    <AuthProvider initialUser={initialUser}>
      <FilterProvider>
        <SyncStatusProvider>
          <DashboardShell>{children}</DashboardShell>
        </SyncStatusProvider>
      </FilterProvider>
    </AuthProvider>
  );
}
