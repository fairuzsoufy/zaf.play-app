const TZ = 'Africa/Cairo';

export const egp = (n: number | null | undefined) =>
  `${Math.round((n ?? 0) * 100) / 100} EGP`;

// 12-hour with capitals, like the website: "6:30 PM"
export function timeLabel(iso: string): string {
  return new Date(iso)
    .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: TZ })
    .replace(/\s?([ap])m$/i, (_m, x: string) => ` ${x.toUpperCase()}M`);
}

export function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ,
  });
}

// Cairo calendar helpers: the phone may be set to any time zone, courts always run on Cairo time.
export function cairoDate(offsetDays = 0): string {
  return new Date(Date.now() + offsetDays * 86400000).toLocaleDateString('en-CA', { timeZone: TZ });
}

// minutes Cairo is ahead of UTC at this instant (120 or 180 in summer)
function cairoOffsetMin(ms: number): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]),
  ) as Record<string, string>;
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  return Math.round((asUtc - Math.floor(ms / 60000) * 60000) / 60000);
}

// a real instant -> its Cairo day and minutes after that day's midnight (the opposite of cairoToDate)
export function cairoDayMinutes(iso: string): { date: string; minutes: number } {
  const d = new Date(iso);
  const hm = d.toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return { date: d.toLocaleDateString('en-CA', { timeZone: TZ }), minutes: Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5)) };
}

// "2026-10-08" + 18*60+30 minutes after Cairo midnight -> real instant
export function cairoToDate(date: string, minutes: number): Date {
  const [y, m, d] = date.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d) + minutes * 60000;
  const off = cairoOffsetMin(guess - 2 * 3600000);
  return new Date(guess - off * 60000);
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const x = new Date(Date.UTC(y, m - 1, d + n));
  return x.toISOString().slice(0, 10);
}

export const weekdayOf = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();

// "18:30" -> "6:30 PM"
export function hm12(hhmm: string): string {
  const [h, m] = hhmm.slice(0, 5).split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

export function durationText(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return `${h === 1 ? '1 hour' : `${h} hours`}${m ? ` ${m} min` : ''}`;
}

export function countdown(ms: number): string {
  if (ms <= 0) return '0:00';
  const t = Math.floor(ms / 1000);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

// "Sat 31 Oct · 6:30 PM – 8:00 PM", like the website's whenText
export function whenText(start: string, end?: string | null): string {
  return `${dateLabel(start)} · ${timeLabel(start)}${end ? ` – ${timeLabel(end)}` : ''}`;
}

export const dateTimeText = (iso: string) => `${dateLabel(iso)}, ${timeLabel(iso)}`;

const LEVEL_TEXT: Record<string, string> = { any: 'Any level', beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' };

// 'any' or one / two levels saved as 'beginner,intermediate'
export function levelText(level: string | null | undefined): string {
  if (!level || level === 'any') return LEVEL_TEXT.any;
  return level.split(',').map((l) => LEVEL_TEXT[l] || l).join(' + ');
}

// "in 12 min", "in 3 h", "in 2 days"
export function untilText(iso: string, now = Date.now()): string {
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return 'now';
  const min = Math.round(ms / 60000);
  if (min < 60) return `in ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `in ${h} h`;
  return `in ${Math.round(h / 24)} days`;
}

export const teamSizeText = (n: number) => (n === 1 ? 'Singles (1 player)' : `${n}v${n} (${n} players per team)`);

export function roundName(round: number, rounds: number): string {
  const fromEnd = rounds - round;
  if (fromEnd === 0) return 'Final';
  if (fromEnd === 1) return 'Semi-finals';
  if (fromEnd === 2) return 'Quarter-finals';
  return `Round of ${2 ** (fromEnd + 1)}`;
}
