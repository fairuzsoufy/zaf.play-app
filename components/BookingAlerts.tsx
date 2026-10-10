import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { dateLabel, timeLabel } from '@/lib/format';
import { toast } from './Toast';

// show our notifications even while the app is open
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

async function notify(title: string, body: string) {
  toast(`${title} ${body}`);
  try {
    const { granted } = await Notifications.getPermissionsAsync();
    if (!granted && !(await Notifications.requestPermissionsAsync()).granted) return;
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('bookings', { name: 'Bookings', importance: Notifications.AndroidImportance.HIGH });
    }
    await Notifications.scheduleNotificationAsync({ content: { title, body }, trigger: Platform.OS === 'android' ? { channelId: 'bookings' } : null });
  } catch { /* the toast already told them */ }
}

// Tells the player the moment Zaf Play approves (or rejects) their payment, while the app is open or in the background.
// Expo Go can't receive server push on Android, so this listens to the booking itself.
export function BookingAlerts() {
  const { session } = useAuth();
  const uid = session?.user.id;
  const known = useRef<Record<string, string>>({}); // booking id → payment status we last saw

  useEffect(() => {
    if (!uid) return;
    let live = true;
    supabase.from('bookings').select('id,payment_status').eq('user_id', uid).in('status', ['pending', 'confirmed'])
      .then(({ data }) => { if (live) for (const b of data ?? []) known.current[b.id] = b.payment_status; });

    // a fresh name every time: reusing one that is still subscribed throws
    const ch = supabase.channel(`booking-alerts-${uid}-${Date.now()}`)
      .on('postgres_changes' as any, { event: 'UPDATE', schema: 'public', table: 'bookings', filter: `user_id=eq.${uid}` }, async (p: any) => {
        const b = p.new;
        const before = known.current[b.id];
        known.current[b.id] = b.payment_status;
        if (before !== 'pending_review') return;
        if (b.payment_status !== 'paid' && b.status !== 'cancelled') return;
        const { data: c } = await supabase.from('courts').select('name').eq('id', b.court_id).maybeSingle();
        const when = `${dateLabel(b.start_time)} · ${timeLabel(b.start_time)}`;
        if (b.payment_status === 'paid') notify('✅ Booking confirmed', `${c?.name ?? 'Your court'}, ${when}. See you on court!`);
        else notify('Payment not approved', `${c?.name ?? 'Your booking'}, ${when}. Open My bookings for details.`);
      })
      .subscribe();
    return () => { live = false; supabase.removeChannel(ch); };
  }, [uid]);

  return null;
}

// ask once, at a moment it makes sense (right after sending a payment), so the approval can show as a notification
export async function askToNotify() {
  try {
    const { granted, canAskAgain } = await Notifications.getPermissionsAsync();
    if (!granted && canAskAgain) await Notifications.requestPermissionsAsync();
  } catch { /* not important */ }
}
