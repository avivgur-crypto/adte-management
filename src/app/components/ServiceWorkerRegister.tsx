"use client";

import { useEffect } from "react";

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    // Registration fetches + installs sw.js — never needed for first paint.
    // Defer to the idle window so it doesn't compete with page resources on
    // slow connections.
    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* registration failed — non-critical */
      });

      navigator.serviceWorker.addEventListener("controllerchange", () => {
        /* New SW took over (skipWaiting + clientsClaim). No hard reload needed
           because the cached HTML is functionally identical — ISR handles freshness. */
      });
    };

    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(register, { timeout: 5000 });
      return () => window.cancelIdleCallback(id);
    }
    const t = setTimeout(register, 3000);
    return () => clearTimeout(t);
  }, []);

  return null;
}
