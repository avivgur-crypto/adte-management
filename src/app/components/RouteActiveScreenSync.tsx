"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useFilter } from "@/app/context/FilterContext";

/**
 * Keeps sidebar `activeScreen` aligned with dedicated routes (`/pnl`, `/financials`).
 * Leaving those routes for `/` restores the Financial screen highlight.
 */
export default function RouteActiveScreenSync() {
  const pathname = usePathname();
  const { setActiveScreen } = useFilter();
  const prevPath = useRef(pathname);

  useEffect(() => {
    if (pathname === "/pnl") setActiveScreen("pnl");
    else if (pathname === "/financials") setActiveScreen("financial");
    else if (
      pathname === "/" &&
      (prevPath.current === "/pnl" || prevPath.current === "/financials")
    ) {
      setActiveScreen("financial");
    }
    prevPath.current = pathname;
  }, [pathname, setActiveScreen]);

  return null;
}
