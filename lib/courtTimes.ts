// Free-time maths and search for the Book screen, the same as the website's lib/courtTimes.ts (Cairo time).
import { addDays, cairoToDate, weekdayOf } from './format';

export type Rule = { day_of_week: number; open_time: string; close_time: string; is_closed: boolean };
export type Busy = { start_time: string; end_time: string; state?: string; hold_expires_at?: string | null };

const DAY_MIN = 24 * 60;
const SLOT_STEP = 30;
const MIN_LENGTH = 30;

const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
};
const cairoAt = (date: string, minutes: number) => cairoToDate(date, minutes).getTime();
const minutesFrom = (date: string, ms: number) => (ms - cairoAt(date, 0)) / 60000;

// a time tapped on a court card opens the booking with a full hour picked (or the court's minimum when longer)
export function cardLength(minMinutes: number) {
  return Math.max(60, MIN_LENGTH, Math.ceil((minMinutes || 0) / SLOT_STEP) * SLOT_STEP);
}

// up to `n` starts for a court card: the first free one (it may be a half hour), then whole hours after it
export function spreadStarts(starts: number[], n: number) {
  const out: number[] = [];
  for (const s of starts) {
    if (out.length >= n) break;
    if (!out.length) out.push(s);
    else if (s % 60 === 0 && s >= out[out.length - 1] + (out.length === 1 ? 30 : 60)) out.push(s);
  }
  return out;
}

function hoursOn(rules: Rule[], date: string) {
  const rule = rules.find((r) => r.day_of_week === weekdayOf(date));
  if (!rule || rule.is_closed) return null;
  const open = toMin(rule.open_time);
  let close = toMin(rule.close_time);
  if (close <= open) close += DAY_MIN;
  return { open, close };
}

// every start on `date` where `length` minutes fit: inside opening hours, not over a busy time, not already started
export function freeStartsOn({ rules, busy, date, nowMs, length, step = SLOT_STEP }: {
  rules: Rule[]; busy: Busy[]; date: string; nowMs: number; length: number; step?: number;
}) {
  const hours = hoursOn(rules, date);
  if (!hours) return [];
  const blocks = busy
    .filter((b) => !(b.state === 'hold' && b.hold_expires_at && new Date(b.hold_expires_at).getTime() <= nowMs))
    .map((b) => ({ s: minutesFrom(date, new Date(b.start_time).getTime()), e: minutesFrom(date, new Date(b.end_time).getTime()) }));
  const out: number[] = [];
  for (let s = Math.ceil(hours.open / step) * step; s + length <= hours.close; s += step) {
    if (cairoAt(date, s) <= nowMs) continue;
    if (blocks.some((b) => s < b.e && s + length > b.s)) continue;
    out.push(s);
  }
  return out;
}

// the first day (from `from`) that still has a free start, looking at most `days` days ahead
export function nextFreeDay({ rules, busy, from, nowMs, length, days = 14 }: {
  rules: Rule[]; busy: Busy[]; from: string; nowMs: number; length: number; days?: number;
}) {
  for (let i = 0; i < days; i++) {
    const date = addDays(from, i);
    const starts = freeStartsOn({ rules, busy, date, nowMs, length });
    if (starts.length) return { date, start: starts[0] };
  }
  return null;
}

// "6 PM" / "6:30 PM" for a start in minutes from midnight (after-midnight times wrap to the next morning)
export function startLabel(minutes: number) {
  const m = ((minutes % DAY_MIN) + DAY_MIN) % DAY_MIN;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h % 12 || 12}${mm ? `:${String(mm).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
}

// "today" for a court that closes after midnight: until it closes, the evening that started yesterday is still today
export function businessToday(rules: Rule[], nowMs: number) {
  const today = new Date(nowMs).toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
  const yesterday = addDays(today, -1);
  const h = hoursOn(rules, yesterday);
  return h && h.close > DAY_MIN && nowMs < cairoAt(yesterday, h.close) ? yesterday : today;
}

// Search: lower-case, no accents or punctuation, so "Héliopolis!" finds "heliopolis"
function normalize(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// small typo help: "padle" finds "padel" and "helio" finds "heliopolis"
function wordMatches(query: string, word: string) {
  if (word.startsWith(query)) return true;
  if (query.length < 4 || word.length < 4) return false;
  const a = query;
  const b = word.slice(0, Math.min(word.length, query.length + 1));
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true;
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
  }
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

// every word typed must match some word of the text
export function searchMatches(query: string, text: string) {
  const words = normalize(text).split(' ').filter(Boolean);
  return normalize(query).split(' ').filter(Boolean).every((q) => words.some((w) => wordMatches(q, w)));
}

export type Coords = { lat: number; lng: number };

// straight-line distance in km (haversine)
export function distanceKm(a: Coords, b: Coords): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

// "~350 m", "~2.4 km", "~12 km"
export function formatDistance(km: number): string {
  if (km < 1) return `~${Math.max(50, Math.round((km * 1000) / 50) * 50)} m`;
  if (km < 10) return `~${km.toFixed(1)} km`;
  return `~${Math.round(km)} km`;
}
