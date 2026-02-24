"use client";

import { Children, isValidElement } from "react";
import { useFilter } from "@/app/context/FilterContext";

const TAB_KEYS = ["financial", "partners", "sales-funnel"] as const;

export default function DashboardTabs({ children }: { children: React.ReactNode }) {
  const { activeScreen } = useFilter();
  const items = Children.toArray(children);

  return (
    <>
      {items.map((child, i) => {
        const key = TAB_KEYS[i];
        const isVisible = key !== undefined && activeScreen === key;
        if (isValidElement(child) && key !== undefined) {
          return (
            <div key={key} className={isVisible ? undefined : "hidden"} data-tab={key}>
              {child}
            </div>
          );
        }
        return null;
      })}
    </>
  );
}
