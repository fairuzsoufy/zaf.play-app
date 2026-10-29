import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { Stack } from 'expo-router';
import { Text } from '@/components/AppText';
import { supabase } from '@/lib/supabase';
import { payoutSchedule, PAYOUT_SCHEDULE_TEXT, shortDay, WEEKLY_PAYOUT_DAY } from '@/lib/payoutSchedule';
import { colors } from '@/lib/theme';
import { Card, InstapayValue, Line, PhotoPick, uploadPicked, type Picked } from '@/components/admin';
import { PayoutDetails, ProofGallery } from '@/components/payouts';
import { Badge, Chip, Chips, H2, LinkButton, Loading, Muted, Pager, PAGE_SIZE } from '@/components/owner';
import { Button, Field } from '@/components/ui';

const PAYMENT_METHODS = ['InstaPay', 'Bank transfer', 'Vodafone Cash', 'Cash'];
const egp = (v: number | string) => `${Number(v).toLocaleString('en-EG', { maximumFractionDigits: 2 })} EGP`;
const dayLabel = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString('en-GB', { timeZone: 'Africa/Cairo', weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
const stamp = (iso: string) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Africa/Cairo', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).replace(/am|pm/, (x) => x.toUpperCase());

// Owner Settlements, like the website's admin page: owners who paid Zaf Play, owners in minus, transfers waiting to
// be sent (with the proof upload) and the history.
export default function AdminSettlements() {
  const [pending, setPending] = useState<any[] | null>(null);
  const [schedules, setSchedules] = useState<Record<string, string | null>>({});
  const [history, setHistory] = useState<any[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [pendingPage, setPendingPage] = useState(1);
  const [message, setMessage] = useState('');
  const [balances, setBalances] = useState<any[]>([]);
  const [ownerPays, setOwnerPays] = useState<any[]>([]);
  const [rejectingPay, setRejectingPay] = useState<string | null>(null);
  const [payReason, setPayReason] = useState('');
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [method, setMethod] = useState(PAYMENT_METHODS[0]);
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [files, setFiles] = useState<Picked[]>([null]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const loadHistory = useCallback(async (page: number) => {
    const from = (page - 1) * PAGE_SIZE;
    const { data, count } = await supabase.from('payouts').select(`
        id, payout_date, bookings_count, total_bookings_amount, total_commission, total_owed_to_owner, transfer_fee, amount_sent, instapay_link, branches,
        payment_method, bank_reference, admin_notes, proof_paths, paid_at, seen_by_owner_at, direction, status, deductions, reject_reason, created_at,
        owner:users!payouts_owner_id_fkey ( full_name )`, { count: 'exact' })
      .not('owner_id', 'is', null).or('direction.eq.to_owner,status.neq.pending').order('created_at', { ascending: false }).range(from, from + PAGE_SIZE - 1);
    setHistory(data || []);
    setHistoryTotal(count || 0);
  }, []);

  const load = useCallback(async () => {
    const [p, s, b, o] = await Promise.all([
      supabase.rpc('admin_pending_settlements'),
      supabase.rpc('admin_payout_schedules'),
      supabase.rpc('admin_owner_balances'),
      supabase.from('payouts').select('id, payout_date, amount_sent, deductions, proof_paths, bank_reference, created_at, instapay_link, owner:users!payouts_owner_id_fkey ( full_name, phone )')
        .eq('direction', 'to_zaf').eq('status', 'pending').order('created_at', { ascending: true }),
    ]);
    if (p.error) setMessage(`Could not load pending settlements: ${p.error.message}`);
    setPending((p.data as any[]) || []);
    setSchedules(Object.fromEntries(((s.data as { owner_id: string; daily_until: string | null }[] | null) || []).map((r) => [r.owner_id, r.daily_until])));
    setBalances((b.data as any[]) || []);
    setOwnerPays(o.data || []);
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadHistory(historyPage); }, [loadHistory, historyPage]);

  function openForm(key: string) {
    setOpenKey(key);
    setMethod(PAYMENT_METHODS[0]);
    setReference('');
    setNotes('');
    setFiles([null]);
    setFormError('');
    setMessage('');
  }

  async function settle(row: any) {
    setFormError('');
    const picked = files.filter((f): f is NonNullable<Picked> => !!f);
    if (picked.length === 0) return setFormError('Please attach at least one photo of the transfer.');
    setSaving(true);
    // 1) upload proof photos into the owner's private folder
    const paths: string[] = [];
    for (const f of picked) {
      const up = await uploadPicked('payout-proofs', row.owner_id, f);
      if (up.error || !up.path) { setSaving(false); return setFormError(`Upload failed: ${up.error}`); }
      paths.push(up.path);
    }
    // 2) record the settlement
    const { error } = await supabase.rpc('settle_transfer', {
      p_owner_id: row.owner_id, p_day: row.day, p_instapay_key: row.instapay_key, p_payment_method: method, p_reference: reference, p_notes: notes, p_proof_paths: paths,
      // what this screen showed: if a game finished meanwhile, the database refuses instead of recording more than was sent
      p_expected_net: Number(row.total_owed), p_expected_count: Number(row.bookings_count),
    });
    setSaving(false);
    if (error) return setFormError(error.message);
    setOpenKey(null);
    setMessage(`✅ Settled ${egp(row.amount_to_send)} to ${row.owner_name} (${dayLabel(row.day)}, after ${egp(row.transfer_fee)} InstaPay fee). They can now see it on their dashboard.`);
    load();
    loadHistory(historyPage);
  }

  async function reviewOwnerPayment(id: string, approve: boolean) {
    if (!approve && !payReason.trim()) return setMessage('Please write why — the owner will see it.');
    setMessage('');
    const { error } = await supabase.rpc('admin_review_owner_payment', { p_payout_id: id, p_approve: approve, p_reason: approve ? null : payReason });
    if (error) return setMessage(`❌ ${error.message}`);
    setRejectingPay(null);
    setPayReason('');
    setMessage(approve ? '✅ Payment confirmed — the owner\'s balance is cleared.' : 'Payment rejected — the owner will see your reason and can send it again.');
    load();
    loadHistory(historyPage);
  }

  const list = pending || [];
  const totalPending = list.reduce((sum, r) => sum + Number(r.amount_to_send), 0);
  const pendingBookings = list.reduce((sum, r) => sum + Number(r.bookings_count), 0);
  const pendingOwners = new Set(list.map((r) => r.owner_id)).size;

  return (
    <>
      <Stack.Screen options={{ title: 'Owner Settlements' }} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await Promise.all([load(), loadHistory(historyPage)]); setRefreshing(false); }} />}>
        {!!message && <Text style={{ color: colors.text, marginBottom: 10 }}>{message}</Text>}
        {pending === null && <Loading />}

        {ownerPays.length > 0 && (
          <>
            <H2>Owner payments to confirm ({ownerPays.length})</H2>
            {ownerPays.map((p) => (
              <Card key={p.id} tone="warn">
                <Line bold size={15}>{p.owner?.full_name} sent you {egp(p.amount_sent)}</Line>
                <Line muted size={12}>{p.owner?.phone} · {stamp(p.created_at)}{p.bank_reference ? ` · Ref ${p.bank_reference}` : ''}</Line>
                <Line size={12}>Covers deductions of {egp(p.deductions)} (minus earnings not yet paid out).</Line>
                <PayoutDetails payoutId={p.id} />
                <ProofGallery paths={p.proof_paths || []} />
                {rejectingPay === p.id ? (
                  <>
                    <Field label="Why? (the owner sees it)" value={payReason} onChangeText={setPayReason} placeholder="e.g. amount doesn't match" />
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <View style={{ flex: 1 }}><Button small title="Reject" onPress={() => reviewOwnerPayment(p.id, false)} /></View>
                      <View style={{ flex: 1 }}><Button small variant="ghost" title="Back" onPress={() => setRejectingPay(null)} /></View>
                    </View>
                  </>
                ) : (
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                    <View style={{ flex: 1 }}><Button small title="✓ I received it" onPress={() => reviewOwnerPayment(p.id, true)} /></View>
                    <View style={{ flex: 1 }}><Button small variant="ghost" title="✖ Reject" onPress={() => { setRejectingPay(p.id); setPayReason(''); }} /></View>
                  </View>
                )}
              </Card>
            ))}
          </>
        )}

        {balances.length > 0 && (
          <>
            <H2>Owners in minus ({balances.length})</H2>
            {balances.map((b) => (
              <Card key={`${b.owner_id}_${b.instapay_key}`}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Line bold>{b.owner_name} · {b.owner_phone}</Line>
                  <Text style={{ color: colors.danger, fontWeight: '800' }}>{egp(b.net)}</Text>
                </View>
                <Line muted size={12}>Earned {egp(b.earnings)} − deductions {egp(b.deductions)}</Line>
                {(b.deduction_items || []).map((d: any) => <Line key={d.id} size={12}>• {d.reason} ({d.branch}): {egp(d.amount)}</Line>)}
                <Line muted size={12}>Taken from their next payout</Line>
              </Card>
            ))}
          </>
        )}

        <H2>Waiting to be settled{list.length > 0 ? ` (${list.length})` : ''}</H2>
        <Muted style={{ fontSize: 12 }}>Payout schedule: {PAYOUT_SCHEDULE_TEXT}</Muted>
        {list.length > 0 && (
          <Line>Total to send: <Text style={{ fontWeight: '800' }}>{egp(totalPending)}</Text> · {list.length} transfer{list.length === 1 ? '' : 's'} · {pendingOwners} owner{pendingOwners === 1 ? '' : 's'} · {pendingBookings} booking{pendingBookings === 1 ? '' : 's'}</Line>
        )}
        {pending !== null && list.length === 0 && <Muted style={{ marginVertical: 10 }}>All caught up — nothing to settle. 🎉</Muted>}
        <View style={{ height: 8 }} />
        {list.slice((pendingPage - 1) * PAGE_SIZE, pendingPage * PAGE_SIZE).map((row) => {
          const key = `${row.owner_id}_${row.day}_${row.instapay_key}`;
          const branches: any[] = row.branches || [];
          const isOpen = openKey === key;
          const schedule = payoutSchedule(schedules[row.owner_id]);
          return (
            <Card key={key}>
              <Line bold size={15}>{row.owner_name}</Line>
              {schedule.mode === 'daily' && <Badge tone="info" text={`Daily payout · until ${shortDay(schedule.dailyUntil!)}`} />}
              {schedule.mode === 'weekly' && <Badge text={`Weekly payout · ${WEEKLY_PAYOUT_DAY} ${shortDay(schedule.nextDue!)}`} />}
              <Line muted>{dayLabel(row.day)} · {row.bookings_count} booking(s){branches.length > 1 ? ` · ${branches.length} branches, one transfer` : ''}</Line>
              <Line muted size={12}>{row.owner_phone} · {row.owner_email}</Line>
              <Line>💸 Send to: <InstapayValue value={row.instapay_link} /></Line>
              {branches.map((b) => <Line key={b.facility_id} size={12}><Text style={{ fontWeight: '700' }}>{b.name}</Text> · {b.bookings} booking(s) · booked {egp(b.amount)} − {egp(b.commission)} = {egp(b.owed)}</Line>)}
              {(row.deduction_items || []).map((d: any) => (
                <Text key={d.id} style={{ color: Number(d.amount) < 0 ? colors.success : colors.danger, fontSize: 12, marginTop: 2 }}>
                  {Number(d.amount) < 0 ? `+ ${egp(-Number(d.amount))}` : `− ${egp(d.amount)}`} · {d.reason} ({d.branch})
                </Text>
              ))}
              <PayoutDetails key={`${key}_${row.bookings_count}`} pending={{ ownerId: row.owner_id, day: row.day, instapayKey: row.instapay_key }} />
              {Number(row.deductions) > 0 && <Text style={{ color: colors.danger, fontSize: 12 }}>Earned {egp(row.earnings)} − deductions {egp(row.deductions)}</Text>}
              {Number(row.deductions) < 0 && <Text style={{ color: colors.success, fontSize: 12 }}>Earned {egp(row.earnings)} + tournament share {egp(-Number(row.deductions))}</Text>}
              <Line muted size={12}>Owed {egp(row.total_owed)} − InstaPay fee {egp(row.transfer_fee)}</Line>
              <Text style={{ color: colors.text, fontSize: 20, fontWeight: '800', marginTop: 4 }}>Send {egp(row.amount_to_send)}</Text>
              {!isOpen && <View style={{ marginTop: 8 }}><Button small title="Mark as transferred" onPress={() => openForm(key)} /></View>}
              {isOpen && (
                <View style={{ marginTop: 10, borderTopWidth: 1, borderColor: colors.border, paddingTop: 10 }}>
                  <Muted>How did you send it?</Muted>
                  <Chips>{PAYMENT_METHODS.map((m) => <Chip key={m} label={m} on={method === m} onPress={() => setMethod(m)} />)}</Chips>
                  <Field label="Reference number (optional)" value={reference} onChangeText={setReference} placeholder="Transaction / reference ID" />
                  <Field label="Note to owner (optional)" value={notes} onChangeText={setNotes} />
                  <Muted>Proof of transfer (up to 5 photos)</Muted>
                  {files.map((f, i) => (
                    <PhotoPick key={i} value={f} title={i === 0 ? 'Upload the transfer screenshot' : 'Another photo'}
                      onChange={(p) => setFiles((all) => all.map((x, j) => (j === i ? p : x)))} />
                  ))}
                  {files.length < 5 && files[files.length - 1] && <LinkButton title="+ Add another photo" onPress={() => setFiles([...files, null])} />}
                  {!!formError && <Text style={{ color: colors.danger, marginBottom: 8 }}>{formError}</Text>}
                  <Button title={saving ? 'Saving...' : `I transferred ${egp(row.amount_to_send)} to ${row.owner_name}`} onPress={() => settle(row)} loading={saving} />
                  <LinkButton title="Cancel" onPress={() => setOpenKey(null)} />
                </View>
              )}
            </Card>
          );
        })}
        <Pager page={pendingPage} total={list.length} onChange={setPendingPage} />

        <H2>Settled</H2>
        {historyTotal === 0 ? <Muted>No settlements yet.</Muted> : history.map((p) => (
          <Card key={p.id}>
            <Line bold>{p.direction === 'to_zaf'
              ? `⬅ ${p.owner?.full_name} paid Zaf Play ${egp(p.amount_sent)}${p.status === 'on_hold' ? ' — rejected' : ''}`
              : `➡ ${p.owner?.full_name} · sent ${egp(p.amount_sent ?? p.total_owed_to_owner)}`}</Line>
            {p.status === 'on_hold' && !!p.reject_reason && <Text style={{ color: colors.danger, fontSize: 12 }}>Reason: {p.reject_reason}</Text>}
            {Number(p.deductions) > 0 && <Text style={{ color: colors.danger, fontSize: 12 }}>Includes deductions of {egp(p.deductions)}</Text>}
            {Number(p.transfer_fee) > 0 && <Line muted size={12}>Owed {egp(p.total_owed_to_owner)} − InstaPay fee {egp(p.transfer_fee)}</Line>}
            {!!p.instapay_link && <Line size={12}>To: <InstapayValue value={p.instapay_link} /></Line>}
            {(p.branches || []).length > 0 && <Line size={12}>{(p.branches || []).map((b: any) => `${b.name}: ${egp(b.owed)}`).join(' · ')}</Line>}
            <Line muted>For {dayLabel(p.payout_date)} · {p.bookings_count} booking(s) · via {p.payment_method}{p.bank_reference ? ` · Ref ${p.bank_reference}` : ''}</Line>
            <Line muted size={12}>{p.direction === 'to_zaf' ? 'Sent' : 'Transferred'} {stamp(p.paid_at || p.created_at)} · {p.seen_by_owner_at ? '👀 Seen by owner' : 'Not seen by owner yet'}</Line>
            {!!p.admin_notes && <Line>Note: {p.admin_notes}</Line>}
            <PayoutDetails payoutId={p.id} />
            <ProofGallery paths={p.proof_paths || []} />
          </Card>
        ))}
        <Pager page={historyPage} total={historyTotal} onChange={setHistoryPage} />
      </ScrollView>
    </>
  );
}
