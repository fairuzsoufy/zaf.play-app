import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, View } from 'react-native';
import { Text, TextInput } from '@/components/AppText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { colors, radius, themed, useTheme } from '@/lib/theme';
import { cairoDate, cairoToDate, egp, timeLabel } from '@/lib/format';
import { FREE_CHANGE_HOURS, HOLD_MINUTES } from '@/lib/payment';
import { useRequestId } from '@/lib/requestId';
import { useBusyPing } from '@/lib/useBusyPing';
import { Button, Note } from '@/components/ui';
import { Busy, Pick, Rule, SlotPicker } from '@/components/SlotPicker';
import { BlockedNotice } from '@/components/BlockedNotice';

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
  // open game: other players join and pay their own spot (same options as the website)
  const [openMode, setOpenMode] = useState(host === '1');
  const [more, setMore] = useState(false);
  const [spots, setSpots] = useState(4);
  const [mySeats, setMySeats] = useState(1); // spots the host pays for (the host + friends)
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [whoCanJoin, setWhoCanJoin] = useState<'mixed' | 'men' | 'women'>('mixed');
  const [levels, setLevels] = useState<string[]>([]); // empty = any level; up to 2
  const [gameNote, setGameNote] = useState('');
  const req = useRequestId();
  // pressed the button as a guest: once logged in, carry on to Pay by itself (like the website's log-in sheet)
  const goAfterLogin = useRef(false);

  const loadBusy = useCallback(async () => {
    const { data } = await supabase.rpc('court_busy_slots', { p_court_id: courtId });
    setBusy((data ?? []) as Busy[]);
  }, [courtId]);
  useBusyPing(`court-busy:${courtId}`, loadBusy); // someone else's hold shows up straight away, like the website

  useEffect(() => {
    (async () => {
      const { data: c } = await supabase
        .from('courts')
        .select('id,name,is_indoor,bookable_until,min_booking_minutes,late_fee_percent,facility_id,facility:facilities(name),court_sports(price_per_hour,sport:sports(id,name,slug))')
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

  // back from log in with a time picked: the booking is made straight away, no second tap
  useEffect(() => {
    if (!session || !goAfterLogin.current || loading || !sport || pick.start === null) return;
    goAfterLogin.current = false;
    if (openMode) hostGame(); else book();
  }, [session, loading, sport]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <ActivityIndicator style={{ marginTop: 60 }} color={colors.primary} />;
  if (!court || !sport) {
    return <Text style={{ color: colors.muted, textAlign: 'center', margin: 40 }}>
      This court is not taking bookings right now. Please choose another court.
    </Text>;
  }

  const minMinutes = Math.max(30, Number(court.min_booking_minutes || 0));
  const lastDay = cairoDate(0) && new Date(new Date(court.bookable_until).getTime() - 60000).toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
  const courtPrice = Math.round(sport.price * (pick.duration / 60) * 100) / 100;
  const extrasTotal = extras.reduce((sum, x) => sum + x.price * (x.is_required ? 1 : qty[x.id] || 0), 0);
  const total = courtPrice + extrasTotal;
  const discount = rewardPercent > 0 ? Math.round(total * rewardPercent) / 100 : 0;
  const seatsPaid = Math.min(mySeats, spots);
  const seatsAmount = Math.ceil((Math.round(total * 100) * seatsPaid) / spots) / 100;
  const optional = extras.filter((x) => !x.is_required);
  // Zaf Play credit is taken off by the database; show it here so the amount matches (website's maths)
  const creditUse = session && credit > 0 ? Math.min(credit, Math.max(total - discount, 0)) : 0;
  const toPay = Math.max(Math.round((total - discount - creditUse) * 100) / 100, 0);
  const perSpot = spots > 0 ? Math.ceil(Math.round(total * 100) / spots) / 100 : 0;
  const requiredTotal = extras.filter((x) => x.is_required).reduce((a, x) => a + x.price, 0);
  const payAmount = openMode ? seatsAmount : toPay;
  const startD = pick.start !== null ? cairoToDate(pick.date, pick.start) : null;
  const endD = startD ? new Date(startD.getTime() + pick.duration * 60000) : null;
  const whenShort = startD && endD
    ? `${startD.toLocaleDateString('en-GB', { timeZone: 'Africa/Cairo', weekday: 'short', day: 'numeric' })} · ${timeLabel(startD.toISOString()).replace(/ [AP]M$/, '')}–${timeLabel(endD.toISOString())}`
    : '';
  const freeUntil = startD ? new Date(startD.getTime() - FREE_CHANGE_HOURS * 3600000) : null;
  const payLabel = !session && pick.start !== null ? `Log in to pay ${egp(payAmount)}`
    : saving ? 'Holding your time...'
    : pick.start === null ? 'Pick a time'
    : openMode ? `Pay my spot · ${egp(payAmount)}`
    : toPay === 0 && creditUse > 0 ? 'Confirm with credit' : `Pay ${egp(toPay)}`;
  const policyLine = !openMode && creditUse > 0 && toPay === 0
    ? 'Your credit covers it all, so the booking is confirmed straight away.'
    : `Held ${HOLD_MINUTES} minutes after you tap Pay`;
  const lengthLabel = (m: number) => (m < 60 ? `${m} min` : Number.isInteger(m / 60) ? `${m / 60} h` : `${Math.floor(m / 60)}½ h`);
  const required = extras.filter((x) => x.is_required);

  async function ensureReady(): Promise<boolean> {
    if (!session) { goAfterLogin.current = true; router.push('/login'); return false; }
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
      p_request_id: req.get(), p_court_id: courtId, p_sport_id: sport!.id, p_start: start.toISOString(), p_end: end.toISOString(),
      p_extras: Object.entries(qty).filter(([, n]) => n > 0).map(([extra_id, n]) => ({ extra_id, qty: n })),
    });
    setSaving(false);
    if (error) {
      setErr(error.message.includes('no_overlap') ? 'Someone just took this time. Please choose another one.' : error.message);
      loadBusy();
      return;
    }
    req.done();
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
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 24 }} style={{ backgroundColor: colors.bg }}>
      <Stack.Screen options={{ title: court.name }} />
      <Text style={{ color: colors.text, fontSize: 20, fontWeight: '800' }}>{court.name}</Text>
      <Text style={{ color: colors.muted, marginTop: 4, marginBottom: 16 }}>
        {sport.name} · {court.is_indoor ? 'Indoor' : 'Outdoor'} · {egp(sport.price)} / hour
        {required.map((x) => ` · ${x.name} ${egp(x.price)}`).join('')}
        {' · '}
        <Text accessibilityRole="link" onPress={() => router.push({ pathname: '/court/[id]', params: { id: courtId } })} style={{ color: colors.accent, fontWeight: '700' }}>Info</Text>
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
                <Pressable accessibilityRole="button" disabled={n === 0} onPress={() => setQty({ ...qty, [x.id]: n - 1 })} style={[st.step, n === 0 && { opacity: 0.3 }]}><Text style={st.stepText}>−</Text></Pressable>
                <Text style={{ color: colors.text, width: 28, textAlign: 'center' }}>{n}</Text>
                <Pressable accessibilityRole="button" disabled={n >= x.max_qty} onPress={() => setQty({ ...qty, [x.id]: n + 1 })} style={[st.step, n >= x.max_qty && { opacity: 0.3 }]}><Text style={st.stepText}>+</Text></Pressable>
              </View>
            );
          })}
        </View>
      )}

      {/* Just me or split the cost: two big cards, then the price each player pays (as on the website) */}
      <View style={st.card}>
        <View style={{ flexDirection: 'row', gap: 8 }} accessibilityRole="radiogroup">
          {([[false, 'Just me', 'I pay the full court'], [true, 'Split the cost', 'Others pay their spot']] as const).map(([v, title, sub]) => {
            const on = openMode === v;
            return (
              <Pressable key={title} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => { setOpenMode(v); setErr(null); }}
                style={[st.optPick, on && st.optPickOn]}>
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14 }}>{title}</Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>{sub}</Text>
              </Pressable>
            );
          })}
        </View>
        {openMode && (
          <View style={{ marginTop: 12, gap: 12 }}>
            <Stepper label="Players in total" value={spots} min={2} max={12} onChange={(n) => { setSpots(n); setMySeats((m) => Math.min(m, n)); }} />
            <Stepper label="Spots I pay for" hint="you + friends you pay for" value={seatsPaid} min={1} max={spots} onChange={setMySeats} />
            {pick.start !== null && (
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>Each player pays</Text>
                <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 20 }}>{egp(perSpot)}</Text>
              </View>
            )}
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: more }} onPress={() => setMore(!more)}
              style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, minHeight: 40, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14 }}>
              <Text style={{ color: colors.text, fontWeight: '700' }}>More options</Text>
              <Text style={{ color: colors.muted, fontSize: 12, flexShrink: 1 }} numberOfLines={1}>
                {more ? 'Hide' : `${visibility === 'public' ? 'Public' : 'Private'} · ${whoCanJoin === 'mixed' ? 'Mixed' : whoCanJoin === 'men' ? 'Men' : 'Women'} · ${levels.length ? LEVELS.filter((l) => levels.includes(l.v)).map((l) => l.label).join(', ') : 'Any level'}`}
              </Text>
            </Pressable>
            {more && (
              <View style={{ gap: 12 }}>
                <Seg label="Game" options={[['private', '🔒 Private'], ['public', 'Public']]} isOn={(v) => visibility === v}
                  onPick={(v) => { setVisibility(v as 'public' | 'private'); if (v === 'private') { setWhoCanJoin('mixed'); setLevels([]); } }} />
                {visibility === 'public' && (
                  <>
                    <Seg label="Who can join" options={[['mixed', 'Mixed'], ['men', 'Men'], ['women', 'Women']]} isOn={(v) => whoCanJoin === v} onPick={(v) => setWhoCanJoin(v as 'mixed' | 'men' | 'women')} />
                    <Seg label="Level · up to 2" options={[['any', 'Any'], ...LEVELS.map((l) => [l.v, l.label] as [string, string])]}
                      isOn={(v) => (v === 'any' ? levels.length === 0 : levels.includes(v))}
                      onPick={(v) => {
                        if (v === 'any') { setLevels([]); return setErr(null); }
                        if (levels.includes(v)) return setLevels(levels.filter((x) => x !== v));
                        if (levels.length >= 2) return setErr('You can pick up to 2 levels. Tap one to remove it first, or choose Any level.');
                        setErr(null);
                        setLevels([...levels, v]);
                      }} />
                  </>
                )}
                <TextInput value={gameNote} onChangeText={setGameNote} maxLength={200} placeholder="Note for players (optional)" placeholderTextColor={colors.muted}
                  style={{ height: 40, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 12, color: colors.text, fontSize: 14 }} />
              </View>
            )}
            <Text style={{ color: colors.muted, fontSize: 12 }}>
              Must fill by {FREE_CHANGE_HOURS} hours before, or everyone gets a full refund. Pick a time at least {FREE_CHANGE_HOURS + 1} hours from now.
            </Text>
          </View>
        )}
      </View>

      {freeUntil && (
        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 12 }}>
          Free change or cancel until {timeLabel(freeUntil.toISOString())}{freeUntil.toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' }) !== pick.date ? ' the day before' : ''}.
        </Text>
      )}

      <BlockedNotice facilityId={court.facility_id} />

      {err && <Note kind="error">{err}</Note>}
    </ScrollView>
    {/* the total and Pay never leave the screen, like the website */}
    <View style={{ borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.card, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12 + insets.bottom, gap: 8 }}>
      {pick.start !== null && (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
          <Text style={{ color: colors.muted, fontSize: 13, flex: 1 }} numberOfLines={1}>
            {whenShort} · {lengthLabel(pick.duration)}{openMode ? ` · Your spot (${seatsPaid} of ${spots})` : ''}
          </Text>
          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 22 }}>{egp(payAmount)}</Text>
        </View>
      )}
      {pick.start !== null && !openMode && (extrasTotal > 0 || discount > 0 || creditUse > 0) && (
        <Text style={{ color: colors.muted, fontSize: 12 }}>
          Court {egp(courtPrice)}
          {required.map((e) => ` + ${e.name} ${egp(e.price)}`).join('')}
          {extrasTotal - requiredTotal > 0 ? ` + extras ${egp(extrasTotal - requiredTotal)}` : ''}
          {discount > 0 ? ` - reward ${egp(discount)}` : ''}
          {creditUse > 0 ? ` - your credit ${egp(creditUse)}` : ''}
        </Text>
      )}
      {err && <Text style={{ color: colors.danger, fontSize: 13 }}>{err}</Text>}
      <Button title={payLabel} onPress={openMode ? hostGame : book} loading={saving} disabled={pick.start === null} />
      {pick.start !== null && <Text style={{ color: colors.muted, fontSize: 12, textAlign: 'center' }}>{policyLine}</Text>}
    </View>
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
      <Pressable accessibilityRole="button" disabled={value <= min} onPress={() => onChange(value - 1)} style={[st.step, value <= min && { opacity: 0.3 }]}><Text style={st.stepText}>−</Text></Pressable>
      <Text style={{ color: colors.text, width: 28, textAlign: 'center' }}>{value}</Text>
      <Pressable accessibilityRole="button" disabled={value >= max} onPress={() => onChange(value + 1)} style={[st.step, value >= max && { opacity: 0.3 }]}><Text style={st.stepText}>+</Text></Pressable>
    </View>
  );
}


