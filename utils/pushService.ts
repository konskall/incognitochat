
import { supabase } from '../services/supabase';

// VAPID public key (safe to ship to the client). The matching private key is a
// Supabase secret (VAPID_PRIVATE_KEY) used only by the `send-push` Edge Function.
const VAPID_PUBLIC_KEY = 'BH7GMEOmJ8h-am1gUZqhMP3jVRV_oUMiKD3vdtlMXhcfI5sggWXmmC9q7irvM44i9PHCvEDZZiupxzXtL4j60cM';

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export async function subscribeToPushNotifications(userId: string, roomKey: string) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;

  try {
    const registration = await navigator.serviceWorker.ready;
    if (!registration.pushManager) return false;

    const appKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);

    // Reuse an existing push subscription if there is one. If it was created with
    // a DIFFERENT applicationServerKey (e.g. the VAPID key changed, or a stale
    // subscription from another deploy), pushManager.subscribe() throws — so drop
    // the old one first. This is a common cause of "couldn't enable" on iOS/Android.
    let subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      const existingKey = new Uint8Array((subscription.options.applicationServerKey as ArrayBuffer) || new ArrayBuffer(0));
      const sameKey = existingKey.length === appKey.length && existingKey.every((b, i) => b === appKey[i]);
      if (!sameKey) {
        try { await subscription.unsubscribe(); } catch { /* ignore */ }
        subscription = null;
      }
    }
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: appKey,
      });
    }

    // Serialize subscription
    const subJson = JSON.parse(JSON.stringify(subscription));

    // Save to Supabase. created_at is refreshed EXPLICITLY: the conflict-UPDATE
    // path would otherwise keep the original insert time, and send-push picks
    // one row per device endpoint by NEWEST created_at — it must track the
    // device's currently-active identity (Google <-> anonymous switches), not
    // whichever identity happened to subscribe first.
    const { error } = await supabase.from('push_subscriptions').upsert({
      user_id: userId,
      room_key: roomKey,
      endpoint: subJson.endpoint,
      p256dh: subJson.keys.p256dh,
      auth: subJson.keys.auth,
      created_at: new Date().toISOString()
    }, { onConflict: 'user_id, room_key, endpoint' });

    if (error) {
        console.error('Supabase subscription error:', error);
        return false;
    }

    return true;

  } catch (error) {
    console.error('Push subscription failed:', error);
    return false;
  }
}

export async function unsubscribeFromPushNotifications(userId: string, roomKey: string): Promise<boolean> {
     // 1. Remove from DB. The error MUST be checked: a silent failure (network /
     //    RLS) left this device a live send-push target while the UI claimed
     //    notifications were OFF — the user kept getting pushes they turned off.
     const { error } = await supabase.from('push_subscriptions')
        .delete()
        .eq('user_id', userId)
        .eq('room_key', roomKey);
     if (error) {
        console.error('Unsubscribe DB delete failed:', error);
        return false;
     }

     // 2. If this was the user's LAST subscribed room on this device, drop the
     //    browser PushManager subscription too so the platform stops delivering
     //    pushes entirely. (One browser subscription backs all rooms, so we only
     //    tear it down when no room rows remain — otherwise other rooms break.)
     try {
        const { count } = await supabase.from('push_subscriptions')
           .select('id', { count: 'exact', head: true })
           .eq('user_id', userId);
        if (!count) {
           const registration = await navigator.serviceWorker.ready;
           const subscription = await registration.pushManager.getSubscription();
           if (subscription) await subscription.unsubscribe();
        }
     } catch (e) {
        console.error('Local push unsubscribe failed:', e);
        // DB row is already gone (the authoritative state for send-push), so
        // this is best-effort — report success.
     }
     return true;
}
