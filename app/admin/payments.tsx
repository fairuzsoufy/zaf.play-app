import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { Stack, useFocusEffect } from 'expo-router';
import { Text } from '@/components/AppText';
import { supabase } from '@/lib/supabase';
import { egp } from '@/lib/format';
import { REVIEW_MINUTES } from '@/lib/payment';
import { ago, BOOKING_FIELDS, signedUrls, slotText, splitProofs, withSnapshot } from '@/lib/admin';
import { colors } from '@/lib/theme';
import { Card, Countdown, Line, ProofImages } from '@/components/admin';
import { PlayerHistory } from '@/components/PlayerHistory';
import { Chip, H2, LinkButton, Loading, Muted, Pager, PAGE_SIZE } from '@/components/owner';
import { Button, Field, Note } from '@/components/ui';

const snapPay = (p: any) => (p ? { ...p, booking: withSnapshot(p.booking) } : p);

// what the player's price is made of: court time, extras, discount, credit, and what they paid by InstaPay
function PriceBreakdown({ p, pending = false }: { p: any; pending?: boolean }) {
  const b = p.booking;
  if (!b) return null;
  const extras: any[] = b.booking_extras || [];
  const amt = (x: any) => Number(x.amount ?? Number(x.unit_price || 0) * Number(x.qty || 1));
  const extrasTotal = extras.reduce((s, x) => s + amt(x), 0);
  const total = Number(b.total_price || 0);
  const discount = Number(b.discount_amount || 0);
  const carried = b.rescheduled_from ? Number(b.credit_amount || 0) : 0;
  const credit = Number(b.credit_used || 0);
  const Row = ({ l, r, tone, bold }: { l: string; r: string; tone?: 'ok'; bold?: boolean }) => (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
      <Text style={{ color: tone ? colors.success : colors.text, fontSize: 12, fontWeight: bold ? '700' : '400', flex: 1 }}>{l}</Text>
      <Text style={{ color: tone ? colors.success : colors.text, fontSize: 12, fontWeight: bold ? '700' : '400' }}>{r}</Text>
    </View>
  );
  return (
    <View style={{ backgroundColor: colors.cardAlt, borderRadius: 8, padding: 8, marginTop: 6 }}>
      <Row l="Court time" r={egp(Math.max(0, total - extrasTotal))} />
      {extras.map((x, i) => <Row key={i} l={`${x.name} × ${x.qty}`} r={egp(amt(x))} />)}
      {(extras.length > 0 || discount > 0 || carried > 0 || credit > 0) && <Row bold l="Total price" r={egp(total)} />}
      {discount > 0 && <Row tone="ok" l="Referral discount" r={`− ${egp(discount)}`} />}
      {carried > 0 && <Row tone="ok" l="Carried over from the old booking" r={`− ${egp(carried)}`} />}
      {credit > 0 && <Row tone="ok" l="Paid with credit" r={`− ${egp(credit)}`} />}
      <Row bold l={pending ? 'Left to pay: check the screenshot shows' : 'Paid by InstaPay'} r={egp(p.amount)} />
    </View>
  );
}

const place = (b: any) => `${b?.court?.facility?.name ? `${b.court.facility.name} — ` : ''}${b?.court?.name || ''}`;

