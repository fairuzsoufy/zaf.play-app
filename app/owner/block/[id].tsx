import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { Text } from '@/components/AppText';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { canOnBranch } from '@/lib/access';
import { addDays, cairoDate, cairoToDate, durationText, hm12, weekdayOf } from '@/lib/format';
import { useT } from '@/lib/ownerLang';
import { colors, radius } from '@/lib/theme';
import { Box, Chip, H2, LinkButton, Loading, Muted, useOwner } from '@/components/owner';
import { Check, HalfHourPicker } from '@/components/ownerCourts';
import { Button, Field, Note } from '@/components/ui';

const SLOT = 30;
const DAY = 24 * 60;
const DAYS_SHOWN = 7;
const FREEZE_DAYS = 32;
const toMin = (x: string) => Number(x.slice(0, 2)) * 60 + Number(x.slice(3, 5) || 0);
const hhmm = (m: number) => `${String(Math.floor((m % DAY) / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

type Row = { id: string; start_time: string; end_time: string; booking_source: string | null };

// Block slots: tap free half hours on a day, then block them; tap a blocked time to open it again.
// Freeze: close the court for a whole time range, keeping or cancelling the bookings already made.
// Like the website's /owner/courts/[id]/block.
export default function BlockSlots() {
  const { id: courtId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { access } = useOwner();
  const { t, tm, lang, locale } = useT();
  const [court, setCourt] = useState<any>(undefined);
  const [bookings, setBookings] = useState<Row[]>([]);
  const [rules, setRules] = useState<any[]>([]);
  const [date, setDate] = useState(cairoDate());
  const [picked, setPicked] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [now, setNow] = useState(Date.now());

  const [showFreeze, setShowFreeze] = useState(false);
  const [fFromDate, setFFromDate] = useState(cairoDate());
  const [fFromTime, setFFromTime] = useState('00:00');
  const [fToDate, setFToDate] = useState(cairoDate(1));
  const [fToTime, setFToTime] = useState('00:00');
  const [fCancel, setFCancel] = useState(false);
  const [fReason, setFReason] = useState('');
  const [freezeMsg, setFreezeMsg] = useState('');

  // "1 hour 30 min" in the chosen language
  const dur = (min: number) => {
    if (lang !== 'ar') return durationText(min);
    const h = Math.floor(min / 60);
    const m = min % 60;
    return [h ? `${h} ${h === 1 ? 'ساعة' : 'ساعات'}` : '', m ? `${m} دقيقة` : ''].filter(Boolean).join(' و');
  };

  const load = useCallback(async () => {
    const { data: c } = await supabase.from('courts').select('id, name, facility:facilities(id, owner_id)').eq('id', courtId).maybeSingle();
    if (!c || !canOnBranch(access, (c as any).facility, 'manage_bookings')) return setCourt(null);
    const [b, r] = await Promise.all([
      supabase.from('bookings').select('id, start_time, end_time, status, booking_source').eq('court_id', courtId).in('status', ['pending', 'confirmed'])
        .gte('end_time', new Date().toISOString()).order('start_time', { ascending: true }),
      supabase.from('availability_rules').select('day_of_week, open_time, close_time, is_closed').eq('court_id', courtId),
    ]);
    setBookings((b.data as Row[]) || []);
    setRules((r.data as any[]) || []);
    setNow(Date.now());
    setCourt(c);
  }, [courtId, access]);
  useEffect(() => { load(); }, [load]);

  const today = cairoDate();
  const dates = Array.from({ length: DAYS_SHOWN }, (_, i) => addDays(today, i));

  function hoursFor(d: string) {
    const rule = rules.find((r) => r.day_of_week === weekdayOf(d));
    if (!rule || rule.is_closed) return null;
    const open = toMin(rule.open_time);
    let close = toMin(rule.close_time);
    if (close <= open) close += DAY; // closes after midnight
    return { open, close };
  }
  const hours = hoursFor(date);
  const midnight = cairoToDate(date, 0).getTime();
  const at = (m: number) => cairoToDate(date, m);
  const minsOf = (iso: string) => (new Date(iso).getTime() - midnight) / 60000;
  const hm = (m: number) => tm(hm12(hhmm(m)));
  const busyAt = (m: number) => bookings.find((b) => m < minsOf(b.end_time) && m + SLOT > minsOf(b.start_time));

  const starts: number[] = [];
  if (hours) for (let m = hours.open; m + SLOT <= hours.close; m += SLOT) if (at(m).getTime() > now) starts.push(m);
  const parts = [
    { label: 'Morning', from: 0, to: 12 * 60 },
    { label: 'Afternoon', from: 12 * 60, to: 17 * 60 },
    { label: 'Evening', from: 17 * 60, to: DAY },
    { label: 'After midnight', from: DAY, to: 2 * DAY },
  ].map((p) => ({ ...p, times: starts.filter((m) => m >= p.from && m < p.to) })).filter((p) => p.times.length > 0);
  const dayBlocks = bookings.filter((b) => b.booking_source === 'owner_block' && starts.some((m) => busyAt(m)?.id === b.id));

  function pickDay(d: string) {
    setDate(d);
    setPicked([]);
    setMsg(null);
  }
  const toggle = (m: number) => { setMsg(null); setPicked((p) => (p.includes(m) ? p.filter((x) => x !== m) : [...p, m].sort((a, b) => a - b))); };

  async function block() {
    setMsg(null);
    if (picked.length === 0) return setMsg({ kind: 'error', text: t('Tap the times you want to block first.') });
    setSaving(true);
    const { data: s } = await supabase.auth.getSession();
    // one row per half hour, so each can be opened again on its own later
    const rows = picked.map((m) => ({
      user_id: s.session?.user.id, court_id: courtId, start_time: at(m).toISOString(), end_time: at(m + SLOT).toISOString(),
      total_price: 0, commission_rate_applied: 0, commission_amount: 0, owner_net_amount: 0, status: 'confirmed', payment_status: 'paid', booking_source: 'owner_block',
    }));
    const { error } = await supabase.from('bookings').insert(rows);
    setSaving(false);
    if (error) {
      setMsg({ kind: 'error', text: error.message.includes('no_overlap') || error.message.includes('exclu') ? `❌ ${t('One of these times was just booked. Please pick again.')}` : `❌ ${error.message}` });
      return load();
    }
    setMsg({ kind: 'ok', text: `✅ ${t('Blocked {what}.', { what: picked.length === 1 ? hm(picked[0]) : t('{n} times ({d})', { n: picked.length, d: dur(picked.length * SLOT) }) })}` });
    setPicked([]);
    load();
  }

  async function unblock(ids: string[], label: string) {
    setMsg(null);
    const { error } = await supabase.from('bookings').delete().in('id', ids).eq('booking_source', 'owner_block');
    if (error) return setMsg({ kind: 'error', text: `❌ ${error.message}` });
    setMsg({ kind: 'ok', text: `✅ ${t('{what} is open for players again.', { what: label })}` });
    load();
  }

  function freeze() {
    setFreezeMsg('');
    const from = cairoToDate(fFromDate, toMin(fFromTime));
    const to = cairoToDate(fToDate, toMin(fToTime));
    if (!(to > from)) return setFreezeMsg(`❌ ${t('The end must be after the start.')}`);
    const fmt = (d: Date) => d.toLocaleString(locale, { timeZone: 'Africa/Cairo', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    const range = t('{from} to {to}', { from: fmt(from), to: fmt(to) });
    const what = fCancel
      ? t('Bookings in this time will be cancelled and each player gets a full refund (the InstaPay fee for refunding is on you, as with any booking you cancel).')
      : t('Bookings already made in this time stay as they are; only the free times are blocked.');
    Alert.alert(t('Freeze the court'), `${t('Freeze {court} from {range}?', { court: court?.name, range })}\n\n${what}`, [
      { text: t('Cancel'), style: 'cancel' },
      {
        text: t('Freeze the court'), style: 'destructive', onPress: async () => {
          setSaving(true);
          const { data, error } = await supabase.rpc('owner_freeze_court', {
            p_court_id: courtId, p_from: from.toISOString(), p_to: to.toISOString(), p_cancel: fCancel, p_reason: fReason.trim() || null,
          });
          setSaving(false);
          if (error) return setFreezeMsg(`❌ ${error.message}`);
          const r = (data || {}) as { blocked?: number; cancelled?: number; kept?: number };
          setFreezeMsg(
            `✅ ${t('Frozen from {range}. {d} blocked', { range, d: dur((r.blocked || 0) * SLOT) })}`
            + (r.cancelled ? `، ${t('{n} booking(s) cancelled with a full refund', { n: r.cancelled })}` : '')
            + (r.kept ? `، ${t('{n} booking(s) kept', { n: r.kept })}` : '')
            + `. ${t('To open a time again, tap it in the calendar above.')}`,
          );
          load();
        },
      },
    ]);
  }

  if (court === undefined) return <Loading />;
  if (court === null) return <View style={{ padding: 16 }}><Muted>{t("You don't have access to this court.")}</Muted><LinkButton title={t('Back')} onPress={() => router.back()} /></View>;

  const dayLabel = (d: string, i: number) => (i === 0 ? t('Today') : new Date(`${d}T12:00:00Z`).toLocaleDateString(locale, { timeZone: 'UTC', weekday: 'short' }).toUpperCase());
  const freezeDates = Array.from({ length: FREEZE_DAYS }, (_, i) => addDays(today, i));
  const DatePick = ({ value, onChange, min }: { value: string; onChange: (d: string) => void; min: string }) => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 6 }}>
      {freezeDates.filter((d) => d >= min).map((d) => (
        <Chip key={d} on={d === value} onPress={() => onChange(d)} label={new Date(`${d}T12:00:00Z`).toLocaleDateString(locale, { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' })} />
      ))}
    </ScrollView>
  );

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <H2>{t('Block slots:')} {court.name}</H2>

      <Text style={{ color: colors.text, fontWeight: '700', marginBottom: 6 }}>{t('Pick a date')}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
        {dates.map((d, i) => (
          <Pressable key={d} onPress={() => pickDay(d)} style={{ width: 62, paddingVertical: 8, marginRight: 8, borderRadius: radius.md, alignItems: 'center',
            borderWidth: 1, borderColor: d === date ? colors.primary : colors.border, backgroundColor: d === date ? colors.primary : colors.card }}>
            <Text style={{ color: d === date ? '#fff' : colors.muted, fontSize: 11 }}>{dayLabel(d, i)}</Text>
            <Text style={{ color: d === date ? '#fff' : colors.text, fontWeight: '800', fontSize: 18 }}>{Number(d.slice(8))}</Text>
            {!hoursFor(d) && <Text style={{ color: d === date ? '#fff' : colors.muted, fontSize: 10 }}>{t('Closed')}</Text>}
          </Pressable>
        ))}
      </ScrollView>

      <Text style={{ color: colors.text, fontWeight: '700' }}>{t('Pick the times to block')}</Text>
      <Muted style={{ fontSize: 12, marginBottom: 8 }}>{t('Each time is 30 minutes. Tap as many as you like, then press Block. Tap a blocked time to open it again. Struck-through times are booked by players.')}</Muted>
      {!hours ? <Box tone="warn"><Text style={{ color: colors.noteText }}>{t('The court is closed on this day.')}</Text></Box>
        : parts.length === 0 ? <Box tone="warn"><Text style={{ color: colors.noteText }}>{t('No times left on this day.')}</Text></Box>
        : parts.map((part) => (
          <View key={part.label} style={{ marginBottom: 10 }}>
            <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', letterSpacing: 1.2, marginBottom: 6 }}>{t(part.label).toUpperCase()}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {part.times.map((m) => {
                const b = busyAt(m);
                const mine = picked.includes(m);
                const blocked = b?.booking_source === 'owner_block';
                return (
                  <Pressable key={m} disabled={!!b && !blocked} onPress={() => (blocked ? unblock([b!.id], hm(minsOf(b!.start_time))) : toggle(m))}
                    style={{ width: '31%', paddingVertical: 8, borderRadius: radius.md, alignItems: 'center', borderWidth: 1,
                      borderColor: mine ? colors.primary : colors.border, backgroundColor: mine ? colors.primary : blocked ? colors.cardAlt : colors.card, opacity: b && !blocked ? 0.5 : 1 }}>
                    <Text style={{ color: mine ? '#fff' : colors.text, fontWeight: '700', textDecorationLine: b && !blocked ? 'line-through' : 'none' }}>{hm(m)}</Text>
                    {blocked ? <Text style={{ color: colors.muted, fontSize: 10 }}>🔒 {t('Blocked')}</Text>
                      : b ? <Text style={{ color: colors.muted, fontSize: 10 }}>{t('Booked')}</Text>
                      : m >= DAY ? <Text style={{ color: mine ? '#fff' : colors.muted, fontSize: 10 }}>🌙 {t('After midnight')}</Text> : null}
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}

      {picked.length > 0 && (
        <Box>
          <Muted style={{ fontSize: 12 }}>{t('To block')}</Muted>
          <Text style={{ color: colors.text, fontWeight: '800' }}>{picked.map(hm).join(', ')} <Text style={{ color: colors.muted, fontWeight: '400' }}>· {dur(picked.length * SLOT)}</Text></Text>
          <LinkButton title={t('Clear')} onPress={() => setPicked([])} />
        </Box>
      )}
      {msg && <Note kind={msg.kind}>{msg.text}</Note>}
      <Button title={saving ? t('Blocking...') : picked.length ? t('Block {length}', { length: dur(picked.length * SLOT) }) : t('Block')} onPress={block} disabled={picked.length === 0 || saving} />
      {dayBlocks.length > 0 && (
        <LinkButton title={t('Open every time I blocked on this day ({d})', { d: dur(dayBlocks.length * SLOT) })}
          onPress={() => unblock(dayBlocks.map((b) => b.id), t('Every time you blocked on this day'))} />
      )}

      <Box style={{ marginTop: 20 }}>
        <Pressable onPress={() => setShowFreeze(!showFreeze)} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontWeight: '800' }}>❄️ {t('Freeze this court for a time range')}</Text>
            <Muted style={{ fontSize: 12 }}>{t('For maintenance, a holiday or a private event: close it for hours or days at once.')}</Muted>
          </View>
          <Text style={{ color: colors.muted }}>{showFreeze ? '▲' : '▼'}</Text>
        </Pressable>
        {showFreeze && (
          <View style={{ marginTop: 10 }}>
            <Text style={{ color: colors.text, fontWeight: '700' }}>{t('From')}</Text>
            <DatePick value={fFromDate} min={today} onChange={(d) => { setFFromDate(d); if (fToDate < d) setFToDate(d); }} />
            <HalfHourPicker label={t('Time')} value={fFromTime} onChange={setFFromTime} />
            <Text style={{ color: colors.text, fontWeight: '700', marginTop: 6 }}>{t('Until')}</Text>
            <DatePick value={fToDate} min={fFromDate} onChange={setFToDate} />
            <HalfHourPicker label={t('Time')} value={fToTime} onChange={setFToTime} />
            <Text style={{ color: colors.text, fontWeight: '700', marginTop: 8 }}>{t('Bookings players already made in this time')}</Text>
            <Check on={!fCancel} onPress={() => setFCancel(false)} title={t('Keep them')} help={t(', block the rest. Those players play as booked, and can still change or cancel their booking under the usual rules.')} />
            <Check on={fCancel} onPress={() => setFCancel(true)} title={t('Cancel them')} help={t('and block everything. Each player is emailed and gets a full refund, as Zaf Play credit or by InstaPay. The InstaPay fee for each refund is on you, as with any booking you cancel.')} />
            <Field label={t('Reason (players see it if their booking is cancelled)')} value={fReason} onChangeText={setFReason} maxLength={200} placeholder={t('e.g. Maintenance')} />
            <Button title={saving ? t('Freezing...') : t('Freeze the court')} onPress={freeze} loading={saving} />
            <Muted style={{ fontSize: 12, marginTop: 6 }}>{t('Up to 31 days at a time. To open part of it again, tap those times in the calendar above.')}</Muted>
            {!!freezeMsg && <Text style={{ color: colors.text, marginTop: 8 }}>{freezeMsg}</Text>}
          </View>
        )}
      </Box>
    </ScrollView>
  );
}
