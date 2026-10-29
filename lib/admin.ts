import { supabase } from './supabase';

// Small helpers the admin screens share, the same as the website's lib/proofs.ts and lib/playerSnapshot.ts.

// a payment carries 1–2 photos; the database keeps their paths in one text column, comma separated
export const splitProofs = (paths: string | null | undefined) => (paths || '').split(',').map((p) => p.trim()).filter(Boolean);
export const isPdfPath = (path: string) => path.toLowerCase().endsWith('.pdf');

// the name and mobile number saved on the booking win over today's profile (changed details, deleted account)
export function withSnapshot<T extends { player_name?: string | null; player_phone?: string | null; player?: { full_name?: string | null; phone?: string | null } | null } | null | undefined>(b: T): T {
  if (!b || (!b.player_name && !b.player_phone)) return b;
  const deleted = b.player?.full_name === 'Deleted player';
  return { ...b, player: { ...(b.player || {}), full_name: (b.player_name || b.player?.full_name || '') + (deleted ? ' (deleted account)' : ''), phone: b.player_phone || b.player?.phone } };
}

// short-lived links for files in a private bucket: path -> url
export async function signedUrls(bucket: string, paths: string[]): Promise<Record<string, string>> {
  if (!paths.length) return {};
  const { data } = await supabase.storage.from(bucket).createSignedUrls(paths, 3600);
  const map: Record<string, string> = {};
  (data || []).forEach((x: any) => { if (x.path && x.signedUrl) map[x.path] = x.signedUrl; });
  return map;
}

export function ago(iso: string) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)} h ago`;
  return `${Math.round(mins / 1440)} days ago`;
}

const t12 = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Africa/Cairo', hour: 'numeric', minute: '2-digit', hour12: true }).replace(/am|pm/, (x) => x.toUpperCase());
// "Sat 18 Oct · 7:00 PM – 8:30 PM"
export function slotText(start?: string | null, end?: string | null) {
  if (!start) return '';
  const day = new Date(start).toLocaleDateString('en-GB', { timeZone: 'Africa/Cairo', weekday: 'short', day: 'numeric', month: 'short' });
  return `${day} · ${t12(start)} – ${t12(end || start)}`;
}

export const BOOKING_FIELDS = `id, user_id, court_id, start_time, end_time, total_price, amount_due, credit_amount, rescheduled_from, cancel_request_status, group_id,
  player_name, player_phone,
  player:users!bookings_user_id_fkey ( full_name, phone, email ),
  sport:sports ( name ),
  court:courts ( name, facility:facilities ( name ) )`;

export async function isAdmin(userId: string) {
  const { data } = await supabase.from('users').select('role').eq('id', userId).maybeSingle();
  return (data as any)?.role === 'admin';
}
