import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { Stack, useFocusEffect } from 'expo-router';
import { Text } from '@/components/AppText';
import { supabase } from '@/lib/supabase';
import { dateTimeText, egp } from '@/lib/format';
import { HOLD_MINUTES } from '@/lib/payment';
import { bookingStatusText } from '@/lib/refundKind';
import { searchMatches } from '@/lib/courtTimes';
import { ago, BOOKING_FIELDS, signedUrls, slotText, splitProofs, withSnapshot } from '@/lib/admin';
import { colors } from '@/lib/theme';
import { Card, InstapayValue, Line, PhotoPick, ProofImages, RefundKindNote, uploadPicked, type Picked } from '@/components/admin';
import { PlayerHistory } from '@/components/PlayerHistory';
import { H2, LinkButton, Loading, Muted, Pager, PAGE_SIZE } from '@/components/owner';
import { Button, Field, Note } from '@/components/ui';

const place = (b: any) => `${b?.court?.facility?.name ? `${b.court.facility.name} — ` : ''}${b?.court?.name || ''}`;

// Cancellations & Refunds, like the website: cancel requests to answer, refunds to send, and refunds already sent.
export default function AdminRefunds() {
  const [requests, setRequests] = useState<any[] | null>(null);
  const [refunds, setRefunds] = useState<any[]>([]);
  const [pending, setPending] = useState<any[]>([]);
  const [late, setLate] = useState<Record<string, string>>({});
  const [sent, setSent] = useState<any[]>([]);
  const [sentLimit, setSentLimit] = useState(20);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [receipts, setReceipts] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<Record<string, Picked>>({});
  const [decliningId, setDecliningId] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [req, due, pend, ref, chg] = await Promise.all([
      supabase.rpc('admin_cancel_requests'),
      supabase.from('bookings').select(`${BOOKING_FIELDS}, status, refund_amount, refund_fee, refund_to, retained_amount, cancelled_by, cancelled_at, created_at, refund_status, refund_as_credit, cancellation_reason`).eq('refund_status', 'due'),
      supabase.from('payments').select('id, amount, proof_path, booking_id').eq('status', 'pending'),
      supabase.from('bookings').select(`${BOOKING_FIELDS}, status, refund_amount, refund_fee, refund_to, retained_amount, cancelled_by, refunded_at, refund_proof_path, refund_status, cancellation_reason, change_refund_status, change_refund_amount`)
        .eq('refund_status', 'refunded').order('refunded_at', { ascending: false }).limit(sentLimit),
      supabase.from('bookings').select(`${BOOKING_FIELDS}, status, retained_amount, cancelled_by, cancellation_reason, refund_to, change_refund_amount, change_refund_fee, change_refunded_at, change_refund_proof_path`)
        .eq('change_refund_status', 'refunded').order('change_refunded_at', { ascending: false }).limit(sentLimit),
    ]);
    const dueRows = ((due.data as any[]) || []).sort((a, b) => new Date(a.cancelled_at || a.created_at).getTime() - new Date(b.cancelled_at || b.created_at).getTime()).map(withSnapshot);
    setRefunds(dueRows);
    setRequests((req.data as any[]) || []);
    const pays = (pend.data as any[]) || [];
    setPending(pays);
    // screenshots sent after the hold ran out and the time was taken: check the money arrived before refunding
    const ids = dueRows.map((b) => b.id);
    const lateRows = ids.length ? ((await supabase.from('payments').select('booking_id, proof_path').eq('status', 'late').in('booking_id', ids)).data as any[]) || [] : [];
    const lateMap: Record<string, string> = {};
    lateRows.forEach((p) => { lateMap[p.booking_id] = p.proof_path; });
    setLate(lateMap);
    const changeRows = ((chg.data as any[]) || []).map((b) => ({ ...b, key: `${b.id}-change`, isChangeRefund: true, refund_amount: b.change_refund_amount, refund_fee: b.change_refund_fee, refunded_at: b.change_refunded_at, refund_proof_path: b.change_refund_proof_path }));
    const all = [...((ref.data as any[]) || []).map((b) => ({ ...b, key: b.id })), ...changeRows].map(withSnapshot)
      .sort((x, y) => new Date(y.refunded_at || 0).getTime() - new Date(x.refunded_at || 0).getTime()).slice(0, sentLimit);
    setSent(all);
    setReceipts(await signedUrls('refund-proofs', all.map((b) => b.refund_proof_path).filter(Boolean)));
    setUrls(await signedUrls('payment-proofs', [...pays.flatMap((p) => splitProofs(p.proof_path)), ...Object.values(lateMap).flatMap(splitProofs)]));
  }, [sentLimit]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);

  async function receipt(bookingId: string) {
    const f = files[bookingId];
    if (!f) { setMsg('⚠️ Please attach the photo of the InstaPay transfer first — the player will see it.'); return null; }
    const { path, error } = await uploadPicked('refund-proofs', bookingId, f);
    if (error) { setMsg(`❌ The transfer photo could not be uploaded: ${error}`); return null; }
    return path!;
  }

  async function reviewCancellation(r: any, approve: boolean) {
    setBusyId(r.booking_id);
    setMsg('');
    let proof: string | null = null;
    if (approve && Number(r.refund) > 0) {
      proof = await receipt(r.booking_id);
      if (!proof) return setBusyId(null);
    }
    const { data, error } = await supabase.rpc('admin_review_cancellation', { p_booking_id: r.booking_id, p_approve: approve, p_reason: approve ? null : declineReason, p_proof_path: proof });
    setBusyId(null);
    if (error) return setMsg(`❌ Could not ${approve ? 'cancel' : 'decline'} ${r.player_name || 'the player'}'s booking. ${error.message}`);
    const d = data as any;
    setDecliningId(null);
    setDeclineReason('');
    setMsg(approve
      ? `✅ Booking cancelled${Number(d?.refund) > 0 ? ` and the ${egp(d.refund)} refund is logged as sent. The player can see the photo.` : Number(d?.credit) > 0 ? '.' : '. No refund was due.'}${Number(d?.credit) > 0 ? ` ${egp(d.credit)} was added to the player's credit.` : ''}`
      : 'Request declined — the booking stays. The player sees your reason.');
    load();
  }

  async function markRefunded(b: any) {
    setBusyId(b.id);
    setMsg('');
    const asCredit = !!b.refund_as_credit;
    const proof = asCredit ? null : await receipt(b.id);
    if (!asCredit && !proof) return setBusyId(null);
    const { error } = await supabase.rpc('admin_mark_refunded', { p_booking_id: b.id, p_proof_path: proof });
    setBusyId(null);
    const what = `${egp(b.refund_amount)} refund to ${b.player?.full_name || 'the player'}`;
    if (error) return setMsg(`❌ Could not mark the ${what} as sent. ${error.message}`);
    setMsg(asCredit ? `✅ The ${what} was added to their Zaf Play credit.` : `✅ The ${what} is marked as sent.`);
    load();
  }

  async function noMoney(r: any, pay: any) {
    setBusyId(r.booking_id);
    const { error } = await supabase.rpc('admin_review_payment', { p_payment_id: pay.id, p_approve: false, p_reason: 'The money did not arrive, so there is nothing to refund' });
    setBusyId(null);
    setMsg(error ? `❌ ${error.message}` : 'The money did not arrive: the booking was cancelled with nothing to refund.');
    load();
  }

  if (!requests) return <Loading />;
  const proofFor = (bookingId: string) => pending.find((p) => p.booking_id === bookingId);
  // a refund still owed on a booking whose player asked to cancel is sent with that cancellation (one transfer)
  const toSend = refunds.filter((b) => b.cancel_request_status !== 'pending');
  const held = (id: string) => refunds.find((b) => b.id === id && b.cancel_request_status === 'pending');
  const reqFound = requests.filter((r) => searchMatches(q, [r.player_name, r.player_phone, r.branch_name, r.court_name, r.sport_name].join(' ')));
  const reqPaged = reqFound.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.primary} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <Stack.Screen options={{ title: 'Cancellations & Refunds' }} />
      {!!msg && <Note kind={msg.startsWith('❌') || msg.startsWith('⚠️') ? 'error' : 'ok'}>{msg}</Note>}

      <H2>Cancellation requests {requests.length ? `(${requests.length})` : ''}</H2>
      {requests.length === 0 ? <Muted style={{ marginBottom: 20 }}>No requests. 🎉</Muted> : (
        <>
          <Field label="Search by player, phone, branch, court or sport" value={q} onChangeText={(v) => { setQ(v); setPage(1); }} />
          {reqPaged.map((r) => {
            const pay = proofFor(r.booking_id);
            const h = held(r.booking_id);
            const busy = busyId === r.booking_id;
            return (
              <Card key={r.booking_id} tone="warn">
                <Line bold>{r.player_name} · {r.player_phone}</Line>
                <Line muted>{r.branch_name} — {r.court_name} · {r.sport_name}</Line>
                <Line>{slotText(r.start_time, r.end_time)}</Line>
                <Line muted size={12}>Asked {ago(r.requested_at)}{r.reason ? ` · Reason: ${r.reason}` : ''}</Line>
                {r.payment_status === 'pending_review' && (
                  <View style={{ borderWidth: 1, borderColor: colors.warning, borderRadius: 8, padding: 8, marginTop: 6 }}>
                    <Line size={12} bold>Not approved yet: check their screenshot ({egp(pay?.amount ?? r.total_price)}), then one button approves it and refunds. The owner gets nothing.</Line>
                    <ProofImages paths={splitProofs(pay?.proof_path)} urls={urls} size={80} />
                    {pay && <Button small variant="ghost" title="The money didn't arrive: cancel with no refund" onPress={() => noMoney(r, pay)} disabled={busy} />}
                  </View>
                )}
                <View style={{ marginTop: 8 }}>
                  <Line>{r.is_move ? 'Extra paid for a time change' : 'Paid'}: {egp(r.is_move ? r.amount_due : r.total_price)}</Line>
                  <Text style={{ color: r.late ? colors.danger : colors.success, fontSize: 13 }}>{r.is_move ? 'No late fee' : r.late ? `Late — ${r.fee_percent}% kept: ${egp(r.retained)}` : 'Free cancellation'}</Text>
                  {h && <Line size={12}>Includes {egp(Number(h.refund_amount) + Number(h.refund_fee || 0))} still owed from the player's earlier change to a cheaper time. {r.as_credit ? 'It goes to their credit too.' : 'Send both in this one transfer, with one photo.'}</Line>}
                  {r.as_credit ? <Text style={{ color: colors.success, fontWeight: '800' }}>💳 Player chose credit: {egp(r.credit_back)}</Text> : (
                    <>
                      <Line muted>InstaPay fee: {egp(r.transfer_fee)}</Line>
                      <Line bold size={15}>Refund {egp(r.refund)}</Line>
                      {Number(r.credit_back) > 0 && <Text style={{ color: colors.success, fontSize: 13 }}>+ {egp(r.credit_back)} goes back to their credit (paid with credit)</Text>}
                    </>
                  )}
                  <Line size={12} bold>{Number(r.retained) > 0 ? 'Partial refund · late cancellation' : r.is_move ? 'Full refund of the extra paid' : 'Full refund'}</Line>
                  {Number(r.refund) > 0 ? <Line size={12}>to <InstapayValue value={r.refund_to} /></Line>
                    : Number(r.credit_back) > 0 && <Line muted size={12}>Added to their balance automatically — no transfer, no photo</Line>}
                </View>
                <PlayerHistory bookingId={r.booking_id} name={r.player_name || 'this player'} currentBookingId={r.booking_id} />
                {decliningId === r.booking_id ? (
                  <View style={{ marginTop: 8 }}>
                    <Field label="Why? (the player sees this)" value={declineReason} onChangeText={setDeclineReason} />
                    <Button small title="Decline request" onPress={() => reviewCancellation(r, false)} loading={busy} />
                    <LinkButton title="Back" onPress={() => setDecliningId(null)} />
                  </View>
                ) : (
                  <View style={{ marginTop: 8 }}>
                    {Number(r.refund) > 0 && <PhotoPick title="Add the photo of the refund transfer" value={files[r.booking_id] || null} onChange={(f) => setFiles({ ...files, [r.booking_id]: f })} />}
                    <Button small loading={busy} onPress={() => reviewCancellation(r, true)}
                      title={r.payment_status === 'pending_review'
                        ? Number(r.refund) > 0 ? `Approve payment and refund ${egp(r.refund)}` : 'Approve payment and cancel'
                        : Number(r.refund) > 0 ? `I sent ${egp(r.refund)} — cancel booking` : Number(r.credit_back) > 0 ? `Cancel booking & add ${egp(r.credit_back)} credit` : 'Cancel booking'} />
                    <LinkButton danger title="Decline" onPress={() => { setDecliningId(r.booking_id); setDeclineReason(''); }} disabled={busy} />
                  </View>
                )}
              </Card>
            );
          })}
          <Pager page={page} total={reqFound.length} onChange={setPage} />
        </>
      )}

      {toSend.length > 0 && <H2>Refunds to send ({toSend.length})</H2>}
      {toSend.map((b) => {
        const busy = busyId === b.id;
        return (
          <Card key={b.id}>
            <Line bold size={18}>{egp(b.refund_as_credit ? Number(b.refund_amount) + Number(b.refund_fee || 0) : b.refund_amount)}</Line>
            <Line>to {b.refund_as_credit ? <Text style={{ fontWeight: '700' }}>💳 their Zaf Play credit (the player chose credit, no transfer)</Text> : <InstapayValue value={b.refund_to} />}</Line>
            <Line>{b.player?.full_name} · {b.player?.phone} · {b.player?.email}</Line>
            <Line muted size={12}>{place(b)} · {slotText(b.start_time, b.end_time)}</Line>
            <Line muted size={12}>Booking: {bookingStatusText(b)}{b.status === 'cancelled' ? ` · paid ${egp(b.total_price)}` : b.rescheduled_from ? ` · had paid ${egp(b.credit_amount)}, new price ${egp(b.total_price)}` : ''}</Line>
            <RefundKindNote b={b} />
            {late[b.id] && (
              <View style={{ marginTop: 4 }}>
                <Text style={{ color: colors.warning, fontSize: 12 }}>⚠ Paid after the {HOLD_MINUTES} minutes ran out. Make sure the money arrived before refunding.</Text>
                <ProofImages paths={splitProofs(late[b.id])} urls={urls} size={70} />
              </View>
            )}
            {b.user_id && <PlayerHistory userId={b.user_id} name={b.player?.full_name || 'this player'} currentBookingId={b.id} />}
            {!b.refund_as_credit && <PhotoPick title="Add the transfer photo" value={files[b.id] || null} onChange={(f) => setFiles({ ...files, [b.id]: f })} />}
            <Button small loading={busy} title={b.refund_as_credit ? 'Transfer checked: add the credit' : 'I sent the refund'} onPress={() => markRefunded(b)} />
          </Card>
        );
      })}

      <H2>Refunds sent</H2>
      {sent.length === 0 ? <Muted>No refunds yet.</Muted> : sent.map((b) => (
        <Card key={b.key}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Line bold>{egp(b.refund_amount)} · {b.player?.full_name}</Line>
            <Line muted size={11}>{b.refunded_at ? dateTimeText(b.refunded_at) : ''}</Line>
          </View>
          <Line muted size={12}>{place(b)} · {slotText(b.start_time, b.end_time)} · {bookingStatusText(b)}</Line>
          {b.isChangeRefund ? <Text style={{ color: colors.warning, fontSize: 12 }}>Difference of a change to a cheaper time (the booking was cancelled later)</Text> : <RefundKindNote b={b} />}
          <Line muted size={12}>Paid {egp(b.total_price)}{Number(b.retained_amount) > 0 ? ` · kept ${egp(b.retained_amount)}` : ''}{Number(b.refund_fee) > 0 ? ` · after ${egp(b.refund_fee)} InstaPay fee` : ''} · sent to {b.refund_to || '—'}</Line>
          {b.refund_proof_path && receipts[b.refund_proof_path] && <ProofImages paths={[b.refund_proof_path]} urls={receipts} size={60} />}
        </Card>
      ))}
      {sent.length >= sentLimit && <LinkButton title="Show more" onPress={() => setSentLimit(sentLimit + 20)} />}
    </ScrollView>
  );
}
