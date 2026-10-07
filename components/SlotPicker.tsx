import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, radius } from '@/lib/theme';
import { addDays, cairoDate, cairoToDate, dateLabel, durationText, hm12, weekdayOf } from '@/lib/format';

export type Rule = { day_of_week: number; open_time: string; close_time: string; is_closed: boolean };
export type Busy = { start_time: string; end_time: string; state: string; hold_expires_at: string | null };
export type Pick = { date: string; start: number | null; duration: number }; // start = minutes after Cairo midnight

const STEP = 30;
const MAX_MIN = 240;
const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };

export function hoursFor(rules: Rule[], date: string) {
  const r = rules.find((x) => x.day_of_week === weekdayOf(date));
  if (!r || r.is_closed) return null;
  const open = toMin(r.open_time);
  let close = toMin(r.close_time);
  if (close <= open) close += 1440; // closes after midnight
  return { open, close };
}

// Pick a day, a start time and how long. Closed, past and booked times are greyed out.
export function SlotPicker({
  rules, busy, value, onChange, minMinutes, maxDate, onBusyTap,
}: {
  rules: Rule[]; busy: Busy[]; value: Pick; onChange: (p: Pick) => void;
  minMinutes: number; maxDate?: string; onBusyTap?: (startIso: string, endIso: string) => void;
}) {
  const today = cairoDate();
  const days = useMemo(() => {
    const out: string[] = [];
    for (let i = 0; i < 14; i++) {
      const d = addDays(today, i);
      if (maxDate && d > maxDate) break;
      out.push(d);
    }
    return out;
  }, [today, maxDate]);
  const min = Math.max(STEP, Math.ceil(minMinutes / STEP) * STEP);
  const hours = hoursFor(rules, value.date);
  const now = Date.now();

  const active = busy.filter((b) => !(b.state === 'hold' && b.hold_expires_at && new Date(b.hold_expires_at).getTime() <= now));
  const taken = (m: number) => {
    const s = cairoToDate(value.date, m).getTime();
    const e = s + STEP * 60000;
    return active.find((b) => s < new Date(b.end_time).getTime() && e > new Date(b.start_time).getTime());
  };
  const free = (m: number) => !!hours && m >= hours.open && m + STEP <= hours.close && cairoToDate(value.date, m).getTime() > now && !taken(m);
  const rangeFree = (s: number, len: number) => { for (let m = s; m < s + len; m += STEP) if (!free(m)) return false; return true; };

  const slots: number[] = [];
  if (hours) for (let m = hours.open; m + STEP <= hours.close; m += STEP) slots.push(m);

  const maxFor = (s: number) => { let len = 0; while (len < MAX_MIN && free(s + len)) len += STEP; return len; };
  const maxLen = value.start !== null ? maxFor(value.start) : 0;

  function tap(m: number) {
    const b = taken(m);
    if (b && onBusyTap && hours && m >= hours.open) return onBusyTap(b.start_time, b.end_time);
    if (!free(m)) return;
    const len = rangeFree(m, min) ? Math.max(min, value.start !== null && value.duration <= maxFor(m) ? value.duration : min) : 0;
    if (!len) return;
    onChange({ ...value, start: m, duration: len });
  }

  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
        {days.map((d, i) => (
          <Pressable key={d} onPress={() => onChange({ date: d, start: null, duration: 0 })}
            style={[s.day, value.date === d && s.on]}>
            <Text style={[s.dayTop, value.date === d && { color: '#fff' }]}>{i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : dateLabel(`${d}T12:00:00Z`).split(' ')[0]}</Text>
            <Text style={[s.dayBottom, value.date === d && { color: '#fff' }]}>{hoursFor(rules, d) ? dateLabel(`${d}T12:00:00Z`).split(' ').slice(1).join(' ') : 'Closed'}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {!hours ? (
        <Text style={s.muted}>The court is closed on this day.</Text>
      ) : (
        <>
          <Text style={s.label}>Start time</Text>
          <View style={s.grid}>
            {slots.map((m) => {
              const isFree = free(m);
              const picked = value.start !== null && m >= value.start && m < value.start + value.duration;
              const t = taken(m);
              return (
                <Pressable key={m} onPress={() => tap(m)} disabled={!isFree && !(t && onBusyTap)}
                  style={[s.slot, picked && s.on, !isFree && !picked && s.off]}>
                  <Text style={[s.slotText, picked && { color: '#fff' }, !isFree && !picked && { color: colors.muted }]}>
                    {hm12(`${String(Math.floor((m % 1440) / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`)}
                  </Text>
                  {t ? <Text style={s.tiny}>{t.state === 'hold' ? 'on hold' : 'booked'}</Text> : null}
                </Pressable>
              );
            })}
          </View>

          {value.start !== null && (
            <View style={s.dur}>
              <Text style={s.label}>How long</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Pressable style={[s.step, value.duration <= min && { opacity: 0.3 }]} disabled={value.duration <= min}
                  onPress={() => onChange({ ...value, duration: value.duration - STEP })}><Text style={s.stepText}>−</Text></Pressable>
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: 16 }}>{durationText(value.duration)}</Text>
                <Pressable style={[s.step, value.duration + STEP > maxLen && { opacity: 0.3 }]} disabled={value.duration + STEP > maxLen}
                  onPress={() => onChange({ ...value, duration: value.duration + STEP })}><Text style={s.stepText}>+</Text></Pressable>
              </View>
              <Text style={s.muted}>Minimum {durationText(min)}, maximum 4 hours. Ends at{' '}
                {hm12(`${String(Math.floor(((value.start + value.duration) % 1440) / 60)).padStart(2, '0')}:${String((value.start + value.duration) % 60).padStart(2, '0')}`)}
                {value.start + value.duration > 1440 ? ' (after midnight)' : ''}.</Text>
            </View>
          )}
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  day: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.md, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, marginRight: 8, alignItems: 'center' },
  dayTop: { color: colors.text, fontWeight: '700' },
  dayBottom: { color: colors.muted, fontSize: 11, marginTop: 2 },
  on: { backgroundColor: colors.primary, borderColor: colors.primary },
  off: { opacity: 0.45 },
  label: { color: colors.muted, fontSize: 13, marginBottom: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  slot: { width: '30.5%', paddingVertical: 10, borderRadius: radius.md, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  slotText: { color: colors.text, fontWeight: '600' },
  tiny: { color: colors.warning, fontSize: 10, marginTop: 1 },
  dur: { marginTop: 18, backgroundColor: colors.card, borderRadius: radius.lg, padding: 14, borderWidth: 1, borderColor: colors.border },
  step: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.cardAlt, alignItems: 'center', justifyContent: 'center' },
  stepText: { color: colors.text, fontSize: 22, fontWeight: '700' },
  muted: { color: colors.muted, fontSize: 12, marginTop: 8 },
});
