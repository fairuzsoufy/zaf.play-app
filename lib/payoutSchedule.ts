// When Zaf Play pays an owner, the same as the website's lib/payoutSchedule: every day for the first month after the
// owner's first court is approved, then once a week, every Thursday by 11:59 PM Cairo time. The database gives
// `daily_until` (admin_payout_schedules); null means no court is approved yet.
export const WEEKLY_PAYOUT_DAY = 'Thursday';
export const PAYOUT_SCHEDULE_TEXT = `Daily for your first month after your first court is approved, then weekly every ${WEEKLY_PAYOUT_DAY} by 11:59 PM (Cairo time).`;

const cairoToday = (now = new Date()) => now.toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });

function nextThursday(today: string) {
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + ((4 - d.getUTCDay() + 7) % 7)); // 4 = Thursday
  return d.toISOString().slice(0, 10);
}

export const shortDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });

export function payoutSchedule(dailyUntil: string | null | undefined, now = new Date()): { mode: 'none' | 'daily' | 'weekly'; dailyUntil: string | null; nextDue: string | null } {
  const today = cairoToday(now);
  if (!dailyUntil) return { mode: 'none', dailyUntil: null, nextDue: null };
  if (today < dailyUntil) return { mode: 'daily', dailyUntil, nextDue: today };
  return { mode: 'weekly', dailyUntil, nextDue: nextThursday(today) };
}
