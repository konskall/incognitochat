
import { supabase } from '../services/supabase';

// REPLACE THIS WITH YOUR VAPID PUBLIC KEY FROM STEP 1
const VAPID_PUBLIC_KEY = 'BGTGP7sFM_sOavl6uF_e-MeAnapyi6sI_bjoSSk3N4mjCW6bPHdQxvN7Z4w750IAhEHsy9xfPY9MCHu7Y7OADbU'; 

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
  if (!('serviceWorker' in navigator)) return false;

  try {
    const registration = await navigator.serviceWorker.ready;
    
    // Subscribe to push manager
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
    });

    // Serialize subscription
    const subJson = JSON.parse(JSON.stringify(subscription));

    // Save to Supabase
    const { error } = await supabase.from('push_subscriptions').upsert({
      user_id: userId,
      room_key: roomKey,
      endpoint: subJson.endpoint,
      p256dh: subJson.keys.p256dh,
      auth: subJson.keys.auth
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

export async function unsubscribeFromPushNotifications(userId: string, roomKey: string) {
     // 1. Remove from DB
     await supabase.from('push_subscriptions')
        .delete()
        .eq('user_id', userId)
        .eq('room_key', roomKey);
        
     // 2. Unsubscribe locally (optional, usually we want to keep SW active for other rooms)
     // const registration = await navigator.serviceWorker.ready;
     // const subscription = await registration.pushManager.getSubscription();
     // if (subscription) await subscription.unsubscribe();
}
