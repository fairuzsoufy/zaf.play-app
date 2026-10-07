import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { colors, radius } from '@/lib/theme';
import { cairoDate, cairoToDate, dateLabel, durationText, egp, timeLabel } from '@/lib/format';
import { FREE_CHANGE_HOURS, HOLD_MINUTES, INSTAPAY_FEE_TEXT, instapayFee, isLate, rescheduleCredit } from '@/lib/payment';
import { Button, Note } from '@/components/ui';
import { Busy, Pick, Rule, SlotPicker } from '@/components/SlotPicker';

// Change the time or the extras of a paid booking (reschedule_booking in the database does the work).
export default function ChangeBooking() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { session, loading: authLoading } = useAuth();
  const [b, setB] = useState<any>(null);
  const [price, setPrice] = useState(0);
  const [rules, setRules] = useState<Rule[]>([]);
  const [busy, setBusy] = useState<Busy[]>([]);
  const [extras, setExtras] = useState<any[]>([]);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [pick, setPick] = useState<Pick>({ date: cairoDate(), start: null, duration: 0 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const loadBusy = useCallback(async (courtId: string) => {
    const { data } = await supabase.rpc('court_busy_slots', { p_court_id: courtId });
    setBusy((data ?? []) as Busy[]);
  }, []);

  useEffect(() => {
    if (!session) { setLoading(false); return; }
    (async () => {
      const { data } = await supabase.from('bookings')
        .select(`id,court_id,sport_id,start_time,end_time,status,payment_status,total_price,
          booking_extras(extra_id,name,unit_price,qty,amount), sport:sports(name),
          court:courts(id,name,is_indoor,late_fee_percent,min_booking_minutes,bookable_until,court_sports(sport_id,price_per_hour))`)
        .eq('id', id).single();
      const bk = data as any;
      if (!bk) { setLoading(false); return; }
      const [r, e] = await Promise.all([
        supabase.from('availability_rules').select('day_of_week,open_time,close_time,is_closed').eq('court_id', bk.court_id),
        supabase.from('court_extras').select('id,name,price,max_qty,is_required,sport_id').eq('court_id', bk.court_id).eq('status', 'approved').eq('is_active', true),
      ]);
      const offered = ((e.data ?? []) as any[]).filter((x) => !x.is_required && (!x.sport_id || x.sport_id === bk.sport_id));
      setExtras(offered);
      setQty(Object.fromEntries(offered.map((x) => [x.id, Number((bk.booking_extras ?? []).find((y: any) => y.extra_id === x.id)?.qty || 0)])));
      setPrice(Number((bk.court?.court_sports ?? []).find((x: any) => x.sport_id === bk.sport_id)?.price_per_hour || 0));
      setRules((r.data ?? []) as Rule[]);
      setB(bk);
      await loadBusy(bk.court_id);
      setPick({ date: new Date(bk.start_time).toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' }), start: null, duration: 0 });
      setLoading(false);
    })();
  }, [id, session, loadBusy]);

  if (authLoading || loading) return <ActivityIndicator style={{ marginTop: 60 }} color={colors.primary} />;
  if (!session) return <Text style={s.msg}>Please log in to change a booking.</Text>;
  if (!b) return <Text style={s.msg}>Booking not found.</Text>;

  const canChange = ['pending', 'confirmed'].includes(b.status) && b.payment_status === 'paid' && new Date(b.start_time).getTime() > Date.now();
  const fee = Number(b.court?.late_fee_percent ?? 50);
  const late = isLate(b.start_time);
  const paid = Number(b.total_price);
  const lastDay = b.court?.bookable_until
    ? new Date(new Date(b.court.bookable_until).getTime() - 60000).toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' }) : undefined;
  const minMinutes = Math.max(60, Number(b.court?.min_booking_minutes || 0));

  const have = (xid: string) => (b.booking_extras ?? []).find((x: any) => x.extra_id === xid);
  const unitPrice = (x: any) => Number(have(x.id)?.unit_price ?? x.price);
  const extrasNow = (b.booking_extras ?? []).reduce((a: number, x: any) => a + Number(x.amount), 0);
  const offeredIds = new Set(extras.map((x) => x.id));
  const newExtras = extras.reduce((a, x) => a + unitPrice(x) * (qty[x.id] || 0), 0)
    + (b.booking_extras ?? []).filter((x: any) => !offeredIds.has(x.extra_id)).reduce((a: number, x: any) => a + Number(x.amount), 0);
  const extrasChanged = extras.some((x) => (qty[x.id] || 0) !== Number(have(x.id)?.qty || 0));

  const oldS = new Date(b.start_time).getTime();
  const oldE = new Date(b.end_time).getTime();
  const newS = pick.start !== null ? cairoToDate(pick.date, pick.start).getTime() : 0;
  const newE = newS + pick.duration * 60000;
  const kind: 'none' | 'same' | 'extend' | 'move' = pick.start === null
    ? (extrasChanged ? 'same' : 'none')
    : newS === oldS && newE === oldE ? 'same' : newS <= oldS && newE >= oldE ? 'extend' : 'move';
  const addBefore = kind === 'extend' ? (oldS - newS) / 60000 : 0;
  const addAfter = kind === 'extend' ? (newE - oldE) / 60000 : 0;
  const keep = kind === 'extend' || kind === 'same';
  const credit = keep ? paid : rescheduleCredit(paid, fee, late);
  const extrasDiff = newExtras - extrasNow;
  const newTotal = keep
    ? Math.round((paid + extrasDiff + price * ((addBefore + addAfter) / 60)) * 100) / 100
    : Math.round((price * (pick.duration / 60) + newExtras) * 100) / 100;
  const due = kind === 'none' ? 0 : Math.round((newTotal - credit) * 100) / 100;
  const changing = kind === 'extend' || kind === 'move' || (kind === 'same' && extrasChanged);

  async function submit() {
    setErr(null);
    if (!changing) return setErr('Nothing changed yet. Pick a new time or change your extras.');
    setSaving(true);
    const start = pick.start !== null ? cairoToDate(pick.date, pick.start) : new Date(b.start_time);
    const end = pick.start !== null ? new Date(start.getTime() + pick.duration * 60000) : new Date(b.end_time);
    const { data, error } = await supabase.rpc('reschedule_booking', {
      p_booking_id: id, p_new_start: start.toISOString(), p_new_end: end.toISOString(),
      p_extras: Object.entries(qty).map(([extra_id, n]) => ({ extra_id, qty: n })),
    });
    setSaving(false);
    if (error) { setErr(error.message); loadBusy(b.court_id); return; }
    const d = data as any;
    if (Number(d.amount_due) > 0) return router.replace({ pathname: '/pay/[id]', params: { id: d.new_booking_id } });
    const refund = Number(d.refund || 0);
    Alert.alert('Booking changed', refund > 0 ? `Your booking was changed. A refund of ${egp(refund)} is on its way.` : 'Your booking was changed.');
    router.replace('/(tabs)/bookings');
  }

  const when = `${dateLabel(b.start_time)} · ${timeLabel(b.start_time)} – ${timeLabel(b.end_time)}`;

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <Stack.Screen options={{ title: 'Modify booking' }} />
      <Text style={s.h1}>{b.court?.name}</Text>
      <Text style={s.sub}>{b.sport?.name} · {b.court?.is_indoor ? 'Indoor' : 'Outdoor'}</Text>
      <Text style={{ color: colors.text, marginTop: 8, marginBottom: 14 }}>Current: <Text style={{ fontWeight: '700' }}>{when}</Text> · paid {egp(paid)}</Text>

      {!canChange ? (
        <Note kind="error">This booking can't be changed (only paid, upcoming bookings can).</Note>
      ) : (
        <>
          {keep || kind === 'none' ? (
            <Note kind="ok">✅ Everything you paid ({egp(paid)}) still counts. Add time or extras and you only pay the difference.</Note>
          ) : late ? (
            <Note kind="error">⚠️ Your game starts in less than {FREE_CHANGE_HOURS} hours, so {fee}% of what you paid ({egp(paid - credit)}) is kept as a fee. {egp(credit)} counts toward the new time.</Note>
          ) : (
            <Note kind="ok">✅ Free change. The full {egp(paid)} you paid counts toward the new time.</Note>
          )}

          <SlotPicker
            rules={rules} busy={busy} value={pick} minMinutes={minMinutes} maxDate={lastDay}
            ignore={{ start: b.start_time, end: b.end_time }} current={{ start: b.start_time, end: b.end_time }}
            onChange={(p) => { setPick(p); setErr(null); }}
          />

          {extras.length > 0 && (
            <View style={s.card}>
              <Text style={s.cardTitle}>Extras</Text>
              {extras.map((x) => {
                const n = qty[x.id] || 0;
                return (
                  <View key={x.id} style={s.extraRow}>
                    <Text style={{ color: colors.text, flex: 1 }}>{x.name} <Text style={{ color: colors.muted }}>· {egp(unitPrice(x))}</Text></Text>
                    <Pressable disabled={n === 0} onPress={() => setQty({ ...qty, [x.id]: n - 1 })} style={[s.step, n === 0 && { opacity: 0.3 }]}><Text style={s.stepText}>−</Text></Pressable>
                    <Text style={{ color: colors.text, width: 28, textAlign: 'center' }}>{n}</Text>
                    <Pressable disabled={n >= x.max_qty} onPress={() => setQty({ ...qty, [x.id]: n + 1 })} style={[s.step, n >= x.max_qty && { opacity: 0.3 }]}><Text style={s.stepText}>+</Text></Pressable>
                  </View>
                );
              })}
            </View>
          )}

          <View style={s.card}>
            {kind === 'none' ? (
              <Text style={{ color: colors.muted }}>Your current booking is the green block. Choose a new time, tap around it to add time, or change your extras.</Text>
            ) : kind === 'same' && !extrasChanged ? (
              <Text style={{ color: colors.warning }}>This is the time you already have. Pick a different time, add time before or after it, or change your extras.</Text>
            ) : (
              <>
                {keep ? (
                  <>
                    {kind === 'extend' && <Text style={s.cardTitle}>Adding {[addBefore && `${durationText(addBefore)} before`, addAfter && `${durationText(addAfter)} after`].filter(Boolean).join(' and ')}</Text>}
                    {kind === 'extend' && <Line l="Extra time" r={egp(due - extrasDiff)} />}
                    {extrasChanged && <Line l="Extras" r={extrasDiff < 0 ? `− ${egp(-extrasDiff)}` : `+ ${egp(extrasDiff)}`} />}
                  </>
                ) : (
                  <>
                    <Line l={`New time${newExtras > 0 ? ' (with your extras)' : ''}`} r={egp(newTotal)} />
                    <Line l="Carried over" r={`− ${egp(credit)}`} />
                  </>
                )}
                <View style={s.totalRow}>
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 17 }}>
                    {due > 0 ? `To pay by InstaPay: ${egp(due)}` : due < 0 ? `We refund you: ${egp(-due - instapayFee(-due))}` : 'Nothing to pay'}
                  </Text>
                </View>
                {due < 0 && <Text style={s.small}>{egp(-due)} minus InstaPay's transfer fee ({INSTAPAY_FEE_TEXT}): {egp(instapayFee(-due))}</Text>}
                {due > 0 && <Text style={s.small}>Your current booking stays until the extra payment is approved. The new time is held for {HOLD_MINUTES} minutes.</Text>}
              </>
            )}
          </View>

          {err && <Note kind="error">{err}</Note>}
          <Button
            title={saving ? 'Saving...' : due > 0 ? (kind === 'extend' ? 'Pay the difference →' : 'Continue to payment →') : 'Confirm changes'}
            onPress={submit} loading={saving} disabled={!changing}
          />
        </>
      )}
    </ScrollView>
  );
}

function Line({ l, r }: { l: string; r: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
      <Text style={{ color: colors.muted }}>{l}</Text>
      <Text style={{ color: colors.text }}>{r}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  msg: { color: colors.muted, textAlign: 'center', margin: 40 },
  h1: { color: colors.text, fontSize: 22, fontWeight: '800' },
  sub: { color: colors.muted, marginTop: 4 },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: 14, borderWidth: 1, borderColor: colors.border, marginTop: 14, marginBottom: 4 },
  cardTitle: { color: colors.text, fontWeight: '700', marginBottom: 6 },
  extraRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  step: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  stepText: { color: colors.text, fontSize: 20, fontWeight: '700', marginTop: -2 },
  totalRow: { borderTopWidth: 1, borderTopColor: colors.border, marginTop: 10, paddingTop: 10 },
  small: { color: colors.muted, fontSize: 12, marginTop: 6 },
});
