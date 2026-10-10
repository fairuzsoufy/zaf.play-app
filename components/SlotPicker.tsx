import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, radius, themed, useTheme } from '@/lib/theme';
import { addDays, cairoDate, cairoToDate, countdown, dateLabel, durationText, hm12, weekdayOf } from '@/lib/format';
import { GradientFill } from './ui';

export type Rule = { day_of_week: number; open_time: string; close_time: string; is_closed: boolean };
export type Busy = { start_time: string; end_time: string; state: string; hold_expires_at: string | null };
export type Pick = { date: string; start: number | null; duration: number }; // start = minutes after Cairo midnight

const STEP = 30;
const MAX_MIN = 240;
const DAY = 1440;
const ROW = 34; // height of one 30-minute row
const DAYS_SHOWN = 14;
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

// true when the court is closed that day, or its hours are over (not even the shortest booking still fits)
export function dayIsOver(rules: Rule[], date: string, minMinutes: number, now = Date.now()) {
  const h = hoursFor(rules, date);
  if (!h) return true;
  return cairoToDate(date, h.close - minMinutes).getTime() <= now;
}

// the first day from `from` on that still has bookable hours (or `from` itself if none in the next two weeks)
export function firstOpenDay(rules: Rule[], from: string, minMinutes: number, maxDate?: string) {
  for (let i = 0; i < DAYS_SHOWN; i++) {
    const d = addDays(from, i);
    if (maxDate && d > maxDate) break;
    if (!dayIsOver(rules, d, minMinutes)) return d;
  }
  return from;
}

type Sel = { s: number; e: number }; // minutes from that day's Cairo midnight (can pass 24:00 = after midnight)

