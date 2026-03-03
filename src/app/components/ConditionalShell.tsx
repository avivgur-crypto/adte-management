"use client";

import { usePathname } from "next/navigation";
import { FilterProvider } from "@/app/context/FilterContext";
import { AuthProvider } from "@/app/context/AuthContext";
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
        <DashboardShell>{children}</DashboardShell>
      </FilterProvider>
    </AuthProvider>
  );
}
