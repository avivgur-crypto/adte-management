"use server";

import { supabaseAdmin } from "@/lib/supabase";

/** Persist Web Push subscription (PushSubscription.toJSON() shape). */
export async function savePushSubscription(subscription: Record<string, unknown>): Promise<void> {
  const endpoint = typeof subscription.endpoint === "string" ? subscription.endpoint : "";
  if (!endpoint) {
    throw new Error("Invalid subscription: missing endpoint.");
  }

  const { error } = await supabaseAdmin.from("push_subscriptions").upsert(
    {
      endpoint,
      subscription_json: subscription,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "endpoint" },
  );

  if (error) {
    throw new Error(`Failed to save push subscription: ${error.message}`);
  }
}
