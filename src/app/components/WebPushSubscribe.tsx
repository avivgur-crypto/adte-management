"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

// Key for tracking push subscription in localStorage
const LOCALSTORAGE_KEY = "webpush-subscribed-v1";

// Optionally, a quick way to check for an existing push subscription for this app/user profile
async function hasExistingPushSubscription(registration: ServiceWorkerRegistration) {
  try {
    const sub = await registration.pushManager.getSubscription();
    return Boolean(sub);
  } catch {
    return false;
  }
}

export default function WebPushSubscribe() {
  const [showBanner, setShowBanner] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const checkedRef = useRef(false);

  // Only show if:
  // - Not already granted
  // - User hasn't actually subscribed already (checked via localStorage AND existing subscription)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const permission = Notification.permission;
    if (permission === "granted") {
      setShowBanner(false);
      return;
    }
    // If permission denied, do not show either
    if (permission === "denied") {
      setShowBanner(false);
      return;
    }

    // Only run this check once
    if (checkedRef.current) return;
    checkedRef.current = true;

    // Check for prior local storage flag
    if (localStorage.getItem(LOCALSTORAGE_KEY) === "1") {
      setShowBanner(false);
      return;
    }

    // Check for actual existing push subscription (user might have switched browsers, etc)
    if ("serviceWorker" in navigator && "PushManager" in window) {
      navigator.serviceWorker
        .getRegistration()
        .then((reg) => {
          if (!reg) {
            setShowBanner(true);
            return;
          }
          hasExistingPushSubscription(reg).then((exists) => {
            setShowBanner(!exists);
          });
        })
        .catch(() => setShowBanner(true));
    } else {
      setShowBanner(false);
    }
  }, []);

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
      const registration =
        (await navigator.serviceWorker.getRegistration()) ||
        (await navigator.serviceWorker.register("/sw.js", { scope: "/" }));
      await registration.update().catch(() => undefined);

      // Notification permission
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        throw new Error("Notification permission was not granted.");
      }

      // Subscribe with VAPID key
      const applicationServerKey = urlBase64ToUint8Array(vapidKey) as BufferSource;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey,
        });
      }

      const json = subscription.toJSON() as Record<string, unknown>;

      // Save to Supabase
      await savePushSubscription(json);

      // Mark in localStorage
      localStorage.setItem(LOCALSTORAGE_KEY, "1");

      setStatus("success");
      setMessage("Notifications enabled. You are subscribed.");
      setTimeout(() => setShowBanner(false), 900); // Hide banner after a short confirmation
    } catch (e) {
      setStatus("error");
      setMessage(e instanceof Error ? e.message : "Something went wrong.");
    }
  }, []);

  // Never render if showBanner is false
  if (!showBanner) return null;

  return (
    <div
      className="fixed z-40 top-3 left-1/2 -translate-x-1/2 flex flex-row items-center justify-between bg-gradient-to-br from-black/90 to-slate-900/90 border border-white/10 rounded-xl shadow-xl px-5 py-2 min-w-[320px] max-w-lg w-auto gap-4"
      role="status"
      style={{ boxShadow: "0 4px 28px 0 rgba(0,0,0,0.26)" }}
    >
      <div className="flex flex-col sm:flex-row items-center gap-2 flex-1 min-w-0">
        <span className="flex items-center mr-2 text-xl">🔔</span>
        <span className="text-white/90 font-medium truncate">
          Get notified with important updates!
        </span>
      </div>
      <button
        type="button"
        onClick={() => void subscribeUser()}
        disabled={status === "loading"}
        className="inline-flex shrink-0 items-center whitespace-nowrap rounded-lg border border-white/10 bg-white/10 px-3 py-1.5 text-sm font-medium text-white/95 transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {status === "loading" ? "Enabling…" : "Enable"}
      </button>
      <button
        type="button"
        onClick={() => setShowBanner(false)}
        title="Dismiss"
        className="ml-1 p-1 opacity-70 hover:opacity-100 text-lg text-white"
        aria-label="Dismiss this message"
        tabIndex={0}
      >
        ×
      </button>
      {message && (
        <span
          className={`ml-2 text-xs ${
            status === "success"
              ? "text-emerald-200/90"
              : status === "error"
              ? "text-red-200/90"
              : "text-white/70"
          } transition`}
        >
          {message}
        </span>
      )}
    </div>
  );
}
