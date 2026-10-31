import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Linking, Platform, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { Text } from '@/components/AppText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { colors, fonts, radius, themed } from '@/lib/theme';
import { countdown, dateLabel, egp, timeLabel } from '@/lib/format';
import {
  cancelSplitPreview, cleanInstapay, FREE_CHANGE_HOURS, FREE_CHANGE_MINUTES, freeChangeLeftMs, INSTAPAY_FEE_TEXT, INSTAPAY_HELP, isInstapay, isLate, REVIEW_MINUTES,
} from '@/lib/payment';
import { Button, Field, GradientFill, Note, EmptyState, Skeleton } from '@/components/ui';
import { RefundTracker, refundInfo } from '@/components/RefundTracker';
import { RefundChoice } from '@/components/RefundChoice';
import { PolicyNotice } from '@/components/PolicyNotice';
import { LoggedOutPeek } from '@/components/LoggedOutPeek';
import { SvgXml } from 'react-native-svg';
import { sportSvg } from '@/lib/sportIcons';

function IconBtn({ icon, label, color, onPress }: { icon: string; label: string; color: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={6} onPress={onPress} style={{ alignItems: 'center' }}>
      <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: colors.cardAlt, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color, fontSize: 16, fontWeight: '800' }}>{icon}</Text>
      </View>
      <Text style={{ color: colors.muted, fontSize: 10, marginTop: 3 }}>{label}</Text>
    </Pressable>
  );
}

type Tab = 'upcoming' | 'past' | 'cancelled';

const SELECT = `id,start_time,end_time,total_price,status,payment_status,hold_expires_at,amount_due,discount_amount,
  booking_extras(name,qty),open_games(id),credit_used,credit_issued,cancel_request_as_credit,rescheduled_from,credit_amount,
  retained_amount,refund_amount,refund_fee,refund_status,refund_as_credit,refund_to,refunded_at,refund_proof_path,cancel_request_status,cancel_request_decline_reason,cancel_requested_at,cancel_request_refund_to,
  cancelled_at,cancelled_by,cancellation_reason,created_at,confirmed_at,payments(created_at,status),
  sport:sports(name,slug),court:courts(id,name,is_indoor,maps_url,late_fee_percent,facility:facilities(name,city))`;

function badge(b: any, now: number): { label: string; color: string } {
  const ended = new Date(b.end_time).getTime() <= now;
  if (b.cancel_request_status === 'pending' && ['pending', 'confirmed'].includes(b.status)) return { label: 'cancellation pending', color: colors.warning };
  if (b.status === 'cancelled') return (b.cancellation_reason || '').startsWith('Rescheduled') ? { label: 'moved', color: colors.muted } : { label: 'cancelled', color: colors.danger };
  if (b.status === 'completed' || (b.status === 'confirmed' && ended)) return { label: 'played', color: colors.primaryAlt };
  if (b.status === 'no_show') return { label: 'no-show', color: colors.warning };
  if (b.status === 'pending' && b.payment_status === 'unpaid') return { label: 'awaiting payment', color: colors.warning };
  if (b.status === 'pending' && b.payment_status === 'pending_review') return { label: 'payment under review', color: colors.primaryAlt };
  return { label: b.status, color: colors.success };
}

