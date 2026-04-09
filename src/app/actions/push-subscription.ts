"use server";

import { supabaseAdmin } from "@/lib/supabase";
import { createClient } from "@/lib/supabase-server";

/** Persist the Web Push subscription and link it to the current user. */
export async function savePushSubscription(
  subscription: Record<string, unknown>,
): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabaseAdmin.from("push_subscriptions").upsert(
    {
      endpoint: (subscription as any).endpoint,
      subscription_json: subscription,
      user_id: user?.id ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "endpoint" },
  );

  if (error) {
    throw new Error(`Failed to save push subscription: ${error.message}`);
  }
}
