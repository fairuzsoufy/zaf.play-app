import '@/lib/localStorage';
import { supabase } from '@/lib/supabase';
import { isInstapay } from '@/lib/payment';

// Small things the Book screen remembers on this phone only, like the website's lib/bookPrefs and lib/favourites:
// the last area picked and the courts with the heart on. The sport is not remembered (Fairuz, 28 Oct).
// Every read and write is wrapped, so the screen works without storage.
const PREFS_KEY = 'zaf:book-prefs';
const FAV_KEY = 'zaf:favourites';
const MAX_FAVS = 50;

export function readArea(): string {
  try { return String(JSON.parse(localStorage.getItem(PREFS_KEY) || '{}').area || ''); } catch { return ''; }
}
export function saveArea(area: string) {
  try {
    const now = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...now, area }));
  } catch {}
}

export function readFavourites(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(FAV_KEY) || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch { return []; }
}
// adds or removes a court; returns the new list (newest first)
export function toggleFavourite(courtId: string): string[] {
  const now = readFavourites();
  const next = now.includes(courtId) ? now.filter((id) => id !== courtId) : [courtId, ...now].slice(0, MAX_FAVS);
  try { localStorage.setItem(FAV_KEY, JSON.stringify(next)); } catch {}
  return next;
}

// The refund InstaPay to fill in on the Pay screen, like the website's RefundInstapayPicker: the number used last time
// (booking or open-game spot), otherwise the mobile on the account. '' when there is none, so the field is typed once.
export async function savedRefundInstapay(userId: string): Promise<string> {
  for (const t of ['bookings', 'open_game_players'] as const) {
    const { data } = await supabase.from(t).select('refund_to').eq('user_id', userId).not('refund_to', 'is', null)
      .order('created_at', { ascending: false }).limit(1);
    const v = String((data as any[] | null)?.[0]?.refund_to || '').trim();
    if (v && isInstapay(v)) return v;
  }
  const { data: me } = await supabase.from('users').select('phone').eq('id', userId).maybeSingle();
  const phone = String((me as any)?.phone || '').trim();
  return isInstapay(phone) ? phone : '';
}
