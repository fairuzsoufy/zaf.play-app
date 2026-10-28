import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { colors, radius, themed, useTheme } from '@/lib/theme';
import { cairoDate, cairoToDate, dateLabel, durationText, egp } from '@/lib/format';
import { FREE_CHANGE_HOURS, HOLD_MINUTES } from '@/lib/payment';
import { useRequestId } from '@/lib/requestId';
import { Button, Note } from '@/components/ui';
import { Busy, Pick, Rule, SlotPicker } from '@/components/SlotPicker';
import { PolicyNotice } from '@/components/PolicyNotice';

const LEVELS = [
  { v: 'beginner', label: 'Beginner' },
  { v: 'intermediate', label: 'Intermediate' },
  { v: 'advanced', label: 'Advanced' },
];

type Extra = { id: string; name: string; price: number; max_qty: number; is_required: boolean; sport_id: string | null };

export default function BookCourt() {
  const insets = useSafeAreaInsets();
  const st = useSt();
  const { courtId, sport: sportSlug, host, date: dateIn, start: startIn, dur: durIn } =
    useLocalSearchParams<{ courtId: string; sport?: string; host?: string; date?: string; start?: string; dur?: string }>();
  const router = useRouter();
  const { session } = useAuth();
  const [court, setCourt] = useState<any>(null);
  const [sport, setSport] = useState<{ id: string; name: string; price: number } | null>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [busy, setBusy] = useState<Busy[]>([]);
  const [extras, setExtras] = useState<Extra[]>([]);
  const [qty, setQty] = useState<Record<string, number>>({});
  // a free time tapped on the Book screen arrives already picked (start in minutes after that day's midnight)
  const [pick, setPick] = useState<Pick>(() => dateIn && /^\d{4}-\d{2}-\d{2}$/.test(dateIn)
    ? { date: dateIn, start: startIn ? Number(startIn) : null, duration: startIn && durIn ? Number(durIn) : 0 }
    : { date: cairoDate(), start: null, duration: 0 });
  const [credit, setCredit] = useState(0);
  const [rewardPercent, setRewardPercent] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [waitFor, setWaitFor] = useState<{ start: string; end: string } | null>(null);
  const [waiting, setWaiting] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  // open game: other players join and pay their own spot (same options as the website)
  const [openMode, setOpenMode] = useState(host === '1');
  const [spots, setSpots] = useState(4);
  const [mySeats, setMySeats] = useState(1); // spots the host pays for (the host + friends)
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [whoCanJoin, setWhoCanJoin] = useState<'mixed' | 'men' | 'women'>('mixed');
  const [levels, setLevels] = useState<string[]>([]); // empty = any level; up to 2
  const [gameNote, setGameNote] = useState('');
  const req = useRequestId(); // the page holds still while a booking bar is dragged

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
  const seatsPaid = Math.min(mySeats, spots);
  const seatsAmount = Math.ceil((Math.round(total * 100) * seatsPaid) / spots) / 100;
  const optional = extras.filter((x) => !x.is_required);
  const required = extras.filter((x) => x.is_required);

  async function ensureReady(): Promise<boolean> {
    if (!session) { router.push('/login'); return false; }
    const { data: me } = await supabase.from('users').select('role,phone').eq('id', session.user.id).single();
    if ((me as any)?.role === 'player' && !(me as any)?.phone) {
      Alert.alert('One more step', 'Please add your mobile number to your profile first, so the court can reach you.', [
        { text: 'Not now', style: 'cancel' },
        { text: 'Add number', onPress: () => router.push({ pathname: '/profile', params: { edit: '1' } }) },
      ]);
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

  async function hostGame() {
    setErr(null);
    if (pick.start === null) return setErr('Please choose your time.');
    if (!(await ensureReady())) return;
    if (whoCanJoin !== 'mixed') {
      // the host must fit the rule too
      const { data: u } = await supabase.from('users').select('gender').eq('id', session!.user.id).single();
      const g = (u as any)?.gender;
      if (!g) return setErr('Please choose male or female in your Profile first, then host this game.');
      if ((whoCanJoin === 'men' && g !== 'male') || (whoCanJoin === 'women' && g !== 'female'))
        return setErr(`You can't host a ${whoCanJoin === 'men' ? 'men' : 'women'}-only game. Choose another option.`);
    }
    setSaving(true);
    const start = cairoToDate(pick.date, pick.start);
    const end = new Date(start.getTime() + pick.duration * 60000);
    const { data, error } = await supabase.rpc('create_open_game', {
      p_request_id: req.get(), p_court_id: courtId, p_sport_id: sport!.id, p_start: start.toISOString(), p_end: end.toISOString(),
      p_spots: spots, p_level: 'any', p_note: gameNote.trim() || null,
      p_extras: Object.entries(qty).filter(([, n]) => n > 0).map(([extra_id, n]) => ({ extra_id, qty: n })),
      p_my_seats: seatsPaid,
      ...(visibility === 'private' ? { p_visibility: 'private' } : {}),
    });
    if (error) {
      setSaving(false);
      setErr(error.message.includes('no_overlap') ? 'Someone just took this time. Please choose another one.' : error.message);
      loadBusy();
      return;
    }
    req.done();
    const gameId = (data as any).game_id;
    if (whoCanJoin !== 'mixed') {
      const { error: gErr } = await supabase.rpc('set_open_game_gender', { p_game_id: gameId, p_rule: whoCanJoin });
      if (gErr) Alert.alert('Created as mixed', `Your game was created as mixed: ${gErr.message}`);
    }
    if (visibility === 'public' && levels.length > 0) {
      const { error: lErr } = await supabase.rpc('set_open_game_levels', { p_game_id: gameId, p_levels: levels });
      if (lErr) Alert.alert('Created for any level', `Your game was created for any level: ${lErr.message}`);
    }
    setSaving(false);
    router.replace({ pathname: '/game/[id]', params: { id: gameId, new: '1' } });
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
    <ScrollView scrollEnabled={!dragging} contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }} style={{ backgroundColor: colors.bg }}>
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
        onDragging={setDragging}
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
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontWeight: '700' }}>Invite players to share the cost</Text>
            <Text style={{ color: colors.muted, fontSize: 12 }}>Others join and pay their spot</Text>
          </View>
          <Switch value={openMode} onValueChange={(v) => { setOpenMode(v); setErr(null); }} trackColor={{ true: colors.brandPurple, false: colors.cardAlt }} />
        </View>
        {openMode && (
          <View style={{ marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border, gap: 12 }}>
            <Stepper label="Players in total" value={spots} min={2} max={12} onChange={(n) => { setSpots(n); setMySeats((m) => Math.min(m, n)); }} />
            <Stepper label="Spots I pay" hint="you + friends you pay for" value={seatsPaid} min={1} max={spots} onChange={setMySeats} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Chip on={visibility === 'public'} label="🌍 Public" onPress={() => setVisibility('public')} />
              <Chip on={visibility === 'private'} label="🔒 Private" onPress={() => { setVisibility('private'); setWhoCanJoin('mixed'); setLevels([]); }} />
            </View>
            {visibility === 'public' && (
              <>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {(['mixed', 'men', 'women'] as const).map((v) => <Chip key={v} on={whoCanJoin === v} label={v === 'mixed' ? 'Mixed' : v === 'men' ? 'Men' : 'Women'} onPress={() => setWhoCanJoin(v)} />)}
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  <Chip on={levels.length === 0} label="Any level" onPress={() => { setLevels([]); setErr(null); }} />
                  {LEVELS.map((l) => {
                    const on = levels.includes(l.v);
                    return <Chip key={l.v} on={on} label={l.label} onPress={() => {
                      if (on) return setLevels(levels.filter((x) => x !== l.v));
                      if (levels.length >= 2) return setErr('You can pick up to 2 levels. Tap one to remove it first, or choose Any level.');
                      setErr(null);
                      setLevels([...levels, l.v]);
                    }} />;
                  })}
                </View>
              </>
            )}
            <TextInput value={gameNote} onChangeText={setGameNote} maxLength={200} placeholder="Note for players (optional)" placeholderTextColor={colors.muted}
              style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, color: colors.text }} />
            <Text style={{ color: colors.muted, fontSize: 12 }}>
              Must fill by {FREE_CHANGE_HOURS} hours before, or everyone gets a full refund. Pick a time at least {FREE_CHANGE_HOURS + 1} hours from now.
            </Text>
          </View>
        )}
      </View>

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
            {openMode && <Row l={`Your spot (${seatsPaid} of ${spots})`} r={egp(seatsAmount)} />}
            {credit > 0 && !openMode && <Text style={{ color: colors.success, marginTop: 8 }}>💳 You have {egp(credit)} credit. It is taken off automatically.</Text>}
          </>
        )}
        <Text style={{ color: colors.muted, fontSize: 12, marginTop: 10 }}>
          Next: pay by InstaPay and upload the screenshot. Your time is held for {HOLD_MINUTES} minutes.
        </Text>
      </View>

      <PolicyNotice feePercent={Number(court.late_fee_percent ?? 50)} />

      {err && <Note kind="error">{err}</Note>}
      <Button title={!session ? 'Log in to continue →' : openMode ? `Host game · pay my spot${pick.start !== null ? ` ${egp(seatsAmount)}` : ''} →` : 'Continue to payment →'}
        onPress={openMode ? hostGame : book} loading={saving} disabled={pick.start === null && !!session} />
    </ScrollView>
  );
}