export default function Bookings() {
  const s = useS();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { session, loading: authLoading } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [reviews, setReviews] = useState<Record<string, number>>({});
  const [phones, setPhones] = useState<Record<string, string>>({});
  const [receipts, setReceipts] = useState<Record<string, string>>({}); // refund_proof_path → signed url
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<Tab>('upcoming');
  const [now, setNow] = useState(Date.now());
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null); // tapped card shows court, price and links
  const [rateId, setRateId] = useState<string | null>(null);
  const uid = session?.user.id;

  const load = useCallback(async () => {
    if (!uid) { setLoading(false); return; }
    const { data } = await supabase.from('bookings').select(SELECT).eq('user_id', uid).eq('booking_source', 'player')
      .order('created_at', { ascending: false }).limit(100);
    // open games live in the Games tab
    setRows(((data ?? []) as any[]).filter((b) => !(Array.isArray(b.open_games) ? b.open_games.length : b.open_games)));
    const { data: revs } = await supabase.from('reviews').select('booking_id,rating').eq('user_id', uid);
    setReviews(Object.fromEntries((revs ?? []).map((r: any) => [r.booking_id, r.rating])));
    // the InstaPay receipt Zaf Play uploads when it sends a refund
    const proofs = ((data ?? []) as any[]).map((b) => b.refund_proof_path).filter(Boolean);
    if (proofs.length) {
      const { data: signed } = await supabase.storage.from('refund-proofs').createSignedUrls(proofs, 3600);
      setReceipts(Object.fromEntries((signed ?? []).filter((x: any) => x.signedUrl).map((x: any) => [x.path, x.signedUrl])));
    }
    const { data: ph } = await supabase.rpc('my_court_phones');
    setPhones(Object.fromEntries(((ph as any[]) ?? []).map((r) => [r.booking_id, r.phone])));
    setLoading(false);
    setRefreshing(false);
  }, [uid]);

  const loadRef = useRef(load);
  loadRef.current = load;
  useFocusEffect(useCallback(() => { load(); }, [load]));
  // tick every second only while a countdown is on screen (redrawing the list every second can swallow taps on Android)
  const ticking = rows.some((b) => (b.status === 'pending' && ['unpaid', 'pending_review'].includes(b.payment_status))
    || b.cancel_request_status === 'pending' || b.refund_status === 'due' || freeChangeLeftMs(b) > 0);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ticking ? 1000 : 30000); return () => clearInterval(t); }, [ticking]);
  // approvals, refunds and cancellations show up without pulling down
  useEffect(() => {
    if (!uid) return;
    // a fresh name every time: removeChannel is async, so reusing a name hands back the old, already-subscribed channel
    const ch = supabase.channel(`my-bookings-${uid}-${Date.now()}`)
      .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'bookings', filter: `user_id=eq.${uid}` }, () => loadRef.current())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [uid]);

  const holdExpired = (b: any) => b.status === 'pending' && b.payment_status === 'unpaid' && b.hold_expires_at && new Date(b.hold_expires_at).getTime() <= now;
  const requestOpen = (b: any) => b.cancel_request_status === 'pending' && ['pending', 'confirmed'].includes(b.status);
  // bookings that already have a move to a new time waiting for payment
  const pendingChangeFor = useMemo(() => new Set(rows.filter((x) => x.rescheduled_from && x.status === 'pending' && !holdExpired(x)).map((x) => x.rescheduled_from)), [rows, now]); // eslint-disable-line react-hooks/exhaustive-deps
  const lists = useMemo(() => ({
    upcoming: rows.filter((b) => ['pending', 'confirmed'].includes(b.status) && new Date(b.end_time).getTime() > now && !holdExpired(b) && !requestOpen(b)),
    past: rows.filter((b) => ['confirmed', 'completed', 'no_show'].includes(b.status) && new Date(b.end_time).getTime() <= now && !requestOpen(b)),
    cancelled: rows.filter((b) => b.status === 'cancelled' || holdExpired(b) || requestOpen(b)),
  }), [rows, now]); // eslint-disable-line react-hooks/exhaustive-deps

  async function withdraw(b: any) {
    const { error } = await supabase.rpc('withdraw_cancellation_request', { p_booking_id: b.id });
    if (error) return Alert.alert('Could not withdraw', error.message);
    setTab('upcoming');
    Alert.alert('Request withdrawn', 'Your booking stays as it is.');
    load();
  }

  if (authLoading || (uid && loading)) return <Skeleton />;
  if (!uid) {
    return (
      <LoggedOutPeek onLogin={() => router.navigate('/(tabs)/(profile)/profile')} />
    );
  }

  const tabs: [Tab, string][] = [['upcoming', 'Upcoming'], ['past', 'Played'], ['cancelled', 'Cancelled']];

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={insets.top + (Platform.OS === 'ios' ? 44 : 56)}>
    <FlatList
      data={lists[tab]}
      removeClippedSubviews={false}
      keyboardShouldPersistTaps="handled"
      keyExtractor={(r) => r.id}
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 16 }}
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.primary} onRefresh={() => { setRefreshing(true); load(); }} />}
      ListHeaderComponent={
        <View style={{ flexDirection: 'row', marginBottom: 14 }}>
          {tabs.map(([t, label]) => (
            <Pressable accessibilityRole="button" key={t} onPress={() => { setTab(t); setCancelId(null); }} style={[s.tab, tab === t && s.tabOn]}>
              {tab === t && <GradientFill />}
              <Text style={{ color: tab === t ? '#fff' : colors.muted, fontWeight: '600' }}>{label} ({lists[t].length})</Text>
            </Pressable>
          ))}
        </View>
      }
      ListEmptyComponent={tab === 'upcoming'
        ? <EmptyState icon="calendar" title="No upcoming bookings" text="Find a court near you and book your next game in a minute." action="Find a court" onAction={() => router.push('/(tabs)/(play)')} />
        : <EmptyState icon="clock" title={tab === 'past' ? 'No played games yet' : 'No cancelled bookings'} text={tab === 'past' ? 'Games you play show up here.' : 'Good news, nothing was cancelled.'} />}
      renderItem={({ item: b }) => {
        const bd = badge(holdExpired(b) ? { ...b, status: 'cancelled' } : b, now);
        const paidUpcoming = ['pending', 'confirmed'].includes(b.status) && b.payment_status === 'paid' && new Date(b.start_time).getTime() > now;
        const awaiting = b.status === 'pending' && b.payment_status === 'unpaid' && !holdExpired(b);
        const review = b.status === 'pending' && b.payment_status === 'pending_review';
        const canCancel = ['pending', 'confirmed'].includes(b.status) && new Date(b.start_time).getTime() > now && !holdExpired(b) && !requestOpen(b);
        const holdLeft = b.hold_expires_at ? new Date(b.hold_expires_at).getTime() - now : null;
        const sentAt = (b.payments ?? []).filter((x: any) => x.status === 'pending').map((x: any) => new Date(x.created_at).getTime()).sort((x: number, y: number) => y - x)[0];
        const reviewLeft = sentAt ? sentAt + REVIEW_MINUTES * 60000 - now : null;
        const refundAmt = Number(b.refund_amount || 0);
        // money involved in a cancellation (or a request): the website's step-by-step refund tracker
        const tracked = (requestOpen(b) || (b.status === 'cancelled' && !(b.cancellation_reason || '').startsWith('Rescheduled'))) && !!refundInfo(b);
        let summary: string | null = null;
        if (holdExpired(b)) summary = 'Time released, the payment was not received';
        else if (b.status === 'cancelled') {
          if ((b.cancellation_reason || '').startsWith('Rescheduled')) summary = `${b.cancellation_reason}.`;
          else if (refundAmt > 0) summary = `Cancelled · refund of ${egp(refundAmt)} ${b.refund_status === 'refunded' ? 'sent ✅' : 'on its way'}${Number(b.credit_issued) > 0 ? ` + ${egp(b.credit_issued)} added to your credit` : ''}`;
          else if (Number(b.credit_issued) > 0) summary = `Cancelled · ${egp(b.credit_issued)} added to your credit ✅`;
          else if (Number(b.retained_amount) > 0) summary = 'Cancelled · no refund (late cancellation fee kept)';
          else summary = `Cancelled${b.cancelled_by === 'owner' ? ' by the court owner' : b.cancelled_by === 'player' ? ' by you' : ''}`;
        } else if (requestOpen(b)) summary = b.cancel_request_as_credit ? 'Cancellation requested, credit added after review' : 'Cancellation requested, refund within 1 hour after review';
        else if (b.status === 'no_show') summary = 'The court marked this booking as a no-show';

        return (
          <View style={s.card}>
            {/* compact card: sport square, title, time, status pill and the main actions as icon buttons */}
            <Pressable accessibilityRole="button" onPress={() => setOpenId(openId === b.id ? null : b.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={s.sq}>
                {(() => { const xml = sportSvg(b.sport?.slug, { ic: colors.text, a: colors.brandPinkBright, b: colors.primary, cut: colors.cardAlt }); return xml ? <SvgXml xml={xml} width={36} height={36} /> : <Text style={{ fontSize: 24 }}>🏟</Text>; })()}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.title} numberOfLines={1}>{b.sport?.name}</Text>
                <Text style={[s.sub, { fontSize: 12, color: colors.text }]} numberOfLines={1}>{b.court?.facility?.name ?? b.court?.name}</Text>
                <Text style={[s.sub, { fontSize: 12, marginTop: 1 }]} numberOfLines={1}>{dateLabel(b.start_time)}</Text>
                <Text style={[s.sub, { fontSize: 12, marginTop: 1, color: colors.text }]} numberOfLines={1}>{timeLabel(b.start_time)} → {timeLabel(b.end_time)}</Text>
              </View>
              <View style={{ alignItems: 'center' }}>
                <View style={{ alignSelf: 'stretch', alignItems: 'center', borderRadius: 999, backgroundColor: bd.color + '22', paddingHorizontal: 10, paddingVertical: 3, marginBottom: 6 }}>
                  <Text style={{ color: bd.color, fontSize: 12, fontWeight: '700', textTransform: 'capitalize' }}>{bd.label}</Text>
                </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {awaiting && <IconBtn icon="💳" label="Pay" color={colors.brandPinkBright} onPress={() => router.push({ pathname: '/pay/[id]', params: { id: b.id } })} />}
                {paidUpcoming && !requestOpen(b) && !pendingChangeFor.has(b.id) && <IconBtn icon="✏️" label="Modify" color={colors.primaryAlt} onPress={() => router.push({ pathname: '/change/[id]', params: { id: b.id } })} />}
                {canCancel && <IconBtn icon="✕" label="Cancel" color={colors.danger} onPress={() => setCancelId(cancelId === b.id ? null : b.id)} />}
                {b.status !== 'cancelled' && new Date(b.end_time).getTime() > now && b.court?.maps_url && <IconBtn icon="📍" label="Map" color={colors.primaryAlt} onPress={() => Linking.openURL(b.court.maps_url)} />}
                {tab === 'past' && b.court?.id && <IconBtn icon="🏟" label="Court" color={colors.primaryAlt} onPress={() => router.push({ pathname: '/court/[id]', params: { id: b.court.id } })} />}
                {tab === 'past' && b.payment_status === 'paid' && ['confirmed', 'completed'].includes(b.status) && !reviews[b.id] && <IconBtn icon="⭐" label="Rate" color={colors.warning} onPress={() => setRateId(rateId === b.id ? null : b.id)} />}
              </View>
              </View>
            </Pressable>
            {awaiting && <Text style={{ color: colors.brandPinkBright, marginTop: 10, fontWeight: '600', fontSize: 13 }}>Send {egp(b.amount_due)} by InstaPay{holdLeft !== null ? ` · ${countdown(holdLeft)} left` : ''}</Text>}
            {openId === b.id && (
              <View style={{ marginTop: 10, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 }}>
                <Text style={s.sub}>{b.court?.name} · {b.court?.is_indoor ? 'Indoor' : 'Outdoor'}{b.court?.facility?.city ? ` · ${b.court.facility.city}` : ''} · {timeLabel(b.start_time)} – {timeLabel(b.end_time)}</Text>
                <Text style={{ color: colors.text, fontWeight: '700', marginTop: 4 }}>{egp(Number(b.total_price) - Number(b.discount_amount || 0))}</Text>
                {(b.booking_extras ?? []).length > 0 && <Text style={s.sub}>Extras: {b.booking_extras.map((x: any) => `${x.name} × ${x.qty}`).join(', ')}</Text>}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
                  {b.court?.id && <Pressable accessibilityRole="button" hitSlop={10} style={s.action} onPress={() => router.push({ pathname: '/court/[id]', params: { id: b.court.id } })}><Text style={s.link}>View court</Text></Pressable>}
                  {tab !== 'past' && b.court?.maps_url && <Pressable accessibilityRole="button" hitSlop={10} style={s.action} onPress={() => Linking.openURL(b.court.maps_url)}><Text style={s.link}>📍 Directions</Text></Pressable>}
                </View>
              </View>
            )}

            {summary && !tracked && <Text style={{ color: colors.warning, marginTop: 10 }}>{summary}</Text>}
            {tracked && (
              <RefundTracker b={b} now={now} proofUrl={b.refund_proof_path ? receipts[b.refund_proof_path] : undefined}
                onWithdraw={requestOpen(b) ? () => withdraw(b) : undefined} />
            )}
            {!requestOpen(b) && <RefundChoice b={b} onChanged={load} />}
            {pendingChangeFor.has(b.id) && <Text style={{ color: colors.warning, marginTop: 10 }}>A change to a new time is waiting for payment. This booking stays until it's approved.</Text>}
            {requestOpen(b) && !tracked && <Pressable accessibilityRole="button" onPress={() => withdraw(b)}><Text style={s.link}>Withdraw request</Text></Pressable>}
            {b.cancel_request_status === 'declined' && ['pending', 'confirmed'].includes(b.status) && (
              <Text style={{ color: colors.danger, marginTop: 8 }}>Your cancellation request was declined{b.cancel_request_decline_reason ? `: ${b.cancel_request_decline_reason}` : '.'} Your booking stays as it is.</Text>
            )}

            {review && !requestOpen(b) && (
              <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/pay/[id]', params: { id: b.id } })} style={s.review}>
                <Text style={{ color: colors.text, flex: 1 }}>⏳ We received your payment screenshot. It will be approved within {REVIEW_MINUTES} minutes.</Text>
                <View style={{ alignItems: 'flex-end' }}>
                  {reviewLeft !== null && reviewLeft > 0 ? (
                    <>
                      <Text style={{ color: colors.muted, fontSize: 12 }}>approval within</Text>
                      <Text style={{ color: colors.primaryAlt, fontWeight: '800', fontSize: 20, fontVariant: ['tabular-nums'] }}>{countdown(reviewLeft)}</Text>
                    </>
                  ) : (
                    <Text style={{ color: colors.muted, fontSize: 12, maxWidth: 110, textAlign: 'right' }}>Taking a little longer, we're on it</Text>
                  )}
                </View>
              </Pressable>
            )}

            {/* the first minutes after confirmation: the date / time can be changed for free */}
            {paidUpcoming && b.status === 'confirmed' && !requestOpen(b) && !pendingChangeFor.has(b.id) && freeChangeLeftMs(b, now) > 0 && (
              <View style={s.free}>
                <Text style={{ color: colors.text, flex: 1, fontSize: 13 }}>
                  ⏱ Free change for <Text style={{ fontWeight: '800', fontVariant: ['tabular-nums'] }}>{countdown(freeChangeLeftMs(b, now))}</Text> more, no late fee in the first {FREE_CHANGE_MINUTES} minutes, even if your game is close.
                </Text>
                <Button small title="Change" onPress={() => router.push({ pathname: '/change/[id]', params: { id: b.id } })} />
              </View>
            )}

            {cancelId === b.id && <CancelBox b={b} onClose={() => setCancelId(null)} onDone={(toCancelled) => { setCancelId(null); if (toCancelled) setTab('cancelled'); load(); }} />}

            {tab === 'past' && b.payment_status === 'paid' && ['confirmed', 'completed'].includes(b.status) && (
              reviews[b.id] ? (
                <Text style={{ color: colors.warning, marginTop: 8, fontSize: 12 }}>Your rating {'★'.repeat(reviews[b.id])}{'☆'.repeat(5 - reviews[b.id])}</Text>
              ) : rateId === b.id ? (
                <Rate bookingId={b.id} onDone={() => { setRateId(null); load(); }} onClose={() => setRateId(null)} />
              ) : null
            )}

            {phones[b.id] && b.status !== 'cancelled' && !requestOpen(b) && (
              <Pressable accessibilityRole="button" onPress={() => Linking.openURL(`tel:${phones[b.id]}`)} style={{ marginTop: 12 }}>
                <Text numberOfLines={1} style={{ color: colors.success, fontSize: 12 }}>📞 Call the court: {phones[b.id]}</Text>
              </Pressable>
            )}
            {!phones[b.id] && paidUpcoming && !requestOpen(b) && (
              <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 11, marginTop: 8 }}>📞 Court phone shows 30 min before your game</Text>
            )}
          </View>
        );
      }}
    />
    </KeyboardAvoidingView>
  );
}

