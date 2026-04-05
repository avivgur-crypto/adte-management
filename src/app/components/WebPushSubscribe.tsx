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

  const subscribeUser = useCallback(async () => {
    setStatus("loading");
    try {
      if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
        throw new Error("Service workers are not supported in this browser.");
      }
      if (!("PushManager" in window)) {
        throw new Error("Push messaging is not supported in this browser.");
      }

      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
      // Skip showing error to user if VAPID key undefined per instructions

      // A: Register SW (served from /public/sw.js)
      const registration = await navigator.serviceWorker.register("/sw.js", {
        scope: "/",
      });
      await registration.update().catch(() => undefined);

      // B: Notification permission
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        throw new Error("Notification permission was not granted.");
      }

      // C: Subscribe with VAPID key
      const applicationServerKey = urlBase64ToUint8Array(vapidKey!) as BufferSource;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });

      const json = subscription.toJSON() as Record<string, unknown>;

      // D: Save to Supabase
      await savePushSubscription(json);

      setStatus("success");
    } catch (e) {
      setStatus("error");
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