// A day calendar like the website's: the court's hours down the side, booked times as grey blocks, holds dashed.
// Tap the time you start and you get the minimum straight away; tap lower to move the finish, higher to move the
// start, or use the − / + buttons. Minimum 1 hour (or the court's minimum), maximum 4 hours.
export function SlotPicker({
  rules, busy, value, onChange, minMinutes, maxDate, onBusyTap, current,
}: {
  rules: Rule[]; busy: Busy[]; value: Pick; onChange: (p: Pick) => void;
  minMinutes: number; maxDate?: string; onBusyTap?: (startIso: string, endIso: string) => void;
  current?: { start: string; end: string } | null; // the booking being changed: drawn green, and its time can be chosen again
}) {
  const s = useS();
  const [now, setNow] = useState(Date.now());
  const [note, setNote] = useState('');
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);

  const MIN = Math.max(STEP, Math.ceil(minMinutes / STEP) * STEP);
  const today = cairoDate();
  const days = useMemo(() => {
    const out: string[] = [];
    for (let i = 0; i < DAYS_SHOWN; i++) {
      const d = addDays(today, i);
      if (maxDate && d > maxDate) break;
      out.push(d);
    }
    return out;
  }, [today, maxDate]);

  // Today is over (or closed)? Start on the next day that can still be booked — once, when the page opens.
  const jumped = useRef(false);
  useEffect(() => {
    if (jumped.current || !rules.length) return;
    jumped.current = true;
    if (value.date !== today || !dayIsOver(rules, today, MIN)) return;
    const next = firstOpenDay(rules, today, MIN, maxDate);
    if (next === today) return;
    setNote(`${hoursFor(rules, today) ? "Today's hours are over" : 'The court is closed today'}, so we're showing ${next === addDays(today, 1) ? 'tomorrow' : dateLabel(`${next}T12:00:00Z`)}.`);
    onChange({ date: next, start: null, duration: 0 });
  }, [rules]); // eslint-disable-line react-hooks/exhaustive-deps

  const date = value.date;
  const hours = hoursFor(rules, date);
  const midnight = cairoToDate(date, 0).getTime();
  const at = (m: number) => midnight + m * 60000;

  const isCurrent = (b: Busy) => !!current && new Date(b.start_time).getTime() === new Date(current.start).getTime() &&
    new Date(b.end_time).getTime() === new Date(current.end).getTime();
  const blocks = busy
    .filter((b) => !(b.state === 'hold' && b.hold_expires_at && new Date(b.hold_expires_at).getTime() <= now) && !isCurrent(b))
    .map((b) => ({
      s: (new Date(b.start_time).getTime() - midnight) / 60000,
      e: (new Date(b.end_time).getTime() - midnight) / 60000,
      hold: b.state === 'hold' && b.hold_expires_at ? new Date(b.hold_expires_at).getTime() : null,
      raw: b,
    }))
    .filter((b) => hours && b.e > hours.open && b.s < hours.close);

  const isOpen = (m: number) => !!hours && m >= hours.open && m + STEP <= hours.close;
  const isPast = (m: number) => at(m) <= now;
  const isFree = (s: number, e: number) => {
    for (let m = s; m < e; m += STEP) if (!isOpen(m) || isPast(m)) return false;
    return !blocks.some((b) => s < b.e && e > b.s);
  };

  const cur = current && hours ? (() => {
    const cs = (new Date(current.start).getTime() - midnight) / 60000;
    const ce = (new Date(current.end).getTime() - midnight) / 60000;
    return ce > hours.open && cs < hours.close ? { s: cs, e: ce } : null;
  })() : null;

  const chosen: Sel | null = value.start !== null && value.duration ? { s: value.start, e: value.start + value.duration } : null;

  const commit = (c: Sel | null) =>
    onChange(c ? { date, start: c.s, duration: c.e - c.s } : { date, start: null, duration: 0 });

  // make a choice follow the rules: minimum, 4 hours at most, nothing booked in between
  function fit(s: number, e: number): Sel | null {
    if (e - s < MIN) {
      if (isFree(s, s + MIN)) e = s + MIN;
      else if (isFree(e - MIN, e)) s = e - MIN;
      else { setNote(`There isn't ${durationText(MIN)} free there. Please pick another time.`); return null; }
    }
    if (e - s > MAX_MIN) { setNote('The longest booking is 4 hours.'); e = s + MAX_MIN; }
    if (!isFree(s, e)) {
      const block = blocks.filter((b) => s < b.e && e > b.s).sort((a, b) => a.s - b.s)[0];
      while (e > s && !isFree(s, e)) e -= STEP;
      const where = block ? `${clock(block.s)} – ${clock(block.e)} is taken` : 'a time in between is not available';
      if (e - s < MIN) { setNote(`${where}. Please pick another start time.`); return null; }
      setNote(`${where}, so your booking ends at ${clock(e)}.`);
    }
    return { s, e };
  }

  //  • nothing chosen yet → this is the START; you get the minimum straight away
  //  • below your booking → moves the FINISH there; above it → moves the START there
  //  • on your booking → nothing happens (so a stray tap never cancels it)
  function tapAt(m: number) {
    setNote('');
    if (!isFree(m, m + STEP)) {
      setNote(!isOpen(m) ? 'The court is closed at that time.' : isPast(m) ? 'That time has passed.' : 'That time is taken.');
      return;
    }
    if (chosen) {
      if (m >= chosen.s && m < chosen.e) {
        setNote('To change your booking, tap above or below it, or use the − / + buttons under the calendar.');
        return;
      }
      if (m >= chosen.e) return commit(fit(chosen.s, m + STEP));
      let st = Math.max(m, chosen.e - MAX_MIN);
      if (st > m) setNote('The longest booking is 4 hours.');
      while (st < chosen.s && !isFree(st, chosen.s)) st += STEP;
      if (st >= chosen.s) { setNote("Something is booked just above, so your booking can't start earlier."); return; }
      return commit({ s: st, e: chosen.e });
    }
    commit(fit(m, m + STEP));
  }

  // the − / + buttons move the start or the finish by 30 minutes
  function canNudge(which: 'start' | 'end', dir: -1 | 1) {
    if (!chosen) return false;
    const ns = which === 'start' ? chosen.s + dir * STEP : chosen.s;
    const ne = which === 'end' ? chosen.e + dir * STEP : chosen.e;
    if (ne - ns < MIN || ne - ns > MAX_MIN) return false;
    if (which === 'start' && dir < 0) return isFree(ns, chosen.s);
    if (which === 'end' && dir > 0) return isFree(chosen.e, ne);
    return true;
  }
  function nudge(which: 'start' | 'end', dir: -1 | 1) {
    if (!chosen || !canNudge(which, dir)) return;
    setNote('');
    commit({ s: which === 'start' ? chosen.s + dir * STEP : chosen.s, e: which === 'end' ? chosen.e + dir * STEP : chosen.e });
  }

  function pickDay(d: string) {
    setNote('');
    onChange({ date: d, start: null, duration: 0 });
  }

  const rows: number[] = [];
  if (hours) for (let m = hours.open; m + STEP <= hours.close; m += STEP) rows.push(m);
  const top = (m: number) => ((m - (hours?.open ?? 0)) / STEP) * ROW;
  const crossesMidnight = !!hours && hours.close > DAY;
  const tab = (d: string, i: number) => ({
    top: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : dateLabel(`${d}T12:00:00Z`).split(' ')[0],
    bottom: dateLabel(`${d}T12:00:00Z`).split(' ').slice(1).join(' '),
  });

  return (
    <View>
      <View style={s.howto}>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Text style={s.rule}>Minimum <Text style={{ fontWeight: '800' }}>{durationText(MIN)}</Text></Text>
          <Text style={s.rule}>Maximum <Text style={{ fontWeight: '800' }}>4 hours</Text></Text>
        </View>
        <Step n={1}><Text style={s.bold}>Pick when you start.</Text> Tap the time on the calendar — you get {durationText(MIN)} straight away.</Step>
        <Step n={2}><Text style={s.bold}>Need longer?</Text> Tap lower to move the <Text style={s.bold}>finish</Text>, tap higher to move the <Text style={s.bold}>start</Text>, or use the − / + buttons under the calendar.</Step>
        {onBusyTap && <Text style={s.howtoText}><Text style={s.bold}>Booked?</Text> Tap it to be told if it frees up.</Text>}
      </View>

      <View style={s.legend}>
        {current && <Legend swatch={<View style={[s.sw, s.swCurrent]} />} label="Your current booking" />}
        <Legend swatch={<View style={[s.sw, { overflow: 'hidden' }]}><GradientFill /></View>} label={current ? 'Your new time' : 'Your booking'} />
        <Legend swatch={<View style={[s.sw, s.swTaken]} />} label="Booked" />
        <Legend swatch={<View style={[s.sw, s.swHold]} />} label="On hold" />
        {crossesMidnight && <Legend swatch={<View style={[s.sw, s.swNight]} />} label="After midnight" />}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }} contentContainerStyle={{ gap: 6 }}>
        {days.map((d, i) => {
          const on = d === date;
          const t = tab(d, i);
          return (
            <Pressable key={d} onPress={() => pickDay(d)} style={[s.dayTab, on && s.dayTabOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
              {on && <GradientFill />}
              <Text style={[s.dayTop, on && { color: '#fff' }]}>{t.top}</Text>
              <Text style={[s.dayBottom, on && { color: 'rgba(255,255,255,0.85)' }]}>{hoursFor(rules, d) ? t.bottom : 'Closed'}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {note ? <View style={s.note}><Text style={s.noteText}>{note}</Text></View> : null}

      {!hours ? (
        <View style={[s.cal, { padding: 24, alignItems: 'center' }]}>
          <Text style={s.muted}>The court is closed on this day.</Text>
        </View>
      ) : (
        <View style={s.cal}>
          <View style={{ flexDirection: 'row' }}>
            <View style={{ width: 64, height: rows.length * ROW }}>
              {rows.filter((m) => m % 60 === 0).map((m) => (
                <Text key={m} style={[s.glabel, { top: Math.max(0, top(m) - 7) }, m === DAY && s.glabelMid]}>
                  {m === DAY ? 'Midnight' : clock(m)}
                </Text>
              ))}
            </View>
            <View style={s.col}>
              {rows.map((m, r) => {
                const past = isPast(m);
                return (
                  <Pressable
                    key={m}
                    onPress={() => tapAt(m)}
                    accessibilityLabel={`${clock(m)} to ${clock(m + STEP)}`}
                    style={({ pressed }) => [
                      s.cell, r % 2 === 1 && s.cellHour, m >= DAY && s.cellNight, past && s.cellPast, pressed && !past && s.cellPressed,
                    ]}
                  />
                );
              })}

              {crossesMidnight && (
                <View pointerEvents="none" style={[s.midline, { top: top(DAY) }]}>
                  <Text style={s.midText}>🌙 {dateLabel(`${addDays(date, 1)}T12:00:00Z`).split(' ')[0]} early morning</Text>
                </View>
              )}

              {blocks.map((b, k) => {
                const bs = Math.max(b.s, hours.open);
                const be = Math.min(b.e, hours.close);
                return (
                  <Pressable
                    key={k}
                    disabled={!onBusyTap}
                    pointerEvents={onBusyTap ? 'auto' : 'none'}
                    onPress={() => onBusyTap?.(b.raw.start_time, b.raw.end_time)}
                    style={[s.ev, b.hold ? s.evHold : s.evTaken, { top: top(bs) + 1, height: ((be - bs) / STEP) * ROW - 3 }]}
                  >
                    <Text style={[s.evText, { color: b.hold ? colors.primary : colors.muted }]} numberOfLines={2}>
                      {b.hold ? `On hold ${countdown(b.hold - now)}` : 'Booked'}{'\n'}{clock(b.s)} – {clock(b.e)}
                    </Text>
                  </Pressable>
                );
              })}

              {cur && (
                <View pointerEvents="none" style={[s.ev, s.evCurrent, { top: top(Math.max(cur.s, hours.open)) + 1, height: ((Math.min(cur.e, hours.close) - Math.max(cur.s, hours.open)) / STEP) * ROW - 3 }]}>
                  <Text style={[s.evText, { color: colors.current, fontWeight: '800' }]}>Your current booking</Text>
                  <Text style={[s.evText, { color: colors.current }]}>{clock(cur.s)} – {clock(cur.e)} · Paid ✓</Text>
                </View>
              )}
              {chosen && (
                <View pointerEvents="none" style={[s.ev, s.evMine, { top: top(chosen.s) + 1, height: ((chosen.e - chosen.s) / STEP) * ROW - 3 }]}>
                  <GradientFill />
                  <Text style={[s.evText, { color: '#fff', fontWeight: '800', fontSize: 13 }]}>{clock(chosen.s)} – {clock(chosen.e)}</Text>
                  <Text style={[s.evText, { color: '#fff' }]}>{durationText(chosen.e - chosen.s)}</Text>
                </View>
              )}
            </View>
          </View>
        </View>
      )}

      <View style={s.yours}>
        {chosen ? (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View style={{ flex: 1 }}>
                <Text style={s.muted}>{current ? 'Your new time' : 'Your booking'}</Text>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16, marginTop: 2 }}>
                  {dateLabel(`${date}T12:00:00Z`)} · {clock(chosen.s)} → {clock(chosen.e)}
                </Text>
                <Text style={s.muted}>
                  {chosen.e > DAY ? `(${dateLabel(`${addDays(date, 1)}T12:00:00Z`).split(' ')[0]} early morning) · ` : ''}{durationText(chosen.e - chosen.s)}
                </Text>
              </View>
              <Pressable onPress={() => { setNote(''); commit(null); }} hitSlop={10}>
                <Text style={{ color: colors.muted, textDecorationLine: 'underline', fontSize: 13 }}>Clear</Text>
              </Pressable>
            </View>
            {([['start', 'Starts', chosen.s], ['end', 'Finishes', chosen.e]] as const).map(([which, label, m]) => (
              <View key={which} style={s.stepper}>
                <Text style={s.stepLabel}>{label}</Text>
                <Pressable style={[s.step, !canNudge(which, -1) && { opacity: 0.3 }]} disabled={!canNudge(which, -1)} onPress={() => nudge(which, -1)}
                  accessibilityLabel={`${label === 'Starts' ? 'Start' : 'Finish'} 30 minutes earlier`}>
                  <Text style={s.stepText}>−</Text>
                </Pressable>
                <Text style={s.stepTime}>{clock(m)}</Text>
                <Pressable style={[s.step, !canNudge(which, 1) && { opacity: 0.3 }]} disabled={!canNudge(which, 1)} onPress={() => nudge(which, 1)}
                  accessibilityLabel={`${label === 'Starts' ? 'Start' : 'Finish'} 30 minutes later`}>
                  <Text style={s.stepText}>+</Text>
                </Pressable>
              </View>
            ))}
            <Text style={[s.muted, { fontSize: 12, marginTop: 8 }]}>− / + move the time by 30 minutes. Minimum {durationText(MIN)}, maximum 4 hours.</Text>
          </>
        ) : (
          <Text style={{ color: colors.text }}>
            <Text style={s.bold}>Step 1:</Text> tap the time you want to start on the calendar.{' '}
            <Text style={s.muted}>You get {durationText(MIN)} straight away and can make it longer.</Text>
          </Text>
        )}
      </View>
    </View>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  const s = useS();
  return (
    <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
      <View style={s.num}><GradientFill /><Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>{n}</Text></View>
      <Text style={[s.howtoText, { flex: 1 }]}>{children}</Text>
    </View>
  );
}

function Legend({ swatch, label }: { swatch: React.ReactNode; label: string }) {
  useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
      {swatch}
      <Text style={{ color: colors.muted, fontSize: 12 }}>{label}</Text>
    </View>
  );
}

const useS = themed(() => StyleSheet.create({
  howto: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 12, gap: 10, marginBottom: 12 },
  howtoText: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  bold: { color: colors.text, fontWeight: '700' },
  rule: { backgroundColor: colors.soft, color: colors.primary, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, fontSize: 12, fontWeight: '600', overflow: 'hidden' },
  num: { width: 22, height: 22, borderRadius: 11, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', marginTop: 1 },

  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginBottom: 12 },
  sw: { width: 12, height: 12, borderRadius: 3 },
  swTaken: { backgroundColor: colors.taken, borderWidth: 1, borderColor: colors.borderStrong },
  swHold: { backgroundColor: colors.hold, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.primary },
  swCurrent: { backgroundColor: 'rgba(16,185,129,0.2)', borderWidth: 2, borderColor: colors.current },
  swNight: { backgroundColor: colors.night, borderWidth: 1, borderColor: colors.borderStrong },

  dayTab: { borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.card, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6, alignItems: 'center', overflow: 'hidden' },
  dayTabOn: { borderColor: 'transparent' },
  dayTop: { color: colors.text, fontWeight: '700', fontSize: 13 },
  dayBottom: { color: colors.muted, fontWeight: '600', fontSize: 11, marginTop: 1 },

  note: { backgroundColor: colors.noteBg, borderWidth: 1, borderColor: colors.noteBorder, borderRadius: radius.md, padding: 10, marginBottom: 12 },
  noteText: { color: colors.noteText, fontSize: 13 },

  cal: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: 'hidden' },
  glabel: { position: 'absolute', right: 8, fontSize: 11, color: colors.muted },
  glabelMid: { color: colors.primary, fontWeight: '700' },
  col: { flex: 1, borderLeftWidth: 1, borderLeftColor: colors.border },
  cell: { height: ROW, borderBottomWidth: 1, borderBottomColor: colors.border },
  cellHour: { borderBottomColor: colors.borderStrong },
  cellNight: { backgroundColor: colors.night },
  cellPast: { backgroundColor: colors.past },
  cellPressed: { backgroundColor: colors.soft },
  midline: { position: 'absolute', left: 0, right: 0, borderTopWidth: 2, borderStyle: 'dashed', borderTopColor: colors.primary },
  midText: { position: 'absolute', right: 4, top: -9, fontSize: 10, fontWeight: '700', color: colors.primary, backgroundColor: colors.card, paddingHorizontal: 4 },

  ev: { position: 'absolute', left: 3, right: 3, borderRadius: 7, paddingHorizontal: 6, paddingVertical: 3, overflow: 'hidden' },
  evTaken: { backgroundColor: colors.taken, borderLeftWidth: 3, borderLeftColor: colors.borderStrong },
  evHold: { backgroundColor: colors.hold, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.primary },
  evMine: { justifyContent: 'center' },
  evCurrent: { backgroundColor: 'rgba(16,185,129,0.14)', borderWidth: 2, borderColor: colors.current, justifyContent: 'center' },
  evText: { fontSize: 11, lineHeight: 14 },

  yours: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: 14, marginTop: 12 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  stepLabel: { width: 70, color: colors.muted, fontWeight: '600', fontSize: 13 },
  step: { width: 44, height: 44, borderRadius: 12, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.cardAlt, alignItems: 'center', justifyContent: 'center' },
  stepText: { color: colors.text, fontSize: 22, fontWeight: '700' },
  stepTime: { minWidth: 84, textAlign: 'center', color: colors.text, fontWeight: '700', fontSize: 15 },
  muted: { color: colors.muted, fontSize: 13 },
}));
