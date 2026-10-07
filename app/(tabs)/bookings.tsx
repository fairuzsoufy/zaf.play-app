import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Linking, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { colors, radius } from '@/lib/theme';
import { countdown, dateLabel, egp, timeLabel } from '@/lib/format';
import {
  cancelSplitPreview, cleanInstapay, FREE_CHANGE_HOURS, INSTAPAY_FEE_TEXT, INSTAPAY_HELP, isInstapay, isLate, REVIEW_MINUTES,
} from '@/lib/payment';
import { Button, Field, Note } from '@/components/ui';

type Tab = 'upcoming' | 'past' | 'cancelled';

const SELECT = `id,start_time,end_time,total_price,status,payment_status,hold_expires_at,amount_due,discount_amount,
  booking_extras(name,qty),open_games(id),credit_used,credit_issued,cancel_request_as_credit,rescheduled_from,credit_amount,
  retained_amount,refund_amount,refund_fee,refund_status,refund_to,refunded_at,cancel_request_status,cancel_request_decline_reason,
  cancelled_at,cancelled_by,cancellation_reason,created_at,
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
  const router = useRouter();
  const { session, loading: authLoading } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [reviews, setReviews] = useState<Record<string, number>>({});
  const [phones, setPhones] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<Tab>('upcoming');
  const [now, setNow] = useState(Date.now());
  const [cancelId, setCancelId] = useState<string | null>(null);
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
    const { data: ph } = await supabase.rpc('my_court_phones');
    setPhones(Object.fromEntries(((ph as any[]) ?? []).map((r) => [r.booking_id, r.phone])));
    setLoading(false);
    setRefreshing(false);
  }, [uid]);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  // approvals, refunds and cancellations show up without pulling down
  useEffect(() => {
    if (!uid) return;
    const ch = supabase.channel(`my-bookings-${uid}`)
      .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'bookings', filter: `user_id=eq.${uid}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [uid, load]);

  const holdExpired = (b: any) => b.status === 'pending' && b.payment_status === 'unpaid' && b.hold_expires_at && new Date(b.hold_expires_at).getTime() <= now;
  const requestOpen = (b: any) => b.cancel_request_status === 'pending' && ['pending', 'confirmed'].includes(b.status);
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

  if (authLoading || (uid && loading)) return <ActivityIndicator style={{ marginTop: 60 }} color={colors.primary} />;
  if (!uid) {
    return (
      <View style={{ padding: 24 }}>
        <Text style={{ color: colors.muted, marginBottom: 16 }}>Log in to see your bookings.</Text>
        <Button title="Log in" onPress={() => router.push('/login')} />
      </View>
    );
  }

  const tabs: [Tab, string][] = [['upcoming', 'Upcoming'], ['past', 'Played'], ['cancelled', 'Cancelled']];

  return (
    <FlatList
      data={lists[tab]}
      keyExtractor={(r) => r.id}
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 16 }}
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.primary} onRefresh={() => { setRefreshing(true); load(); }} />}
      ListHeaderComponent={
        <View style={{ flexDirection: 'row', marginBottom: 14 }}>
          {tabs.map(([t, label]) => (
            <Pressable key={t} onPress={() => { setTab(t); setCancelId(null); }} style={[s.tab, tab === t && s.tabOn]}>
              <Text style={{ color: tab === t ? '#fff' : colors.muted, fontWeight: '600' }}>{label} ({lists[t].length})</Text>
            </Pressable>
          ))}
        </View>
      }
      ListEmptyComponent={<Text style={{ color: colors.muted, textAlign: 'center', marginTop: 40 }}>{tab === 'upcoming' ? 'No upcoming bookings.' : 'Nothing here yet.'}</Text>}
      renderItem={({ item: b }) => {
        const bd = badge(holdExpired(b) ? { ...b, status: 'cancelled' } : b, now);
        const paidUpcoming = ['pending', 'confirmed'].includes(b.status) && b.payment_status === 'paid' && new Date(b.start_time).getTime() > now;
        const awaiting = b.status === 'pending' && b.payment_status === 'unpaid' && !holdExpired(b);
        const review = b.status === 'pending' && b.payment_status === 'pending_review';
        const canCancel = ['pending', 'confirmed'].includes(b.status) && new Date(b.start_time).getTime() > now && !holdExpired(b) && !requestOpen(b);
        const holdLeft = b.hold_expires_at ? new Date(b.hold_expires_at).getTime() - now : null;
        const refundAmt = Number(b.refund_amount || 0);
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
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={s.title}>{b.court?.name}</Text>
                <Text style={s.sub}>{b.sport?.name} · {b.court?.is_indoor ? 'Indoor' : 'Outdoor'} · {b.court?.facility?.name}{b.court?.facility?.city ? `, ${b.court.facility.city}` : ''}</Text>
                <Text style={[s.sub, { color: colors.text, marginTop: 6 }]}>{dateLabel(b.start_time)} · {timeLabel(b.start_time)} – {timeLabel(b.end_time)}</Text>
                <Text style={{ color: colors.text, fontWeight: '700', marginTop: 4 }}>{egp(Number(b.total_price) - Number(b.discount_amount || 0))}</Text>
                {(b.booking_extras ?? []).length > 0 && <Text style={s.sub}>Extras: {b.booking_extras.map((x: any) => `${x.name} × ${x.qty}`).join(', ')}</Text>}
              </View>
              <Text style={{ color: bd.color, fontSize: 12, fontWeight: '700', textTransform: 'capitalize' }}>{bd.label}</Text>
            </View>

            {summary && <Text style={{ color: colors.warning, marginTop: 10 }}>{summary}</Text>}
            {requestOpen(b) && <Pressable onPress={() => withdraw(b)}><Text style={s.link}>Withdraw request</Text></Pressable>}
            {b.cancel_request_status === 'declined' && ['pending', 'confirmed'].includes(b.status) && (
              <Text style={{ color: colors.danger, marginTop: 8 }}>Your cancellation request was declined{b.cancel_request_decline_reason ? `: ${b.cancel_request_decline_reason}` : '.'} Your booking stays as it is.</Text>
            )}

            {awaiting && (
              <View style={{ marginTop: 10 }}>
                <Text style={{ color: colors.warning, marginBottom: 8 }}>Send {egp(b.amount_due)} by InstaPay{holdLeft !== null ? ` · ${countdown(holdLeft)} left` : ''}</Text>
                <Button title="Pay now" onPress={() => router.push({ pathname: '/pay/[id]', params: { id: b.id } })} />
              </View>
            )}
            {review && !requestOpen(b) && (
              <Pressable onPress={() => router.push({ pathname: '/pay/[id]', params: { id: b.id } })}>
                <Text style={{ color: colors.primaryAlt, marginTop: 10 }}>⏳ Payment is being checked, approval within {REVIEW_MINUTES} minutes →</Text>
              </Pressable>
            )}

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginTop: 12 }}>
              {b.court?.id && <Pressable onPress={() => router.push({ pathname: '/court/[id]', params: { id: b.court.id } })}><Text style={s.link}>View court</Text></Pressable>}
              {b.court?.maps_url && <Pressable onPress={() => Linking.openURL(b.court.maps_url)}><Text style={s.link}>📍 Directions</Text></Pressable>}
              {canCancel && cancelId !== b.id && (
                <Pressable onPress={() => setCancelId(b.id)}><Text style={[s.link, { color: colors.danger }]}>{awaiting ? 'Cancel booking' : 'Request cancellation'}</Text></Pressable>
              )}
            </View>

            {cancelId === b.id && <CancelBox b={b} onClose={() => setCancelId(null)} onDone={(toCancelled) => { setCancelId(null); if (toCancelled) setTab('cancelled'); load(); }} />}

            {tab === 'past' && b.payment_status === 'paid' && ['confirmed', 'completed'].includes(b.status) && (
              reviews[b.id] ? (
                <Text style={{ color: colors.warning, marginTop: 10, textAlign: 'center' }}>Your rating {'★'.repeat(reviews[b.id])}{'☆'.repeat(5 - reviews[b.id])}</Text>
              ) : rateId === b.id ? (
                <Rate bookingId={b.id} onDone={() => { setRateId(null); load(); }} onClose={() => setRateId(null)} />
              ) : (
                <View style={{ marginTop: 10 }}><Button title="⭐ Rate this court" variant="ghost" onPress={() => setRateId(b.id)} /></View>
              )
            )}

            {phones[b.id] && b.status !== 'cancelled' && !requestOpen(b) && (
              <Pressable onPress={() => Linking.openURL(`tel:${phones[b.id]}`)} style={{ marginTop: 12 }}>
                <Text style={{ color: colors.success }}>📞 Need help on court? Call {phones[b.id]}</Text>
              </Pressable>
            )}
            {!phones[b.id] && paidUpcoming && !requestOpen(b) && (
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: 10 }}>📞 The court's phone number shows here 30 minutes before your game.</Text>
            )}
          </View>
        );
      }}
    />
  );
}