// Payment approvals, like the website's /admin: InstaPay screenshots to check, players still paying, and what was reviewed.
export default function AdminPayments() {
  const [pending, setPending] = useState<any[] | null>(null);
  const [recent, setRecent] = useState<any[]>([]);
  const [holds, setHolds] = useState<any[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [court, setCourt] = useState('all');
  const [page, setPage] = useState(1);
  const [recentPage, setRecentPage] = useState(1);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [p, r, h] = await Promise.all([
      supabase.from('payments').select(`id, amount, kind, proof_path, created_at, booking:bookings ( ${BOOKING_FIELDS}, status, discount_amount, credit_used, booking_extras ( name, qty, unit_price, amount ) )`)
        .eq('status', 'pending').order('created_at', { ascending: true }),
      supabase.from('payments').select(`id, amount, kind, status, reject_reason, reviewed_at, booking:bookings ( ${BOOKING_FIELDS}, discount_amount, credit_used, booking_extras ( name, qty, unit_price, amount ) )`)
        .in('status', ['approved', 'rejected']).order('reviewed_at', { ascending: false }).limit(200),
      supabase.from('bookings').select(`${BOOKING_FIELDS}, hold_expires_at, created_at`).eq('status', 'pending').eq('payment_status', 'unpaid')
        .eq('booking_source', 'player').gt('hold_expires_at', new Date().toISOString()).order('hold_expires_at', { ascending: true }),
    ]);
    const list = ((p.data as any[]) || []).map(snapPay);
    setPending(list);
    setRecent(((r.data as any[]) || []).map(snapPay));
    setHolds(((h.data as any[]) || []).map(withSnapshot));
    setUrls(await signedUrls('payment-proofs', list.flatMap((x) => splitProofs(x.proof_path))));
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => {
    const ch = supabase.channel('admin-payments').on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, () => load()).subscribe();
    const t = setInterval(load, 60000);
    return () => { supabase.removeChannel(ch); clearInterval(t); };
  }, [load]);

  async function review(pay: any, approve: boolean, together: any[]) {
    if (!approve && !reason.trim()) return setMsg('⚠️ Please write why the payment is rejected — the player will see it.');
    setBusyId(pay.id);
    setMsg('');
    const total = together.reduce((a, x) => a + Number(x.amount), 0);
    const who = `${pay.booking?.player?.full_name || 'the player'}'s ${egp(total)} payment`;
    const { error } = await supabase.rpc('admin_review_payment', { p_payment_id: pay.id, p_approve: approve, p_reason: approve ? null : reason });
    setBusyId(null);
    if (error) { setMsg(`❌ Could not ${approve ? 'approve' : 'reject'} ${who}. ${error.message}`); return load(); }
    setRejectingId(null);
    setReason('');
    setMsg(approve ? `✅ Approved ${who} — the booking is confirmed.` : `Rejected ${who} — the time was released.`);
    load();
  }

  // the money did arrive (e.g. a wrong amount): cancel, and the money goes to Refunds to send
  async function rejectAndRefund(pay: any) {
    if (!reason.trim()) return setMsg('⚠️ Please write why the payment is rejected — the player will see it.');
    setBusyId(pay.id);
    const { error } = await supabase.rpc('admin_reject_and_refund', { p_payment_id: pay.id, p_reason: reason });
    setBusyId(null);
    if (error) return setMsg(`❌ ${error.message}`);
    setRejectingId(null);
    setReason('');
    setMsg('Rejected. The money that arrived is now in Refunds to send (minus the InstaPay fee). The owner gets nothing.');
    load();
  }

  if (!pending) return <Loading />;

  // a screenshot whose player then asked to cancel is handled as a cancellation request
  const open = pending.filter((p) => p.booking?.cancel_request_status !== 'pending' && p.booking?.status !== 'cancelled');
  const groupOf = (p: any) => (p.booking?.group_id ? open.filter((x) => x.booking?.group_id === p.booking.group_id) : [p]);
  const shown = open.filter((p) => groupOf(p)[0] === p);
  const courtKey = (p: any) => p.booking?.court_id || p.booking?.court?.name;
  const courts = Array.from(new Map([...shown, ...recent].filter(courtKey).map((p) => [courtKey(p), place(p.booking)] as [string, string])).entries()).sort((a, b) => a[1].localeCompare(b[1]));
  const filtered = shown.filter((p) => court === 'all' || courtKey(p) === court);
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const recentFiltered = recent.filter((p) => court === 'all' || courtKey(p) === court);
  const recentPaged = recentFiltered.slice((recentPage - 1) * PAGE_SIZE, recentPage * PAGE_SIZE);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.primary} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <Stack.Screen options={{ title: 'Payment approvals' }} />
      {!!msg && <Note kind={msg.startsWith('❌') || msg.startsWith('⚠️') ? 'error' : 'ok'}>{msg}</Note>}

      {courts.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
          <Chip label="All courts" on={court === 'all'} onPress={() => { setCourt('all'); setPage(1); setRecentPage(1); }} />
          {courts.map(([id, label]) => <Chip key={id} label={label} on={court === id} onPress={() => { setCourt(id); setPage(1); setRecentPage(1); }} />)}
        </ScrollView>
      )}

      <H2>InstaPay screenshots to check {shown.length > 0 ? `(${shown.length})` : ''}</H2>
      {shown.length === 0 ? <Muted style={{ marginBottom: 20 }}>Nothing waiting. 🎉</Muted>
        : filtered.length === 0 ? <Muted style={{ marginBottom: 20 }}>Nothing waiting for this court.</Muted>
        : paged.map((p) => {
          const b = p.booking;
          const together = groupOf(p);
          const amount = together.reduce((a: number, x: any) => a + Number(x.amount), 0);
          const busy = busyId === p.id;
          return (
            <Card key={p.id}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                <Text style={{ color: colors.text, fontSize: 22, fontWeight: '800' }}>{egp(amount)}</Text>
                <Countdown until={new Date(p.created_at).getTime() + REVIEW_MINUTES * 60000} label="approve within" overdue="Player is waiting — past the 15 minutes" />
              </View>
              <Line muted size={12}>{p.kind === 'reschedule' ? 'Extra payment for a booking change' : 'New booking'} · sent {ago(p.created_at)}</Line>
              <ProofImages paths={splitProofs(p.proof_path)} urls={urls} />
              {together.map((x: any, i: number) => (
                <View key={x.id} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 8, marginTop: 6 }}>
                  {together.length > 1 && <Line muted size={11}>Booking {i + 1} of {together.length}</Line>}
                  <Line bold size={14}>{slotText(x.booking?.start_time, x.booking?.end_time)}</Line>
                  <PriceBreakdown p={x} pending />
                </View>
              ))}
              {together.length > 1 && <Line muted size={12}>{together.length} separate times paid with one transfer ({together.map((x: any) => egp(x.amount)).join(' + ')}). Approving or rejecting covers all of them.</Line>}
              <Line muted>{place(b)} · {b?.sport?.name}</Line>
              <Line bold>{b?.player?.full_name} · {b?.player?.phone}</Line>
              {holds.filter((h) => h.user_id && h.user_id === b?.user_id && h.id !== b?.id).map((h) => (
                <View key={h.id} style={{ borderWidth: 1, borderColor: colors.warning, borderRadius: 8, padding: 6, marginTop: 6 }}>
                  <Line size={12}><Text style={{ fontWeight: '700' }}>Also booking now, waiting to pay {egp(h.amount_due)}:</Text> {place(h)} · {slotText(h.start_time, h.end_time)}</Line>
                  <Countdown until={h.hold_expires_at} label="time left to pay" overdue="Time's up — released" />
                </View>
              ))}
              {p.kind === 'reschedule' && <Line muted size={12}>New time {egp(b?.total_price)} − {egp(b?.credit_amount)} carried over</Line>}
              {b?.user_id && <PlayerHistory userId={b.user_id} name={b?.player?.full_name || 'this player'} currentBookingId={b.id} />}
              {rejectingId === p.id ? (
                <View style={{ marginTop: 8 }}>
                  <Field label="Why? (the player sees this)" value={reason} onChangeText={setReason} />
                  <Button small title="Reject payment" onPress={() => review(p, false, together)} loading={busy} />
                  <View style={{ height: 6 }} />
                  <Button small variant="ghost" title="Reject and refund the money (it did arrive)" onPress={() => rejectAndRefund(p)} disabled={busy} />
                  <LinkButton title="Back" onPress={() => setRejectingId(null)} />
                </View>
              ) : (
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                  <View style={{ flex: 1 }}><Button small title="✓ Approve" onPress={() => review(p, true, together)} loading={busy} /></View>
                  <View style={{ flex: 1 }}><Button small variant="ghost" title="✖ Reject" onPress={() => { setRejectingId(p.id); setReason(''); }} /></View>
                </View>
              )}
            </Card>
          );
        })}
      <Pager page={page} total={filtered.length} onChange={setPage} />

      <H2>Waiting for players to pay {holds.length > 0 ? `(${holds.length})` : ''}</H2>
      {holds.length === 0 ? <Muted style={{ marginBottom: 20 }}>Nobody is paying right now.</Muted> : holds.map((h) => (
        <Card key={h.id}>
          <Line bold>{h.player?.full_name} · {h.player?.phone} · {egp(h.amount_due)}</Line>
          <Line muted size={12}>{place(h)} · {h.sport?.name} · {slotText(h.start_time, h.end_time)}</Line>
          <Countdown until={h.hold_expires_at} label="time left to pay" overdue="Time's up — released" />
        </Card>
      ))}

      <H2>Recently reviewed ({recentFiltered.length})</H2>
      {recentPaged.map((p) => (
        <Card key={p.id}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Line bold>{p.booking?.player?.full_name} · {egp(p.amount)}</Line>
            <Text style={{ color: p.status === 'approved' ? colors.success : colors.danger, fontWeight: '700', fontSize: 12 }}>{p.status === 'approved' ? 'Approved' : 'Rejected'}</Text>
          </View>
          <Line muted size={12}>{place(p.booking)} · {slotText(p.booking?.start_time, p.booking?.end_time)}</Line>
          {p.reject_reason && <Line muted size={12}>Reason: {p.reject_reason}</Line>}
          {p.reviewed_at && <Line muted size={11}>Reviewed {ago(p.reviewed_at)}</Line>}
        </Card>
      ))}
      <Pager page={recentPage} total={recentFiltered.length} onChange={setRecentPage} />
    </ScrollView>
  );
}
