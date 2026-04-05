"use server";

import { supabaseAdmin } from "@/lib/supabase";

/** Persist the entire incoming Web Push subscription object. */
export async function savePushSubscription(subscription: Record<string, unknown>): Promise<void> {
  // Store the exact incoming object, no stripping or sanitizing
  const { error } = await supabaseAdmin.from("push_subscriptions").upsert(
    {
      // This assumes the incoming subscription has an 'endpoint' field—a spec requirement
      endpoint: (subscription as any).endpoint,
      subscription_json: subscription,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "endpoint" }
  );

  if (error) {
    throw new Error(`Failed to save push subscription: ${error.message}`);
  }
}
