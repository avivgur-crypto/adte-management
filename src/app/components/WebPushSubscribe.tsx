"use client";

import { useCallback, useState, useEffect } from "react";
import { savePushSubscription } from "@/app/actions/push-subscription";

/** VAPID public key: URL-safe Base64 → Uint8Array for PushManager.subscribe */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(new ArrayBuffer(rawData.length));
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export default function WebPushSubscribe() {
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");

  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      if (Notification.permission === "granted") {
        setStatus("success");
      }
    }
  }, []);

  // Debug subscribeUser function
  const subscribeUser = useCallback(async () => {
    setStatus("loading");
    try {
      console.log("[WebPushSubscribe] Starting subscribeUser...");

      if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
        console.error("[WebPushSubscribe] Service workers not supported.");
        throw new Error("Service workers are not supported in this browser.");
      }
      if (!("PushManager" in window)) {
        console.error("[WebPushSubscribe] PushManager not supported in window.");
        throw new Error("Push messaging is not supported in this browser.");
      }

      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
      if (!vapidKey) {
        console.error("[WebPushSubscribe] VAPID public key not configured.");
        // No error exposed to UI per spec
        throw new Error("VAPID public key is not configured.");
      }
      console.log("[WebPushSubscribe] Got VAPID Key:", vapidKey);

      // A: Register SW (served from /public/sw.js)
      console.log("[WebPushSubscribe] Registering service worker /sw.js…");
      const registration = await navigator.serviceWorker.register("/sw.js", {
        scope: "/",
      });
      await registration.update().catch(() => undefined);
      console.log("[WebPushSubscribe] Service worker registered:", registration);

      // B: Notification permission
      console.log("[WebPushSubscribe] Requesting Notification permission…");
      const permission = await Notification.requestPermission();
      console.log("[WebPushSubscribe] Notification.permission:", permission);
      if (permission !== "granted") {
        throw new Error("Notification permission was not granted.");
      }

      // C: Subscribe with VAPID key
      console.log("[WebPushSubscribe] Subscribing to pushManager…");
      const applicationServerKey = urlBase64ToUint8Array(vapidKey) as BufferSource;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });
      console.log("[WebPushSubscribe] Subscription obtained:", subscription);

      const json = subscription.toJSON() as Record<string, unknown>;

      // D: Save to Supabase
      console.log("[WebPushSubscribe] Saving subscription to DB…", json);
      await savePushSubscription(json);
      console.log("[WebPushSubscribe] Subscription saved!");

      setStatus("success");
    } catch (e) {
      setStatus("error");
      console.error("[WebPushSubscribe] Error during subscribeUser:", e);
    }
  }, []);

  // Hide banner once user subscribes (success)
  if (status === "success") {
    return null;
  }

  return (
    <div
      className="mb-6 rounded-xl bg-white/5 px-6 py-5 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 border border-white/10 shadow"
    >
      <div>
        <div className="font-medium text-base text-white/90">📢 Get Daily Profit Reports</div>
      </div>
      <button
        type="button"
        onClick={() => void subscribeUser()}
        disabled={status === "loading"}
        className={`inline-flex items-center justify-center px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-sm transition disabled:opacity-60 disabled:cursor-not-allowed shadow-sm`}
      >
        {status === "loading" ? "…" : "🔔 Enable Notifications"}
      </button>
    </div>
  );
}