const useSt = themed(() => ({
  optPick: { flex: 1, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: 12, paddingVertical: 9, paddingHorizontal: 11, backgroundColor: colors.card },
  optPickOn: { borderWidth: 2, borderColor: colors.accent, backgroundColor: colors.soft },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: 14, marginVertical: 14, borderWidth: 1, borderColor: colors.border },
  step: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.cardAlt, alignItems: 'center' as const, justifyContent: 'center' as const },
  stepText: { color: colors.text, fontSize: 18, fontWeight: '700' as const },
}));

// the website's segmented control (zaf-seg): a label, then the options side by side
function Seg({ label, options, isOn, onPick }: { label: string; options: readonly (readonly [string, string])[]; isOn: (v: string) => boolean; onPick: (v: string) => void }) {
  useTheme();
  return (
    <View>
      <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>{label}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 3, padding: 3, borderRadius: 12, backgroundColor: colors.soft }}>
        {options.map(([v, l]) => {
          const on = isOn(v);
          return (
            <Pressable key={v} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => onPick(v)}
              style={{ flexGrow: 1, flexBasis: options.length > 3 ? '30%' : 0, minHeight: 36, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, backgroundColor: on ? colors.card : 'transparent', opacity: on ? 1 : 0.75 }}>
              <Text style={{ color: on ? colors.primary : colors.text, fontWeight: '700', fontSize: 13 }} numberOfLines={1}>{l}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
