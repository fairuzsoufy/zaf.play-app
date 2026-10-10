import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { colors, radius, themed } from '@/lib/theme';
import { cairoToDate, dateLabel, durationText, egp, timeLabel } from '@/lib/format';
import { FREE_CHANGE_HOURS, HOLD_MINUTES, INSTAPAY_FEE_TEXT, instapayFee, isLate, rescheduleCredit } from '@/lib/payment';
import { Button, Note } from '@/components/ui';
import { toast } from '@/components/Toast';
import { Busy, Pick, Rule, SlotPicker } from '@/components/SlotPicker';

// Modify a paid, upcoming booking: a new time (or more time around it) and/or different extras.
// Same rules and maths as the website's /bookings/[id]/change page; the database does the real work (reschedule_booking).
export default function ChangeBooking() {
  const st = useSt();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { session } = useAuth();
  const [b, setB] = useState<any>(null);
  const [price, setPrice] = useState(0);
  const [rules, setRules] = useState<Rule[]>([]);
  const [busy, setBusy] = useState<Busy[]>([]);
  const [extras, setExtras] = useState<any[]>([]);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [pick, setPick] = useState<Pick>({ date: '', start: null, duration: 0 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const loadBusy = useCallback(async (courtId: string) => {
    const { data } = await supabase.rpc('court_busy_slots', { p_court_id: courtId });
    setBusy((data ?? []) as Busy[]);
  }, []);

  useEffect(() => {
    if (!session) return;
    (async () => {
      const { data } = await supabase
        .from('bookings')
        .select(`id,court_id,sport_id,start_time,end_time,status,payment_status,total_price,
          booking_extras(extra_id,name,unit_price,qty,amount),sport:sports(name),
          court:courts(id,name,is_indoor,late_fee_percent,min_booking_minutes,bookable_until,court_sports(sport_id,price_per_hour))`)
        .eq('id', id).maybeSingle();
      const bk = data as any;
      if (!bk) { setLoading(false); return; }
      const [r, ex] = await Promise.all([
        supabase.from('availability_rules').select('day_of_week,open_time,close_time,is_closed').eq('court_id', bk.court_id),
        supabase.from('court_extras').select('id,name,price,max_qty,is_required,sport_id').eq('court_id', bk.court_id)
          .eq('status', 'approved').eq('is_active', true).order('name'),
      ]);
      const offered = ((ex.data ?? []) as any[]).filter((e) => !e.is_required && (!e.sport_id || e.sport_id === bk.sport_id));
      const q: Record<string, number> = {};
      for (const e of offered) q[e.id] = Number((bk.booking_extras ?? []).find((x: any) => x.extra_id === e.id)?.qty || 0);
      setExtras(offered);
      setQty(q);
      setPrice(Number((bk.court?.court_sports ?? []).find((x: any) => x.sport_id === bk.sport_id)?.price_per_hour || 0));
      setRules((r.data ?? []) as Rule[]);
      setB(bk);
      setPick({ date: new Date(bk.start_time).toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' }), start: null, duration: 0 });
      await loadBusy(bk.court_id);
      setLoading(false);
    })();
  }, [id, session, loadBusy]);

  if (!session) return <Text style={st.center}>Please log in to change your booking.</Text>;
  if (loading) return <ActivityIndicator style={{ marginTop: 60 }} color={colors.brandPurple} />;
  if (!b) return <Text style={st.center}>Booking not found.</Text>;

  const canChange = ['pending', 'confirmed'].includes(b.status) && b.payment_status === 'paid' && new Date(b.start_time).getTime() > Date.now();
  if (!canChange) return <Text style={st.center}>This booking can't be changed. Only paid, upcoming bookings can.</Text>;

  const fee = Number(b.court?.late_fee_percent ?? 50);
  const late = isLate(b.start_time);
  const paid = Number(b.total_price);
  const booked = (b.booking_extras ?? []) as any[];
  const oldExtras = booked.reduce((a, x) => a + Number(x.amount), 0);
  // extras after the change: the court's optional extras at the chosen counts (paid ones keep their price) + the rest as they were
  const unitPrice = (e: any) => Number(booked.find((x) => x.extra_id === e.id)?.unit_price ?? e.price);
  const offeredIds = new Set(extras.map((e) => e.id));
  const newExtras = extras.reduce((a, e) => a + unitPrice(e) * (qty[e.id] || 0), 0) +
    booked.filter((x) => !offeredIds.has(x.extra_id)).reduce((a, x) => a + Number(x.amount), 0);
  const extrasChanged = extras.some((e) => (qty[e.id] || 0) !== Number(booked.find((x) => x.extra_id === e.id)?.qty || 0));

  // what kind of change is this?
  const oldS = new Date(b.start_time).getTime();
  const oldE = new Date(b.end_time).getTime();
  const newS = pick.start !== null ? cairoToDate(pick.date, pick.start).getTime() : 0;
  const newE = newS + pick.duration * 60000;
  const kind: 'none' | 'same' | 'extend' | 'move' = pick.start === null
    ? extrasChanged ? 'same' : 'none'
    : newS === oldS && newE === oldE ? 'same'
    : newS <= oldS && newE >= oldE ? 'extend'
    : 'move';
  const addBefore = kind === 'extend' ? (oldS - newS) / 60000 : 0;
  const addAfter = kind === 'extend' ? (newE - oldE) / 60000 : 0;

  // adding time around the same booking: all you paid counts (even late) and you pay only the extra time
  const keep = kind === 'extend' || kind === 'same';
  const credit = keep ? paid : rescheduleCredit(paid, fee, late);
  const extrasDiff = newExtras - oldExtras;
  const newTotal = keep
    ? Math.round((paid + extrasDiff + price * ((addBefore + addAfter) / 60)) * 100) / 100
    : Math.round((price * (pick.duration / 60) + newExtras) * 100) / 100;
  const due = kind === 'none' ? 0 : Math.round((newTotal - credit) * 100) / 100;
  const changing = kind === 'extend' || kind === 'move' || (kind === 'same' && extrasChanged);
  const lastDay = b.court?.bookable_until
    ? new Date(new Date(b.court.bookable_until).getTime() - 60000).toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' })
    : undefined;

  async function submit() {
    setErr(null);
    if (!changing) return setErr('Nothing changed yet. Pick a new time or change your extras.');
    setSaving(true);
    const start = pick.start !== null ? cairoToDate(pick.date, pick.start) : new Date(b.start_time);
    const end = pick.start !== null ? new Date(start.getTime() + pick.duration * 60000) : new Date(b.end_time);
    const { data, error } = await supabase.rpc('reschedule_booking', {
      p_booking_id: b.id, p_new_start: start.toISOString(), p_new_end: end.toISOString(),
      p_extras: Object.entries(qty).map(([extra_id, n]) => ({ extra_id, qty: n })),
    });
    setSaving(false);
    if (error) { setErr(error.message); loadBusy(b.court_id); return; }
    const res = data as any;
    if (Number(res?.amount_due) > 0) {
      router.replace({ pathname: '/pay/[id]', params: { id: res.new_booking_id } });
    } else {
      const refund = Number(res?.refund || 0);
      toast(refund > 0 ? `Booking changed · ${egp(refund)} refund on its way` : 'Your booking is changed');
      router.back();
    }
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <Text style={{ color: colors.text, fontSize: 20, fontWeight: '800' }}>{b.court?.name}</Text>
      <Text style={{ color: colors.muted, marginTop: 4 }}>{b.sport?.name} · {b.court?.is_indoor ? 'Indoor' : 'Outdoor'}</Text>
      <Text style={{ color: colors.text, marginTop: 6, marginBottom: 14 }}>
        Current booking: <Text style={{ fontWeight: '800' }}>{dateLabel(b.start_time)} · {timeLabel(b.start_time)} – {timeLabel(b.end_time)}</Text> · paid {egp(paid)}
      </Text>

      <View style={[st.box, { borderColor: late && !keep ? colors.danger : colors.success }]}>
        <Text style={{ color: colors.text, lineHeight: 20 }}>
          {keep || kind === 'none'
            ? `✅ Everything you paid (${egp(paid)}) still counts. Add time or extras and you only pay the difference.`
            : late
            ? `⚠️ Your game starts in less than ${FREE_CHANGE_HOURS} hours, so ${fee}% of what you paid (${egp(paid - credit)}) is kept as a fee. ${egp(credit)} counts toward the new time.`
            : `✅ Free change: the full ${egp(paid)} you paid counts toward the new time.`}
        </Text>
      </View>

      <SlotPicker
        rules={rules} busy={busy} value={pick} minMinutes={Math.max(60, Number(b.court?.min_booking_minutes || 0))} maxDate={lastDay}
        current={{ start: b.start_time, end: b.end_time }}
        onChange={(p) => { setPick(p); setErr(null); }}
      />

      {extras.length > 0 && (
        <View style={st.card}>
          <Text style={{ color: colors.text, fontWeight: '700', marginBottom: 8 }}>Extras</Text>
          {extras.map((e) => {
            const n = qty[e.id] || 0;
            return (
              <View key={e.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <Text style={{ color: colors.text, flex: 1 }}>{e.name} <Text style={{ color: colors.muted }}>· {egp(unitPrice(e))}</Text></Text>
                <Pressable disabled={n === 0} onPress={() => setQty({ ...qty, [e.id]: n - 1 })} style={[st.step, n === 0 && { opacity: 0.3 }]}
                  accessibilityLabel={`Fewer ${e.name}`}><Text style={st.stepText}>−</Text></Pressable>
                <Text style={{ color: colors.text, width: 28, textAlign: 'center' }}>{n}</Text>
                <Pressable disabled={n >= e.max_qty} onPress={() => setQty({ ...qty, [e.id]: n + 1 })} style={[st.step, n >= e.max_qty && { opacity: 0.3 }]}
                  accessibilityLabel={`More ${e.name}`}><Text style={st.stepText}>+</Text></Pressable>
              </View>
            );
          })}
        </View>
      )}

      <View style={st.card}>
        {kind === 'none' ? (
          <Text style={{ color: colors.muted }}>Your current booking is the green block. Choose a new time, tap above or below it to add time, or change your extras.</Text>
        ) : kind === 'same' && !extrasChanged ? (
          <Text style={{ color: colors.text }}><Text style={{ fontWeight: '800' }}>This is the time you already have.</Text> Pick a different time, add time before or after it, or change your extras.</Text>
        ) : (
          <>
            {keep ? (
              <>
                {kind === 'extend' && (
                  <Text style={{ color: colors.text, fontWeight: '700', marginBottom: 4 }}>
                    Adding {[addBefore && `${durationText(addBefore)} before`, addAfter && `${durationText(addAfter)} after`].filter(Boolean).join(' and ')} your booking
                  </Text>
                )}
                {kind === 'extend' && <Row l="Extra time" r={egp(due - extrasDiff)} />}
                {extrasChanged && <Row l="Extras" r={extrasDiff < 0 ? `− ${egp(-extrasDiff)}` : `+ ${egp(extrasDiff)}`} />}
              </>
            ) : (
              <>
                <Row l={`New time${newExtras > 0 ? ' (with your extras)' : ''}`} r={egp(newTotal)} />
                <Row l="Carried over" r={`− ${egp(credit)}`} />
              </>
            )}
            <View style={{ borderTopWidth: 1, borderTopColor: colors.border, marginTop: 8, paddingTop: 8 }}>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 17 }}>
                {due > 0 ? `To pay by InstaPay: ${egp(due)}` : due < 0 ? `We refund you: ${egp(-due - instapayFee(-due))}` : 'Nothing to pay'}
              </Text>
              {due < 0 && <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>{egp(-due)} minus InstaPay's transfer fee ({INSTAPAY_FEE_TEXT}): {egp(instapayFee(-due))}</Text>}
              {due > 0 && <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>Your current booking stays until the extra payment is approved. The new time is held for {HOLD_MINUTES} minutes.</Text>}
            </View>
          </>
        )}
      </View>

      {err && <Note kind="error">{err}</Note>}
      <Button
        title={due > 0 ? (kind === 'extend' ? 'Pay the difference →' : 'Continue to payment →') : 'Confirm changes'}
        onPress={submit} loading={saving} disabled={!changing}
      />
    </ScrollView>
  );
}

function Row({ l, r }: { l: string; r: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
      <Text style={{ color: colors.muted }}>{l}</Text>
      <Text style={{ color: colors.text }}>{r}</Text>
    </View>
  );
}

const useSt = themed(() => ({
  center: { color: colors.muted, textAlign: 'center' as const, margin: 40 },
  box: { backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, padding: 12, marginBottom: 14 },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: 14, marginTop: 14, borderWidth: 1, borderColor: colors.border },
  step: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.cardAlt, alignItems: 'center' as const, justifyContent: 'center' as const },
  stepText: { color: colors.text, fontSize: 18, fontWeight: '700' as const },
}));
