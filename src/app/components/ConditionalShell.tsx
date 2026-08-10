"use client";

import { usePathname } from "next/navigation";
import type { SessionUser } from "@/app/actions/auth";
import { FilterProvider } from "@/app/context/FilterContext";
import { AuthProvider } from "@/app/context/AuthContext";
import { SyncStatusProvider } from "@/app/context/SyncStatusContext";
import DashboardShell from "./DashboardShell";

export default function ConditionalShell({
  children,
  initialUser,
}: {
  children: React.ReactNode;
  /**
   * Optional server-resolved user. When omitted (the normal case since the
   * layout stopped awaiting auth), AuthProvider fetches the user client-side
   * after first paint — do NOT default this to null, that would tell the
   * provider "server says logged out" and skip the fetch.
   */
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
