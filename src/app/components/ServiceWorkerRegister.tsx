"use client";

import { useEffect } from "react";

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* registration failed — non-critical */
    });

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      /* New SW took over (skipWaiting + clientsClaim). No hard reload needed
         because the cached HTML is functionally identical — ISR handles freshness. */
    });
  }, []);

  return null;
}