function Row({ l, r, good }: { l: string; r: string; good?: boolean }) {
  useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
      <Text style={{ color: good ? colors.success : colors.muted }}>{l}</Text>
      <Text style={{ color: good ? colors.success : colors.text }}>{r}</Text>
    </View>
  );
}

function Stepper({ label, hint, value, min, max, onChange }: { label: string; hint?: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  const st = useSt();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text, fontWeight: '600' }}>{label}</Text>
        {hint && <Text style={{ color: colors.muted, fontSize: 12 }}>{hint}</Text>}
      </View>
      <Pressable disabled={value <= min} onPress={() => onChange(value - 1)} style={[st.step, value <= min && { opacity: 0.3 }]}><Text style={st.stepText}>−</Text></Pressable>
      <Text style={{ color: colors.text, width: 28, textAlign: 'center' }}>{value}</Text>
      <Pressable disabled={value >= max} onPress={() => onChange(value + 1)} style={[st.step, value >= max && { opacity: 0.3 }]}><Text style={st.stepText}>+</Text></Pressable>
    </View>
  );
}

function Chip({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) {
  useTheme();
  return (
    <Pressable onPress={onPress} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.lg, borderWidth: 1,
      borderColor: on ? colors.brandPurple : colors.border, backgroundColor: on ? colors.soft : 'transparent' }}>
      <Text style={{ color: on ? colors.text : colors.muted, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

const useSt = themed(() => ({
  card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: 14, marginVertical: 14, borderWidth: 1, borderColor: colors.border },
  step: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.cardAlt, alignItems: 'center' as const, justifyContent: 'center' as const },
  stepText: { color: colors.text, fontSize: 18, fontWeight: '700' as const },
}));
