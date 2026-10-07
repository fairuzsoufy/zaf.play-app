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
