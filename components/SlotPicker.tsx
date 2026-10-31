import { useEffect, useMemo, useState } from 'react';
import { pick } from '@/lib/haptics';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/components/AppText';
import { colors, radius, themed } from '@/lib/theme';
import { addDays, cairoToDate, countdown, durationText, weekdayOf } from '@/lib/format';
import { GradientFill } from './ui';

export type Rule = { day_of_week: number; open_time: string; close_time: string; is_closed: boolean };
export type Busy = { start_time: string; end_time: string; state: string; hold_expires_at: string | null };
export type Pick = { date: string; start: number | null; duration: number }; // start = minutes after Cairo midnight

const STEP = 30;
const MAX_LENGTH = 240;
const DAY = 1440;
const DAYS_SHOWN = 14;
const COLS = 5; // like the website's time grid on a phone
const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };

// "6 PM" / "6:30 PM", like the website's startLabel (after-midnight times wrap to the next morning)
export function startLabel(minutes: number) {
  const m = ((minutes % DAY) + DAY) % DAY;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h % 12 || 12}${mm ? `:${String(mm).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
}

function hoursOn(rules: Rule[], date: string) {
  const r = rules.find((x) => x.day_of_week === weekdayOf(date));
  if (!r || r.is_closed) return null;
  const open = toMin(r.open_time);
  let close = toMin(r.close_time);
  if (close <= open) close += DAY; // closes after midnight
  return { open, close };
}

// busy and held times that still count, as minutes from the midnight of `date`
function busyOn(busy: Busy[], date: string, now: number) {
  const midnight = cairoToDate(date, 0).getTime();
  return busy
    .filter((b) => !(b.state === 'hold' && b.hold_expires_at && new Date(b.hold_expires_at).getTime() <= now))
    .map((b) => ({
      s: Math.round((new Date(b.start_time).getTime() - midnight) / 60000),
      e: Math.round((new Date(b.end_time).getTime() - midnight) / 60000),
      raw: b,
    }));
}

// every start on `date` where `length` minutes fit: open, not booked, not started yet (the website's freeStartsOn)
function freeStartsOn(rules: Rule[], busy: Busy[], date: string, now: number, length: number, step = STEP) {
  const h = hoursOn(rules, date);
  if (!h) return [];
  const blocks = busyOn(busy, date, now);
  const out: number[] = [];
  for (let s = Math.ceil(h.open / step) * step; s + length <= h.close; s += step) {
    if (cairoToDate(date, s).getTime() <= now) continue;
    if (blocks.some((b) => s < b.e && s + length > b.s)) continue;
    out.push(s);
  }
  return out;
}

// after midnight, a late-closing court's evening is still "today" (the website's businessToday)
function businessToday(rules: Rule[], now: number) {
  const today = new Date(now).toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
  const yesterday = addDays(today, -1);
  const h = hoursOn(rules, yesterday);
  return h && h.close > DAY && now < cairoToDate(yesterday, h.close).getTime() ? yesterday : today;
}

function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

// The website's time picker (app/components/TimePicker.tsx): a day, then the half-hour times in a grid.
// Tap a time to book 30 minutes (or the court's minimum), tap the time just before or after the block to add
// 30 minutes, tap a picked time to take it off. One block, up to 4 hours.
export function SlotPicker({
  rules, busy, value, onChange, minMinutes, maxDate, onBusyTap, current,
}: {
  rules: Rule[]; busy: Busy[]; value: Pick; onChange: (p: Pick) => void;
  minMinutes: number; maxDate?: string; onBusyTap?: (startIso: string, endIso: string) => void;
  current?: { start: string; end: string } | null; // the booking being changed: marked "Now", its own times count as free
}) {
  const s = useS();
  const now = useNow();
  const [tip, setTip] = useState('');
  const [gridW, setGridW] = useState(0);
  const MIN = Math.max(STEP, Math.ceil(minMinutes / STEP) * STEP);
  const today = businessToday(rules, now);
  const date = value.date || today;

  // its own times don't count as busy
  const activeBusy = useMemo(() => busy.filter((b) => !(current &&
    new Date(b.start_time).getTime() === new Date(current.start).getTime() &&
    new Date(b.end_time).getTime() === new Date(current.end).getTime())), [busy, current]);

  const dates: string[] = [];
  for (let d = today; dates.length < DAYS_SHOWN; d = addDays(d, 1)) {
    if (maxDate && d > maxDate) break;
    dates.push(d);
  }

  const hours = hoursOn(rules, date);
  const blocks = busyOn(activeBusy, date, now);
  const cellFree = new Set(freeStartsOn(rules, activeBusy, date, now, STEP));
  const fitting = new Set(freeStartsOn(rules, activeBusy, date, now, MIN));
  const cur = current ? busyOn([{ start_time: current.start, end_time: current.end, state: 'paid', hold_expires_at: null }], date, now)[0] : null;
  const pickedStart = value.start;
  const pickedEnd = pickedStart !== null ? pickedStart + value.duration : null;
  const at = (m: number) => cairoToDate(date, m).getTime();

  const starts: number[] = [];
  if (hours) {
    for (let m = Math.ceil(hours.open / STEP) * STEP; m + STEP <= hours.close; m += STEP) {
      if (at(m) <= now && !(cur && m >= cur.s && m < cur.e)) continue;
      starts.push(m);
    }
  }
  const dayFree = fitting.size > 0;
  const busyAt = (m: number) => blocks.find((b) => m < b.e && m + STEP > b.s);
  const nextDay = (() => {
    if (dayFree) return null;
    for (let i = 1; i <= DAYS_SHOWN; i++) {
      const d = addDays(date, i);
      if (maxDate && d > maxDate) break;
      const f = freeStartsOn(rules, activeBusy, d, now, MIN);
      if (f.length) return { date: d, start: f[0] };
    }
    return null;
  })();

  const commit = (s0: number, e0: number) => onChange({ date, start: s0, duration: e0 - s0 });
  const clear = () => onChange({ date, start: null, duration: 0 });
  function pickDay(d: string) { setTip(''); onChange({ date: d, start: null, duration: 0 }); }
  // the booking being changed: its own half hours are free for the new choice
  const fitsOwn = (m: number) => !!hours && m >= hours.open && m + STEP <= hours.close && !blocks.some((b) => m < b.e && m + STEP > b.s);
  const isFree = (m: number) => cellFree.has(m) || (!!cur && m >= cur.s && m < cur.e && fitsOwn(m));
  const allFree = (s0: number, e0: number) => { for (let m = s0; m < e0; m += STEP) if (!isFree(m)) return false; return true; };

  function tap(m: number) {
    setTip('');
    if (pickedStart !== null && pickedEnd !== null && m >= pickedStart && m < pickedEnd) {
      // from an end the block shrinks; from the middle the longer side stays, so there is never a gap
      const before: [number, number] = [pickedStart, m];
      const after: [number, number] = [m + STEP, pickedEnd];
      const keep = before[1] - before[0] >= MIN ? before : after[1] - after[0] >= MIN ? after : null;
      return keep ? commit(keep[0], keep[1]) : clear();
    }
    if (pickedStart === null || pickedEnd === null) {
      if (allFree(m, m + MIN)) return commit(m, m + MIN);
      return setTip(`There isn't ${durationText(MIN)} free from ${startLabel(m)}. Please pick another time.`);
    }
    if (m !== pickedEnd && m + STEP !== pickedStart) {
      return setTip(`Your times must be next to each other. To play at ${startLabel(m)} too, book it on its own after this booking.`);
    }
    const s1 = Math.min(pickedStart, m);
    const e1 = Math.max(pickedEnd, m + STEP);
    if (e1 - s1 > MAX_LENGTH) return setTip(`One booking can be ${durationText(MAX_LENGTH)} at most.`);
    if (!allFree(m, m + STEP)) return setTip(`${startLabel(m)} isn't free. Please pick another time.`);
    commit(s1, e1);
  }
  const freeCount = (d: string) => freeStartsOn(rules, activeBusy, d, now, MIN, 60).length;

  const GAP = 6;
  const cellW = gridW ? (gridW - GAP * (COLS - 1)) / COLS : 0;
  const dayName = (d: string) => (d === today ? 'Today' : new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' }).toUpperCase());
  const dayNum = (d: string) => Number(d.slice(8, 10));

  const busyCell = (m: number, b: ReturnType<typeof busyAt>) => {
    const raw = b!.raw;
    const hold = raw.state === 'hold' && raw.hold_expires_at ? new Date(raw.hold_expires_at).getTime() : null;
    return (
      <Pressable
        key={m}
        disabled={!onBusyTap}
        onPress={() => { pick(); onBusyTap?.(raw.start_time, raw.end_time); }}
        style={[s.slot, { width: cellW }, hold ? s.slotHold : s.slotTaken]}
        accessibilityLabel={`${startLabel(m)} ${hold ? 'on hold' : 'booked'}`}
      >
        <Text style={[s.slotText, hold ? { color: colors.warning } : s.struck]} numberOfLines={1}>{startLabel(m)}</Text>
        <Text style={[s.slotSmall, hold ? { color: colors.warning } : null]} numberOfLines={1}>{hold ? `Held ${countdown(hold - now)}` : 'Booked'}</Text>
      </Pressable>
    );
  };

  return (
    <View style={{ marginBottom: 12 }}>
      {/* the days */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }} contentContainerStyle={{ gap: 8 }}>
        {dates.map((d) => {
          const on = d === date;
          const closed = !hoursOn(rules, d);
          const n = closed ? 0 : freeCount(d);
          return (
            <Pressable key={d} onPress={() => { pick(); pickDay(d); }} style={[s.day, on && s.dayOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
              {on && <GradientFill />}
              <Text style={[s.daySmall, on && { color: 'rgba(255,255,255,0.85)' }]}>{dayName(d)}</Text>
              <Text style={[s.dayNum, on && { color: '#fff' }]}>{dayNum(d)}</Text>
              {closed ? <Text style={[s.daySmall, on && { color: 'rgba(255,255,255,0.85)' }]}>Closed</Text>
                : n === 0 ? <Text style={[s.daySmall, on && { color: 'rgba(255,255,255,0.85)' }]}>Full</Text>
                : <View style={[s.dot, { backgroundColor: on ? '#fff' : n <= 3 ? colors.warning : colors.success }]} />}
            </Pressable>
          );
        })}
      </ScrollView>

      <Text style={s.label}>Pick your time</Text>
      <View onLayout={(e) => setGridW(e.nativeEvent.layout.width)}>
        {!hours ? (
          <Text style={s.amber}>The court is closed on this day. Please pick another date.</Text>
        ) : !dayFree ? (
          <View style={{ gap: 14 }}>
            <View style={s.full}>
              <Text style={{ color: colors.text, fontSize: 17, fontWeight: '800' }}>{date === today ? 'Today is fully booked' : 'This day is fully booked'}</Text>
              {nextDay && <Text style={{ color: colors.muted, fontSize: 13, marginTop: 2 }}>Next free: {dayName(nextDay.date)} {dayNum(nextDay.date)} at {startLabel(nextDay.start)}</Text>}
            </View>
            {nextDay && (
              <Pressable onPress={() => { pick(); setTip(''); onChange({ date: nextDay.date, start: nextDay.start, duration: MIN }); }} style={s.bigBtn} accessibilityRole="button">
                <GradientFill />
                <Text style={{ color: '#fff', fontWeight: '800', fontSize: 16 }}>Book {dayName(nextDay.date)} {startLabel(nextDay.start)}</Text>
              </Pressable>
            )}
            {cellW > 0 && starts.some((m) => busyAt(m)) && (
              <>
                <Text style={s.label}>Or wait for {date === today ? 'today' : 'this day'}</Text>
                <View style={[s.grid, { gap: GAP }]}>
                  {starts.filter((m) => busyAt(m)).slice(0, 10).map((m) => busyCell(m, busyAt(m)))}
                </View>
              </>
            )}
          </View>
        ) : starts.length === 0 ? (
          <Text style={s.amber}>No times left on this day. Please pick another date.</Text>
        ) : cellW > 0 && (
          <View style={[s.grid, { gap: GAP }]}>
            {starts.map((m) => {
              const picked = pickedStart !== null && pickedEnd !== null && m >= pickedStart && m < pickedEnd;
              const isCur = !!cur && m >= cur.s && m < cur.e;
              const free = isFree(m);
              const b = busyAt(m);
              if (b && !free) return busyCell(m, b);
              return (
                <Pressable
                  key={m}
                  disabled={!free}
                  onPress={() => { pick(); tap(m); }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: picked, disabled: !free }}
                  style={({ pressed }) => [s.slot, { width: cellW }, picked && s.slotSel, isCur && !picked && s.slotCur, !free && s.slotPast, pressed && free && !picked && { borderColor: colors.accent }]}
                >
                  {picked && <GradientFill />}
                  <Text style={[s.slotText, picked && { color: '#fff' }]} numberOfLines={1}>{startLabel(m)}</Text>
                  {isCur && !picked ? <Text style={s.slotSmall}>Now</Text> : m >= DAY ? <Text style={s.slotSmall}>🌙</Text> : null}
                </Pressable>
              );
            })}
          </View>
        )}
        {onBusyTap && dayFree && starts.some((m) => busyAt(m) && !isFree(m)) && (
          <Text style={{ color: colors.muted, fontSize: 12, textAlign: 'center', marginTop: 10 }}>🔔 Tap a crossed-out time and we message you if it frees up.</Text>
        )}
        {!!tip && <Text style={[s.amber, { marginTop: 10, fontWeight: '600' }]}>{tip}</Text>}
      </View>
    </View>
  );
}