function Rate({ bookingId, onDone, onClose }: { bookingId: string; onDone: () => void; onClose: () => void }) {
  const s = useS();
  const [stars, setStars] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function save() {
    if (stars < 1) return setErr('Please choose 1 to 5 stars.');
    setBusy(true);
    const { error } = await supabase.rpc('submit_review', { p_booking_id: bookingId, p_rating: stars });
    setBusy(false);
    if (error) return setErr(error.message);
    onDone();
  }
  return (
    <View style={s.box}>
      <Text style={{ color: colors.text, fontWeight: '600' }}>How was this court?</Text>
      <View style={{ flexDirection: 'row', marginVertical: 8 }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable accessibilityRole="button" key={n} onPress={() => setStars(n)}><Text style={{ fontSize: 34, color: n <= stars ? colors.warning : colors.border }}>★</Text></Pressable>
        ))}
      </View>
      <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 8 }}>Your rating can't be changed after you save it.</Text>
      {err && <Note kind="error">{err}</Note>}
      <Button title="Save rating" onPress={save} loading={busy} />
      <Pressable accessibilityRole="button" onPress={onClose}><Text style={[s.link, { textAlign: 'center' }]}>Cancel</Text></Pressable>
    </View>
  );
}

function CancelBox({ b, onClose, onDone }: { b: any; onClose: () => void; onDone: (toCancelled: boolean) => void }) {
  const s = useS();
  const [reason, setReason] = useState('');
  const [refundTo, setRefundTo] = useState('');
  const [asCredit, setAsCredit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const underReview = b.status === 'pending' && b.payment_status === 'pending_review';
  const moneySent = b.payment_status === 'paid' || underReview;
  const fee = Number(b.court?.late_fee_percent ?? 50);
  // a move to a new time that isn't approved yet: only the extra amount was sent, no late fee
  const isMove = !!b.rescheduled_from && underReview;
  const late = isMove ? false : isLate(b.start_time);
  const p = cancelSplitPreview(isMove ? Number(b.amount_due) : Number(b.total_price) - Number(b.discount_amount || 0), fee, late, isMove ? 0 : Number(b.credit_used || 0));
  const cancelRefund = moneySent && !asCredit ? p.refund : 0;
  const creditOnly = moneySent && p.refund <= 0 && p.creditBack > 0;
  const canChooseCredit = moneySent && p.value > 0 && !creditOnly;
  // the refund number was saved when the booking was paid; only an old booking without one asks again
  const needsNumber = cancelRefund > 0 && !b.refund_to;

  async function send() {
    setErr(null);
    if (needsNumber && !isInstapay(refundTo)) return setErr(`Your InstaPay for the refund: ${INSTAPAY_HELP}`);
    setBusy(true);
    const { data, error } = await supabase.rpc('request_cancellation', {
      p_booking_id: b.id, p_reason: reason, p_refund_to: needsNumber ? refundTo : null, ...(asCredit ? { p_as_credit: true } : {}),
    });
    setBusy(false);
    if (error) return setErr(error.message);
    Alert.alert(
      (data as any)?.cancelled ? 'Booking cancelled' : 'Request submitted, pending review',
      (data as any)?.cancelled
        ? "You hadn't paid, so nothing was charged."
        : asCredit ? 'Once Zaf Play approves it, the money is added to your credit.' : 'Follow your refund in the Cancelled list. Expect it within 1 hour.',
    );
    onDone(true);
  }

  return (
    <View style={s.box}>
      <Text style={{ color: colors.text, fontWeight: '700' }}>{moneySent ? 'Ask Zaf Play to cancel this booking?' : 'Cancel this booking?'}</Text>
      {moneySent ? (
        <View style={{ marginTop: 8 }}>
          <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 8 }}>Zaf Play reviews every request, then sends your refund by InstaPay within 1 hour or adds it to your credit. Amounts are worked out from the time you ask.</Text>
          <Text style={{ color: late ? colors.danger : colors.success }}>
            {late ? `Your game starts in less than ${FREE_CHANGE_HOURS} hours:\n• ${fee}% kept as a fee: ${egp(p.kept)}` : 'Free cancellation, no cancellation fee.'}
            {asCredit
              ? `\n• No InstaPay transfer fee when you keep it as credit\n• You get ${egp(p.allAsCredit)} as credit`
              : `${p.creditBack > 0 ? `\n• ${egp(p.creditBack)} paid with credit goes back to your credit` : ''}${p.refund > 0 ? `\n• InstaPay transfer fee (${INSTAPAY_FEE_TEXT}): ${egp(p.transferFee)}\n• You get back ${egp(p.refund)}` : p.creditBack > 0 ? `\n• You get ${egp(p.creditBack)} as credit` : '\n• Nothing to refund'}`}
          </Text>
        </View>
      ) : (
        <Text style={{ color: colors.muted, marginTop: 8 }}>You haven't paid yet, so nothing will be charged.</Text>
      )}

      {canChooseCredit && (
        <View style={{ marginTop: 12 }}>
          <Text style={{ color: colors.text, marginBottom: 6 }}>How would you like your money back?</Text>
          {[[false, 'To my InstaPay', 'Zaf Play sends it within 1 hour (the InstaPay fee comes out of it).'], [true, 'Keep it as Zaf Play credit', 'No transfer fee. It is taken off your next booking automatically.']].map(([v, t, d]: any) => (
            <Pressable accessibilityRole="button" key={String(v)} onPress={() => setAsCredit(v)} style={[s.choice, asCredit === v && { borderColor: colors.accent }]}>
              <Text style={{ color: colors.text, fontWeight: '600' }}>{asCredit === v ? '◉ ' : '○ '}{t}</Text>
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>{d}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {cancelRefund > 0 && b.refund_to ? <Text style={{ color: colors.muted, marginTop: 10 }}>Your refund will be sent to the InstaPay you gave when booking: {b.refund_to}</Text> : null}
      {needsNumber && (
        <View style={{ marginTop: 10 }}>
          <Field label="Your InstaPay for the refund" value={refundTo} onChangeText={(v) => setRefundTo(cleanInstapay(v))} placeholder="e.g. 01012345678" keyboardType="number-pad" maxLength={11} />
        </View>
      )}
      <View style={{ marginTop: 10 }}><Field label="Reason (optional)" value={reason} onChangeText={setReason} /></View>
      <PolicyNotice feePercent={fee} showPayment={false} />
      {err && <Note kind="error">{err}</Note>}
      <Button title={moneySent ? 'Send cancellation request' : 'Yes, cancel it'} onPress={send} loading={busy} />
      <Pressable accessibilityRole="button" onPress={onClose}><Text style={[s.link, { textAlign: 'center' }]}>Keep my booking</Text></Pressable>
    </View>
  );
}

const useS = themed(() => StyleSheet.create({
  tab: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.lg, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, marginRight: 8 },
  tabOn: { borderColor: 'transparent', overflow: 'hidden' },
  card: { backgroundColor: colors.card, borderRadius: 20, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: colors.border },
  sq: { width: 56, height: 56, borderRadius: 14, overflow: 'hidden', backgroundColor: colors.cardAlt, alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.text, fontWeight: '700', fontSize: 15 },
  sub: { color: colors.muted, marginTop: 3 },
  link: { color: colors.primaryAlt, fontWeight: '600', marginTop: 8 },
  action: { paddingVertical: 4, paddingRight: 4 },
  free: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10, padding: 12, borderRadius: radius.md,
    backgroundColor: 'rgba(46,211,160,0.1)', borderWidth: 1, borderColor: colors.success,
  },
  review: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10, padding: 12, borderRadius: radius.md,
    backgroundColor: colors.soft, borderWidth: 1, borderColor: colors.borderStrong,
  },
  box: { backgroundColor: colors.cardAlt, borderRadius: radius.md, padding: 12, marginTop: 12 },
  choice: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 10, marginBottom: 8 },
}));
