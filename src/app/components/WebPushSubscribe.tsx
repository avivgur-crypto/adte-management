"use client";

import { useCallback, useState } from "react";
import { savePushSubscription } from "@/app/actions/push-subscription";

/** VAPID public key: URL-safe Base64 → Uint8Array for PushManager.subscribe */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export default function WebPushSubscribe() {
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  const subscribeUser = useCallback(async () => {
    setStatus("loading");
    setMessage(null);

    try {
      if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
        throw new Error("Service workers are not supported in this browser.");
      }
      if (!("PushManager" in window)) {
        throw new Error("Push messaging is not supported in this browser.");
      }

      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
      if (!vapidKey) {
        throw new Error("NEXT_PUBLIC_VAPID_PUBLIC_KEY is not configured.");
      }

      // Register SW (served from /public/sw.js)
      const registration = await navigator.serviceWorker.register("/sw.js", {
        scope: "/",
      });
      await registration.update().catch(() => undefined);

      // Notification permission
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        throw new Error("Notification permission was not granted.");
      }

      // Subscribe with VAPID key
      const applicationServerKey = urlBase64ToUint8Array(vapidKey) as BufferSource;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });

      // Only send endpoint and subscription_json for upsert.
      const data = {
        endpoint: subscription.endpoint,
        subscription_json: subscription.toJSON(),
      };

      // Save using server action (should use supabaseAdmin with full permissions)
      await savePushSubscription(data);

      setStatus("success");
      setMessage("Notifications enabled. You are subscribed.");
    } catch (e) {
      setStatus("error");
      setMessage(e instanceof Error ? e.message : "Something went wrong.");
    }
  }, []);

  return (
    <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <button
        type="button"
        onClick={() => void subscribeUser()}
        disabled={status === "loading"}
        className="inline-flex shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-white/90 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {status === "loading" ? "…" : "🔔 Enable Notifications"}
      </button>
      {message && (
        <p
          className={`text-sm ${
            status === "success" ? "text-emerald-300/90" : status === "error" ? "text-red-300/90" : "text-white/60"
          }`}
        >
          {message}
        </p>
      )}
    </div>
  );
}