const useS = themed(() => StyleSheet.create({
  day: { width: 64, minHeight: 72, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center', gap: 2, overflow: 'hidden' },
  dayOn: { borderColor: 'transparent' },
  daySmall: { fontSize: 11, fontWeight: '700', color: colors.muted },
  dayNum: { fontSize: 21, fontWeight: '800', color: colors.text, lineHeight: 24 },
  dot: { width: 5, height: 5, borderRadius: 3, marginTop: 2 },
  label: { color: colors.muted, fontSize: 12, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  slot: { minHeight: 44, borderRadius: 11, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 1, overflow: 'hidden' },
  slotText: { color: colors.text, fontWeight: '700', fontSize: 12 },
  slotSmall: { color: colors.muted, fontSize: 9, fontWeight: '600', lineHeight: 11 },
  slotSel: { borderColor: 'transparent' },
  slotCur: { borderWidth: 2, borderColor: '#e0206f' },
  slotPast: { backgroundColor: colors.taken, borderColor: 'transparent', opacity: 0.7 },
  slotTaken: { backgroundColor: 'transparent', borderStyle: 'dashed', borderColor: colors.borderStrong },
  slotHold: { backgroundColor: colors.hold, borderStyle: 'dashed', borderColor: colors.warning },
  struck: { textDecorationLine: 'line-through', color: colors.muted, fontWeight: '600' },
  amber: { backgroundColor: colors.noteBg, borderWidth: 1, borderColor: colors.noteBorder, color: colors.noteText, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, overflow: 'hidden' },
  full: { borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,62,138,0.45)', backgroundColor: 'rgba(255,62,138,0.08)', padding: 14 },
  bigBtn: { height: 54, borderRadius: 16, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
}));
