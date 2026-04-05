"use client";

import { useCallback, useEffect, useState } from "react";
import { savePushSubscription } from "@/app/actions/push-subscription";

const IS_SUBSCRIBED_KEY = "is_subscribed";

type BannerVisibility = "checking" | "visible" | "hidden";

function readInitialVisibility(): BannerVisibility {
  if (typeof window === "undefined") return "checking";
  try {
    if (localStorage.getItem(IS_SUBSCRIBED_KEY) === "true") return "hidden";
  } catch {
    /* ignore */
  }
  return "checking";
}

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
  const [visibility, setVisibility] = useState<BannerVisibility>(readInitialVisibility);
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      if (localStorage.getItem(IS_SUBSCRIBED_KEY) === "true") {
        setVisibility("hidden");
        return;
      }
    } catch {
      /* ignore */
    }

    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      setVisibility("hidden");
      try {
        localStorage.setItem(IS_SUBSCRIBED_KEY, "true");
      } catch {
        /* ignore */
      }
      return;
    }

    setVisibility("visible");
  }, []);

  const subscribeUser = useCallback(async () => {
    console.log('📢 [PUSH] Button clicked! Starting process...');
    setStatus('loading');

    try {
      if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
        throw new Error("Service workers are not supported in this browser.");
      }
      if (!("PushManager" in window)) {
        throw new Error("Push messaging is not supported in this browser.");
      }

      const registration = await navigator.serviceWorker.ready;
      console.log('📢 [PUSH] Service Worker is ready');

      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      console.log('📢 [PUSH] Using VAPID key:', vapidKey?.slice(0, 10) + '...');

      // הרשמה למנוי
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey!) as any
      });

      console.log('📢 [PUSH] Raw subscription obtained');

      // 🚨 כאן הקסם: שליפה ידנית של המפתחות כי toJSON לפעמים מזייף
      const p256dh = btoa(
        String.fromCharCode.apply(
          null,
          Array.from(new Uint8Array(subscription.getKey('p256dh')!)) as any
        )
      );
      const auth = btoa(
        String.fromCharCode.apply(
          null,
          Array.from(new Uint8Array(subscription.getKey('auth')!)) as any
        )
      );

      const subData = {
        endpoint: subscription.endpoint,
        expirationTime: subscription.expirationTime,
        keys: {
          auth: auth.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
          p256dh: p256dh.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
        }
      };

      console.log('📢 [PUSH] Final object with keys ready to send:', subData);

      await savePushSubscription(subData);
      console.log('📢 [PUSH] Success! Saved to Supabase');
      try {
        localStorage.setItem(IS_SUBSCRIBED_KEY, "true");
      } catch {
        /* ignore */
      }
      setVisibility("hidden");
      setStatus('success');
      setMessage("Notifications enabled. You are subscribed.");
    } catch (e) {
      console.error('❌ [PUSH] Critical Error:', e);
      setStatus('error');
      setMessage(e instanceof Error ? e.message : "Something went wrong.");
    }
  }, []);

  if (visibility !== "visible") {
    return null;
  }

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
