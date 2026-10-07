import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { colors, radius } from '@/lib/theme';
import { cairoDate, cairoToDate, dateLabel, durationText, egp } from '@/lib/format';
import { HOLD_MINUTES } from '@/lib/payment';
import { Button, Note } from '@/components/ui';
import { Busy, Pick, Rule, SlotPicker } from '@/components/SlotPicker';

type Extra = { id: string; name: string; price: number; max_qty: number; is_required: boolean; sport_id: string | null };

export default function BookCourt() {
  const { courtId, sport: sportSlug } = useLocalSearchParams<{ courtId: string; sport?: string }>();
  const router = useRouter();
  const { session } = useAuth();
  const [court, setCourt] = useState<any>(null);
  const [sport, setSport] = useState<{ id: string; name: string; price: number } | null>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [busy, setBusy] = useState<Busy[]>([]);
  const [extras, setExtras] = useState<Extra[]>([]);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [pick, setPick] = useState<Pick>({ date: cairoDate(), start: null, duration: 0 });
  const [credit, setCredit] = useState(0);
  const [rewardPercent, setRewardPercent] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [waitFor, setWaitFor] = useState<{ start: string; end: string } | null>(null);
  const [waiting, setWaiting] = useState<string[]>([]);

  const loadBusy = useCallback(async () => {
    const { data } = await supabase.rpc('court_busy_slots', { p_court_id: courtId });
    setBusy((data ?? []) as Busy[]);
  }, [courtId]);

  useEffect(() => {
    (async () => {
      const { data: c } = await supabase
        .from('courts')
        .select('id,name,is_indoor,bookable_until,min_booking_minutes,late_fee_percent,facility:facilities(name),court_sports(price_per_hour,sport:sports(id,name,slug))')
        .eq('id', courtId).maybeSingle();
      const offered = ((c as any)?.court_sports ?? []).filter((x: any) => x.sport);
      const picked = offered.find((x: any) => x.sport.slug === sportSlug) ?? (offered.length === 1 ? offered[0] : null);
      if (!c || !picked || !(c as any).bookable_until || new Date((c as any).bookable_until).getTime() <= Date.now()) {
        setCourt(c ?? null); setLoading(false); return;
      }
      const [r, e] = await Promise.all([
        supabase.from('availability_rules').select('day_of_week,open_time,close_time,is_closed').eq('court_id', courtId),
        supabase.from('court_extras').select('id,name,price,max_qty,is_required,sport_id').eq('court_id', courtId).eq('status', 'approved').eq('is_active', true)
          .order('is_required', { ascending: false }).order('name'),
      ]);
      setCourt(c);
      setSport({ id: picked.sport.id, name: picked.sport.name, price: Number(picked.price_per_hour) });
      setRules((r.data ?? []) as Rule[]);
      setExtras(((e.data ?? []) as any[]).filter((x) => !x.sport_id || x.sport_id === picked.sport.id).map((x) => ({ ...x, price: Number(x.price) })));
      await loadBusy();
      if (session) {
        supabase.rpc('my_credit').then(({ data }) => setCredit(Number(data ?? 0)));
        supabase.rpc('my_referrals').then(({ data }: any) => { if (data && Number(data.available) > 0) setRewardPercent(Number(data.percent)); });
        supabase.from('slot_waitlist').select('start_time').eq('court_id', courtId).gt('end_time', new Date().toISOString())
          .then(({ data }) => setWaiting((data ?? []).map((x: any) => new Date(x.start_time).getTime().toString())));
      }
      setLoading(false);
    })();
  }, [courtId, sportSlug, session, loadBusy]);

  if (loading) return <ActivityIndicator style={{ marginTop: 60 }} color={colors.primary} />;
  if (!court || !sport) {
    return <Text style={{ color: colors.muted, textAlign: 'center', margin: 40 }}>
      This court is not taking bookings right now. Please choose another court.
    </Text>;
  }

  const minMinutes = Math.max(60, Number(court.min_booking_minutes || 0));
  const lastDay = cairoDate(0) && new Date(new Date(court.bookable_until).getTime() - 60000).toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
  const courtPrice = Math.round(sport.price * (pick.duration / 60) * 100) / 100;
  const extrasTotal = extras.reduce((sum, x) => sum + x.price * (x.is_required ? 1 : qty[x.id] || 0), 0);
  const total = courtPrice + extrasTotal;
  const discount = rewardPercent > 0 ? Math.round(total * rewardPercent) / 100 : 0;
  const optional = extras.filter((x) => !x.is_required);
  const required = extras.filter((x) => x.is_required);

  async function ensureReady(): Promise<boolean> {
    if (!session) { router.push('/login'); return false; }
    const { data: me } = await supabase.from('users').select('role,phone').eq('id', session.user.id).single();
    if ((me as any)?.role === 'player' && !(me as any)?.phone) {
      Alert.alert('One more step', 'Please add your mobile number first. Open zafplay.com, log in and finish your profile. Sign-up inside the app is coming soon.');
      return false;
    }
    return true;
  }

  async function book() {
    setErr(null);
    if (pick.start === null) return setErr('Please choose your time.');
    if (!(await ensureReady())) return;
    setSaving(true);
    const start = cairoToDate(pick.date, pick.start);
    const end = new Date(start.getTime() + pick.duration * 60000);
    const { data, error } = await supabase.rpc('create_booking', {
      p_court_id: courtId, p_sport_id: sport!.id, p_start: start.toISOString(), p_end: end.toISOString(),
      p_extras: Object.entries(qty).filter(([, n]) => n > 0).map(([extra_id, n]) => ({ extra_id, qty: n })),
    });
    setSaving(false);
    if (error) {
      setErr(error.message.includes('no_overlap') ? 'Someone just took this time. Please choose another one.' : error.message);
      loadBusy();
      return;
    }
    router.replace({ pathname: '/pay/[id]', params: { id: (data as any).booking_id } });
  }

  async function joinWaitlist() {
    if (!waitFor || !(await ensureReady())) return;
    const start = new Date(waitFor.start).getTime();
    const end = Math.min(new Date(waitFor.end).getTime(), start + 4 * 3600000); // the database waits for at most 4 hours
    const { error } = await supabase.rpc('join_waitlist', {
      p_court_id: courtId, p_sport_id: sport!.id, p_start: new Date(start).toISOString(), p_end: new Date(end).toISOString(),
    });
    if (error) return Alert.alert('Could not add you', error.message);
    setWaiting((w) => [...w, String(start)]);
    setWaitFor(null);
    Alert.alert('You are on the list', 'We will email you the moment this time frees up.');
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} style={{ backgroundColor: colors.bg }}>
      <Stack.Screen options={{ title: court.name }} />
      <Text style={{ color: colors.text, fontSize: 20, fontWeight: '800' }}>{court.name}</Text>
      <Text style={{ color: colors.muted, marginTop: 4, marginBottom: 16 }}>
        {sport.name} · {court.is_indoor ? 'Indoor' : 'Outdoor'} · {egp(sport.price)} / hour
        {required.map((x) => ` · ${x.name} ${egp(x.price)}`).join('')}
      </Text>

      <SlotPicker
        rules={rules} busy={busy} value={pick} minMinutes={minMinutes} maxDate={lastDay}
        onChange={(p) => { setPick(p); setErr(null); setWaitFor(null); }}
        onBusyTap={(start, end) => setWaitFor({ start, end })}
      />

      {waitFor && (
        <View style={st.card}>
          <Text style={{ color: colors.text }}>This time is booked.</Text>
          {waiting.includes(String(new Date(waitFor.start).getTime())) ? (
            <Text style={{ color: colors.muted, marginTop: 6 }}>🔔 You are already on the waiting list for it.</Text>
          ) : (
            <View style={{ marginTop: 10 }}><Button title="🔔 Notify me if it frees up" variant="ghost" onPress={joinWaitlist} /></View>
          )}
        </View>
      )}

      {optional.length > 0 && (
        <View style={st.card}>
          <Text style={{ color: colors.text, fontWeight: '700', marginBottom: 8 }}>Extras (optional)</Text>
          {optional.map((x) => {
            const n = qty[x.id] || 0;
            return (
              <View key={x.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <Text style={{ color: colors.text, flex: 1 }}>{x.name} <Text style={{ color: colors.muted }}>· {egp(x.price)}</Text></Text>
                <Pressable disabled={n === 0} onPress={() => setQty({ ...qty, [x.id]: n - 1 })} style={[st.step, n === 0 && { opacity: 0.3 }]}><Text style={st.stepText}>−</Text></Pressable>
                <Text style={{ color: colors.text, width: 28, textAlign: 'center' }}>{n}</Text>
                <Pressable disabled={n >= x.max_qty} onPress={() => setQty({ ...qty, [x.id]: n + 1 })} style={[st.step, n >= x.max_qty && { opacity: 0.3 }]}><Text style={st.stepText}>+</Text></Pressable>
              </View>
            );
          })}
        </View>
      )}

      <View style={st.card}>
        {pick.start === null ? (
          <Text style={{ color: colors.muted }}>Choose your time above to see the total (minimum {durationText(minMinutes)}).</Text>
        ) : (
          <>
            <Text style={{ color: colors.text, fontWeight: '700' }}>{dateLabel(cairoToDate(pick.date, pick.start).toISOString())}</Text>
            <Row l={`Court · ${durationText(pick.duration)}`} r={egp(courtPrice)} />
            {required.map((x) => <Row key={x.id} l={x.name} r={egp(x.price)} />)}
            {optional.filter((x) => (qty[x.id] || 0) > 0).map((x) => <Row key={x.id} l={`${x.name} × ${qty[x.id]}`} r={egp(x.price * qty[x.id])} />)}
            {discount > 0 && <Row l={`Referral discount (${rewardPercent}%)`} r={`− ${egp(discount)}`} good />}
            <View style={{ borderTopWidth: 1, borderTopColor: colors.border, marginTop: 8, paddingTop: 8, flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ color: colors.text, fontWeight: '700' }}>Total</Text>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 20 }}>{egp(total - discount)}</Text>
            </View>
            {credit > 0 && <Text style={{ color: colors.success, marginTop: 8 }}>💳 You have {egp(credit)} credit. It is taken off automatically.</Text>}
          </>
        )}
        <Text style={{ color: colors.muted, fontSize: 12, marginTop: 10 }}>
          Next: pay by InstaPay and upload the screenshot. Your time is held for {HOLD_MINUTES} minutes.
        </Text>
      </View>

      {err && <Note kind="error">{err}</Note>}
      <Button title={session ? 'Continue to payment →' : 'Log in to continue →'} onPress={book} loading={saving} disabled={pick.start === null && !!session} />
    </ScrollView>
  );
}

function Row({ l, r, good }: { l: string; r: string; good?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
      <Text style={{ color: good ? colors.success : colors.muted }}>{l}</Text>
      <Text style={{ color: good ? colors.success : colors.text }}>{r}</Text>
    </View>
  );
}

const st = {
  card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: 14, marginVertical: 14, borderWidth: 1, borderColor: colors.border },
  step: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.cardAlt, alignItems: 'center' as const, justifyContent: 'center' as const },
  stepText: { color: colors.text, fontSize: 18, fontWeight: '700' as const },
};
