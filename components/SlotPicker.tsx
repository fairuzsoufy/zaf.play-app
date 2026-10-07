import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, gradient, radius } from '@/lib/theme';
import { addDays, cairoDate, cairoToDate, dateLabel, durationText, hm12, weekdayOf } from '@/lib/format';

export type Rule = { day_of_week: number; open_time: string; close_time: string; is_closed: boolean };
export type Busy = { start_time: string; end_time: string; state: string; hold_expires_at: string | null };
export type Pick = { date: string; start: number | null; duration: number }; // start = minutes after Cairo midnight

const STEP = 30;
const MAX_MIN = 240; // up to 4 hours
const DAY = 1440;
const ROW = 30; // height of one 30-minute row
const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
const clock = (m: number) => hm12(`${String(Math.floor((m % DAY) / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);

export function hoursFor(rules: Rule[], date: string) {
  const r = rules.find((x) => x.day_of_week === weekdayOf(date));
  if (!r || r.is_closed) return null;
  const open = toMin(r.open_time);
  let close = toMin(r.close_time);
  if (close <= open) close += DAY; // closes after midnight
  return { open, close };
}

// A day calendar like the website's: the court's hours down the side, booked times as grey blocks, holds striped.
// Tap a start time and you get the minimum straight away; tap lower to move the finish, tap higher to move the start,
// or use the − / + buttons. Minimum from the court, maximum 4 hours.
export function SlotPicker({
  rules, busy, value, onChange, minMinutes, maxDate, onBusyTap, waitingFor,
}: {
  rules: Rule[]; busy: Busy[]; value: Pick; onChange: (p: Pick) => void;
  minMinutes: number; maxDate?: string; onBusyTap?: (startIso: string, endIso: string) => void;
  waitingFor?: string[]; // start times (ms) the player waits for: drawn with a bell
}) {
  const [now, setNow] = useState(Date.now());
  const [note, setNote] = useState('');
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(t); }, []);

  const today = cairoDate();
  const MIN = Math.max(STEP, Math.ceil(minMinutes / STEP) * STEP);
  const active = busy.filter((b) => !(b.state === 'hold' && b.hold_expires_at && new Date(b.hold_expires_at).getTime() <= now));

  const days = useMemo(() => {
    const out: string[] = [];
    for (let i = 0; i < 14; i++) {
      const d = addDays(today, i);
      if (maxDate && d > maxDate) break;
      out.push(d);
    }
    return out;
  }, [today, maxDate]);

  const takenAt = (date: string, m: number) => {
    const s = cairoToDate(date, m).getTime();
    const e = s + STEP * 60000;
    return active.find((b) => s < new Date(b.end_time).getTime() && e > new Date(b.start_time).getTime());
  };
  const freeOn = (date: string, m: number) => {
    const h = hoursFor(rules, date);
    return !!h && m >= h.open && m + STEP <= h.close && cairoToDate(date, m).getTime() > now && !takenAt(date, m);
  };
  // can this day still be booked (open, and at least one free stretch of the minimum length left)?
  const bookable = (date: string) => {
    const h = hoursFor(rules, date);
    if (!h) return false;
    for (let m = h.open; m + MIN <= h.close; m += STEP) {
      let ok = true;
      for (let x = m; x < m + MIN; x += STEP) if (!freeOn(date, x)) { ok = false; break; }
      if (ok) return true;
    }
    return false;
  };

  // a day that is over (or full) shows the next day that can be booked, like the website
  const jumped = useRef(false);
  useEffect(() => {
    if (value.date < today) { onChange({ date: today, start: null, duration: 0 }); return; }
    if (jumped.current || value.start !== null) return;
    jumped.current = true;
    if (value.date === today && !bookable(today)) {
      const next = days.find((d) => d > today && bookable(d));
      if (next) { onChange({ date: next, start: null, duration: 0 }); setNote('Today is over, so we are showing the next day.'); }
    }
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const date = value.date;
  const hours = hoursFor(rules, date);
  const rows: number[] = [];
  if (hours) for (let m = hours.open; m + STEP <= hours.close; m += STEP) rows.push(m);
  const isOpen = (m: number) => !!hours && m >= hours.open && m + STEP <= hours.close;
  const isPast = (m: number) => cairoToDate(date, m).getTime() <= now;
  const free = (m: number) => freeOn(date, m);
  const rangeFree = (s: number, e: number) => { for (let m = s; m < e; m += STEP) if (!free(m)) return false; return true; };

  const midnight = cairoToDate(date, 0).getTime();
  const sel = value.start !== null && value.duration > 0 ? { s: value.start, e: value.start + value.duration } : null;
  // if the chosen time was just taken by someone else, clear it
  const clash = !!sel && !rangeFree(sel.s, sel.e);
  useEffect(() => {
    if (clash) { setNote('Someone just took that time. Please choose again.'); onChange({ ...value, start: null, duration: 0 }); }
  }, [clash]); // eslint-disable-line react-hooks/exhaustive-deps

  const blocks = active
    .map((b) => {
      const s = (new Date(b.start_time).getTime() - midnight) / 60000;
      const e = (new Date(b.end_time).getTime() - midnight) / 60000;
      return { s, e, b, hold: b.state === 'hold' };
    })
    .filter((x) => hours && x.e > hours.open && x.s < hours.close);

  const commit = (s: number, e: number) => {
    if (e - s < MIN) e = s + MIN;
    if (e - s > MAX_MIN) { setNote('The longest booking is 4 hours.'); e = s + MAX_MIN; }
    if (!rangeFree(s, e)) { setNote('Something is booked there, so that time is not free.'); return; }
    onChange({ date, start: s, duration: e - s });
  };

  function tap(m: number) {
    setNote('');
    const t = takenAt(date, m);
    if (t && isOpen(m) && onBusyTap) return onBusyTap(t.start_time, t.end_time);
    if (!isOpen(m)) return setNote('The court is closed at that time.');
    if (isPast(m)) return setNote('That time has passed.');
    if (!free(m)) return setNote('That time is taken.');
    if (!sel) return commit(m, m + MIN);
    if (m >= sel.s && m < sel.e) return setNote('To change your booking, tap above or below it, or use the − / + buttons.');
    if (m >= sel.e) return commit(sel.s, m + STEP);
    let st = Math.max(m, sel.e - MAX_MIN);
    if (st > m) setNote('The longest booking is 4 hours.');
    while (st < sel.s && !rangeFree(st, sel.s)) st += STEP;
    if (st >= sel.s) return setNote("Something is booked just above, so your booking can't start earlier.");
    commit(st, sel.e);
  }

  const canNudge = (which: 'start' | 'end', dir: -1 | 1) => {
    if (!sel) return false;
    const ns = which === 'start' ? sel.s + dir * STEP : sel.s;
    const ne = which === 'end' ? sel.e + dir * STEP : sel.e;
    if (ne - ns < MIN || ne - ns > MAX_MIN) return false;
    if (which === 'start' && dir < 0) return rangeFree(ns, sel.s);
    if (which === 'end' && dir > 0) return rangeFree(sel.e, ne);
    return true;
  };
  const nudge = (which: 'start' | 'end', dir: -1 | 1) => {
    if (!sel || !canNudge(which, dir)) return;
    setNote('');
    commit(which === 'start' ? sel.s + dir * STEP : sel.s, which === 'end' ? sel.e + dir * STEP : sel.e);
  };

  const pickDay = (d: string) => { setNote(''); onChange({ date: d, start: null, duration: 0 }); };
  const dayName = (d: string, i: number) => (i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : dateLabel(`${d}T12:00:00Z`).split(' ')[0].replace(',', ''));
  const dayDate = (d: string) => dateLabel(`${d}T12:00:00Z`).split(' ').slice(1).join(' ');
  const gridH = rows.length * ROW;
  const topOf = (m: number) => ((m - (hours?.open ?? 0)) / STEP) * ROW;

  return (
    <View>
      <Text style={s.rule}>Minimum <Text style={s.bold}>{durationText(MIN)}</Text>  ·  Maximum <Text style={s.bold}>4 hours</Text></Text>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
        {days.map((d, i) => {
          const on = date === d;
          const label = !hoursFor(rules, d) ? 'Closed' : !bookable(d) ? (d === today ? 'Over' : 'Full') : dayDate(d);
          const inner = (
            <>
              <Text style={[s.dayTop, on && { color: '#fff' }]}>{dayName(d, i)}</Text>
              <Text style={[s.dayBottom, on && { color: '#ffffffcc' }]}>{label}</Text>
            </>
          );
          return (
            <Pressable key={d} onPress={() => pickDay(d)} style={[s.day, on && { borderColor: 'transparent' }, !on && !bookable(d) && { opacity: 0.5 }]}>
              {on && <LinearGradient colors={gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />}
              {inner}
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={s.legend}>
        <Legend color="transparent" border={colors.border} label="Free" />
        <Legend gradient label="Your booking" />
        <Legend color="#3a3a4d" label="Booked" />
        <Legend color="#6b4a12" label="On hold" />
      </View>

      {!hours ? (
        <Text style={s.muted}>The court is closed on this day.</Text>
      ) : (
        <View style={[s.cal, { height: gridH }]}>
          {rows.map((m, r) => {
            const past = isPast(m);
            return (
              <Pressable key={m} onPress={() => tap(m)} style={[s.row, { top: r * ROW, height: ROW }, past && s.past]}>
                <View style={s.gutter}>
                  {m % 60 === 0 && <Text style={[s.hour, r === 0 && { marginTop: 3 }]}>{m === DAY ? 'Midnight' : clock(m)}</Text>}
                </View>
                <View style={[s.line, m % 60 === 0 && { borderTopColor: colors.border }]} />
              </Pressable>
            );
          })}

          {blocks.map((x, k) => {
            const s0 = Math.max(x.s, hours.open);
            const e0 = Math.min(x.e, hours.close);
            const waitingHere = !!waitingFor?.includes(String(new Date(x.b.start_time).getTime()));
            return (
              <Pressable key={k} onPress={() => onBusyTap?.(x.b.start_time, x.b.end_time)} disabled={!onBusyTap}
                style={[s.ev, { top: topOf(s0) + 1, height: ((e0 - s0) / STEP) * ROW - 3 }, x.hold ? s.evHold : s.evTaken]}>
                <Text style={s.evText} numberOfLines={1}>{x.hold ? 'On hold' : 'Booked'}{waitingHere ? '  🔔' : ''}</Text>
                <Text style={s.evSub} numberOfLines={1}>{clock(s0)} – {clock(e0)}</Text>
              </Pressable>
            );
          })}

          {sel && (
            <View pointerEvents="none" style={[s.ev, s.evMine, { top: topOf(sel.s) + 1, height: ((sel.e - sel.s) / STEP) * ROW - 3 }]}>
              <LinearGradient colors={gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
              <Text style={[s.evText, { color: '#fff' }]}>{clock(sel.s)} – {clock(sel.e)}</Text>
              <Text style={[s.evSub, { color: '#ffffffdd' }]}>{durationText(sel.e - sel.s)}</Text>
            </View>
          )}
        </View>
      )}

      {!!note && <View style={s.note}><Text style={{ color: colors.warning, fontSize: 13 }}>{note}</Text></View>}

      {hours && (
        <View style={s.your}>
          {sel ? (
            <>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={s.muted2}>Your booking</Text>
                  <Text style={s.when}>{dayName(date, days.indexOf(date))} {dayDate(date)} · {clock(sel.s)} → {clock(sel.e)}</Text>
                  <Text style={s.muted2}>{durationText(sel.e - sel.s)}{sel.e > DAY ? ' · after midnight' : ''}</Text>
                </View>
                <Pressable onPress={() => { setNote(''); onChange({ date, start: null, duration: 0 }); }} hitSlop={10}>
                  <Text style={s.clear}>Clear</Text>
                </Pressable>
              </View>
              <View style={s.steppers}>
                {([['start', 'Starts', sel.s], ['end', 'Finishes', sel.e]] as const).map(([which, label, m]) => (
                  <View key={which} style={s.stepper}>
                    <Text style={s.muted2}>{label}</Text>
                    <View style={s.stepRow}>
                      <Pressable style={[s.step, !canNudge(which, -1) && { opacity: 0.3 }]} disabled={!canNudge(which, -1)} onPress={() => nudge(which, -1)}>
                        <Text style={s.stepText}>−</Text>
                      </Pressable>
                      <Text style={s.stepTime}>{clock(m)}</Text>
                      <Pressable style={[s.step, !canNudge(which, 1) && { opacity: 0.3 }]} disabled={!canNudge(which, 1)} onPress={() => nudge(which, 1)}>
                        <Text style={s.stepText}>+</Text>
                      </Pressable>
                    </View>
                  </View>
                ))}
              </View>
              <Text style={s.muted2}>− / + move the time by 30 minutes.</Text>
            </>
          ) : (
            <Text style={{ color: colors.text }}>
              <Text style={s.bold}>Step 1:</Text> tap the time you want to start on the calendar.{' '}
              <Text style={{ color: colors.muted }}>You get {durationText(MIN)} straight away and can make it longer.</Text>
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

function Legend({ color, border, gradient: g, label }: { color?: string; border?: string; gradient?: boolean; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginRight: 14 }}>
      <View style={{ width: 14, height: 14, borderRadius: 4, backgroundColor: color, borderWidth: border ? 1 : 0, borderColor: border, overflow: 'hidden' }}>
        {g && <LinearGradient colors={gradient} style={StyleSheet.absoluteFill} />}
      </View>
      <Text style={{ color: colors.muted, fontSize: 12 }}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  rule: { color: colors.muted, fontSize: 13, marginBottom: 12 },
  bold: { color: colors.text, fontWeight: '700' },
  day: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.md, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, marginRight: 8, alignItems: 'center', overflow: 'hidden' },
  dayTop: { color: colors.text, fontWeight: '700' },
  dayBottom: { color: colors.muted, fontSize: 11, marginTop: 2 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 10, rowGap: 6 },
  cal: { position: 'relative', backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  row: { position: 'absolute', left: 0, right: 0, flexDirection: 'row' },
  past: { backgroundColor: '#0c0b14' },
  gutter: { width: 62, paddingRight: 8, alignItems: 'flex-end' },
  hour: { color: colors.muted, fontSize: 11, marginTop: -7 },
  line: { flex: 1, borderTopWidth: 1, borderTopColor: '#1b1a2b' },
  ev: { position: 'absolute', left: 68, right: 6, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, overflow: 'hidden', justifyContent: 'center' },
  evTaken: { backgroundColor: '#3a3a4d' },
  evHold: { backgroundColor: '#6b4a12' },
  evMine: { shadowColor: colors.violet, shadowOpacity: 0.6, shadowRadius: 8, elevation: 4 },
  evText: { color: colors.text, fontSize: 12, fontWeight: '700' },
  evSub: { color: colors.muted, fontSize: 11 },
  note: { marginTop: 10, borderRadius: radius.md, borderWidth: 1, borderColor: '#5a4318', backgroundColor: '#2a2010', padding: 10 },
  your: { marginTop: 14, backgroundColor: colors.card, borderRadius: radius.lg, padding: 14, borderWidth: 1, borderColor: colors.border, gap: 10 },
  when: { color: colors.text, fontWeight: '800', fontSize: 16, marginVertical: 2 },
  clear: { color: colors.muted, textDecorationLine: 'underline', fontSize: 13 },
  muted: { color: colors.muted, fontSize: 13, marginTop: 8 },
  muted2: { color: colors.muted, fontSize: 12 },
  steppers: { flexDirection: 'row', gap: 10 },
  stepper: { flex: 1, backgroundColor: colors.cardAlt, borderRadius: radius.md, padding: 10, gap: 6 },
  stepRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  step: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  stepText: { color: colors.text, fontSize: 22, fontWeight: '700', marginTop: -2 },
  stepTime: { color: colors.text, fontWeight: '800' },
});