function Rate({ bookingId, onDone, onClose }: { bookingId: string; onDone: () => void; onClose: () => void }) {
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
          <Pressable key={n} onPress={() => setStars(n)}><Text style={{ fontSize: 34, color: n <= stars ? colors.warning : colors.border }}>★</Text></Pressable>
        ))}
      </View>
      <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 8 }}>Your rating can't be changed after you save it.</Text>
      {err && <Note kind="error">{err}</Note>}
      <Button title="Save rating" onPress={save} loading={busy} />
      <Pressable onPress={onClose}><Text style={[s.link, { textAlign: 'center' }]}>Cancel</Text></Pressable>
    </View>
  );
}

function CancelBox({ b, onClose, onDone }: { b: any; onClose: () => void; onDone: (toCancelled: boolean) => void }) {
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
            <Pressable key={String(v)} onPress={() => setAsCredit(v)} style={[s.choice, asCredit === v && { borderColor: colors.primary }]}>
              <Text style={{ color: colors.text, fontWeight: '600' }}>{asCredit === v ? '◉ ' : '○ '}{t}</Text>
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>{d}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {cancelRefund > 0 && b.refund_to ? <Text style={{ color: colors.muted, marginTop: 10 }}>Your refund will be sent to the InstaPay you gave when booking: {b.refund_to}</Text> : null}
      {needsNumber && (
        <View style={{ marginTop: 10 }}>
          <Field label="Your InstaPay for the refund" value={refundTo} onChangeText={(v) => setRefundTo(cleanInstapay(v))} placeholder="e.g. 01012345678" autoCapitalize="none" />
        </View>
      )}
      <View style={{ marginTop: 10 }}><Field label="Reason (optional)" value={reason} onChangeText={setReason} /></View>
      {err && <Note kind="error">{err}</Note>}
      <Button title={moneySent ? 'Send cancellation request' : 'Yes, cancel it'} onPress={send} loading={busy} />
      <Pressable onPress={onClose}><Text style={[s.link, { textAlign: 'center' }]}>Keep my booking</Text></Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  tab: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.lg, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, marginRight: 8 },
  tabOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: colors.border },
  title: { color: colors.text, fontSize: 16, fontWeight: '700' },
  sub: { color: colors.muted, marginTop: 3 },
  link: { color: colors.primaryAlt, fontWeight: '600', marginTop: 8 },
  box: { backgroundColor: colors.cardAlt, borderRadius: radius.md, padding: 12, marginTop: 12 },
  choice: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 10, marginBottom: 8 },
});
