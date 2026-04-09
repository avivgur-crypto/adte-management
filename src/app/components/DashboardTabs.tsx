"use client";

import { Children, isValidElement } from "react";
import { useFilter } from "@/app/context/FilterContext";

const TAB_KEYS = ["financial", "partners", "sales-funnel"] as const;

/**
 * Mount only the active tab so inactive screens do not run server fetches,
 * stream RSC payloads, or hydrate heavy trees (major main-thread win on load).
 */
export default function DashboardTabs({ children }: { children: React.ReactNode }) {
  const { activeScreen } = useFilter();
  const items = Children.toArray(children);
  const idx = TAB_KEYS.indexOf(activeScreen as (typeof TAB_KEYS)[number]);
  if (idx < 0 || idx >= items.length) return null;

  const child = items[idx];
  const key = TAB_KEYS[idx];
  if (!isValidElement(child) || key === undefined) return null;

  return (
    <div key={key} data-tab={key}>
      {child}
    </div>
  );
}
