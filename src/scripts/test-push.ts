import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

webpush.setVapidDetails(
  'mailto:test@example.com',
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
);

async function testPush() {
  const { data: subs, error } = await supabase.from('push_subscriptions').select('*');
  
  if (error || !subs) {
    console.error('❌ Error fetching subs:', error);
    return;
  }

  console.log(`[test-push] Found ${subs.length} subscription(s)`);

  for (const sub of subs) {
    try {
      // 🧐 כאן אנחנו בודקים מה באמת יש בפנים
      const rawData = sub.subscription_json;
      const pushConfig = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;

      // הדפסת המבנה כדי שנבין איפה ה-keys מתחבאים
      console.log(`[DEBUG] Object structure for ID ${sub.id.slice(0,4)}:`, JSON.stringify(pushConfig).slice(0, 100) + "...");

      // וידוא שהמפתחות קיימים
      if (!pushConfig.keys || !pushConfig.keys.auth || !pushConfig.keys.p256dh) {
         console.error(`❌ Missing keys in subscription ${sub.id}. Keys found:`, pushConfig.keys ? Object.keys(pushConfig.keys) : 'NONE');
         continue;
      }

      console.log(`[test-push] Sending to ID: ${sub.id}`);
      
      await webpush.sendNotification(
        pushConfig,
        JSON.stringify({
          title: 'Adtex: Profit Alert! 💰',
          body: 'Success! Your push notification system is live.',
          icon: '/icon-512.png'
        })
      );
      
      console.log(`✅ SUCCESS: Notification sent to ${sub.id}`);
    } catch (err: any) {
      console.error(`❌ FAIL id=${sub.id}:`, err.message);
    }
  }
}

testPush();