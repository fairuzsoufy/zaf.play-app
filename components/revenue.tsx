import { View } from 'react-native';
import { Text } from '@/components/AppText';
import { colors, radius } from '@/lib/theme';
import { Muted } from './owner';

// shared by Owner → Money and the admin's Revenue
export type Group = 'day' | 'week' | 'month';

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };
export const egp0 = (n: number | string) => `${Number(n).toLocaleString('en-EG', { maximumFractionDigits: 0 })} EGP`;

// the website's quick date ranges (DateRangePicker)
export const RANGES: { label: string; get: () => [string, string] }[] = [
  { label: 'Today', get: () => [ymd(new Date()), ymd(new Date())] },
  { label: 'Yesterday', get: () => [ymd(daysAgo(1)), ymd(daysAgo(1))] },
  { label: 'Last 7 days', get: () => [ymd(daysAgo(6)), ymd(new Date())] },
  { label: 'Last 30 days', get: () => [ymd(daysAgo(29)), ymd(new Date())] },
  { label: 'This month', get: () => { const t = new Date(); return [ymd(new Date(t.getFullYear(), t.getMonth(), 1)), ymd(new Date(t.getFullYear(), t.getMonth() + 1, 0))]; } },
  { label: 'Last month', get: () => { const t = new Date(); return [ymd(new Date(t.getFullYear(), t.getMonth() - 1, 1)), ymd(new Date(t.getFullYear(), t.getMonth(), 0))]; } },
  { label: 'Last 3 months', get: () => [ymd(daysAgo(89)), ymd(new Date())] },
  { label: 'This year', get: () => { const t = new Date(); return [ymd(new Date(t.getFullYear(), 0, 1)), ymd(new Date(t.getFullYear(), 11, 31))]; } },
];

export function defaultGroup(from: string, to: string): Group {
  const days = (new Date(to).getTime() - new Date(from).getTime()) / 86400000;
  return days > 180 ? 'month' : days > 45 ? 'week' : 'day';
}

export function Tile({ label, value, sub, strong }: { label: string; value: string; sub?: string; strong?: boolean }) {
  return (
    <View style={{ width: '50%', padding: 4 }}>
      <View style={{ borderWidth: 1, borderColor: strong ? colors.success : colors.border, borderRadius: radius.lg, padding: 12, backgroundColor: colors.card }}>
        <Text style={{ color: strong ? colors.success : colors.muted, fontSize: 12 }}>{label}</Text>
        <Text style={{ color: colors.text, fontSize: 18, fontWeight: '800', marginTop: 2 }}>{value}</Text>
        {!!sub && <Muted style={{ fontSize: 11 }}>{sub}</Muted>}
      </View>
    </View>
  );
}

