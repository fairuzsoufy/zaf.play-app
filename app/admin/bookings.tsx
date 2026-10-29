import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { Stack } from 'expo-router';
import { Text } from '@/components/AppText';
import { supabase } from '@/lib/supabase';
import { egp, whenText } from '@/lib/format';
import { cleanInstapay, INSTAPAY_HELP, isInstapay } from '@/lib/payment';
import { withSnapshot } from '@/lib/admin';
import { bookingStatusText } from '@/lib/refundKind';
import { colors } from '@/lib/theme';
import { Card, InstapayValue, Line, RefundKindNote } from '@/components/admin';
import { PlayerHistory } from '@/components/PlayerHistory';
import { Badge, Chip, Chips, LinkButton, Loading, Muted, Pager, PAGE_SIZE } from '@/components/owner';
import { Button, Field } from '@/components/ui';

type Tab = 'upcoming' | 'played' | 'cancelled' | 'all';
const TABS: { id: Tab; label: string }[] = [
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'played', label: 'Played' },
  { id: 'cancelled', label: 'Cancelled' },
  { id: 'all', label: 'All bookings' },
];

function statusOf(b: any): { label: string; tone: 'ok' | 'bad' | 'warn' | 'info' | 'neutral' } {
  if (b.status === 'cancelled') return { label: 'Cancelled', tone: 'bad' };
  if (b.status === 'completed' || (b.status === 'confirmed' && new Date(b.end_time) <= new Date())) return { label: 'Played · Paid', tone: 'info' };
  if (b.status === 'confirmed') return { label: 'Upcoming · Paid', tone: 'ok' };
  if (b.payment_status === 'pending_review') return { label: 'Payment in review', tone: 'warn' };
  if (b.payment_status === 'unpaid') return { label: 'Awaiting payment', tone: 'neutral' };
  return { label: b.status, tone: 'neutral' };
}

// Every player booking, like the website's admin Bookings page, with the admin's cancel (full refund).
export default function AdminBookings() {
  const [tab, setTab] = useState<Tab>('upcoming');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<any[] | null>(null);
  const [total, setTotal] = useState(0);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [refundTo, setRefundTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [changes, setChanges] = useState<Record<string, number>>({});
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const nowIso = new Date().toISOString();
    let q = supabase
      .from('bookings')
      .select(
        `id, user_id, start_time, end_time, total_price, status, payment_status, refund_to, refund_status, refund_amount, refund_fee, retained_amount, rescheduled_from, credit_amount, cancel_request_status,
         cancelled_by, cancellation_reason, created_at, player_name, player_phone,
         player:users!bookings_user_id_fkey ( full_name, phone ),
         sport:sports ( name ),
         court:courts ( name, facility:facilities ( name, city ) )`,
        { count: 'exact' }
      )
      .eq('booking_source', 'player')
      .is('moved_to', null); // an older version of a changed booking lives in the history of its new version
    if (tab === 'upcoming') q = q.in('status', ['pending', 'confirmed']).gt('end_time', nowIso).order('start_time', { ascending: true });
    else if (tab === 'played') q = q.in('status', ['confirmed', 'completed']).lte('end_time', nowIso).order('start_time', { ascending: false });
    // a change that was never paid is not a cancelled booking (the booking stayed as it was)
    else if (tab === 'cancelled') q = q.eq('status', 'cancelled').or('rescheduled_from.is.null,payment_status.neq.unpaid').order('cancelled_at', { ascending: false });
    else q = q.order('created_at', { ascending: false });
    const { data, count } = await q.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
    const list = ((data as any[]) || []).map(withSnapshot);
    setRows(list);
    setTotal(count || 0);
    // walk back each changed booking to count its changes
    const parentOf: Record<string, string | null> = {};
    let ask = Array.from(new Set(list.map((b) => b.rescheduled_from).filter(Boolean))) as string[];
    for (let round = 0; ask.length > 0 && round < 6; round++) {
      const { data: up } = await supabase.from('bookings').select('id, rescheduled_from').in('id', ask);
      const ups = (up || []) as { id: string; rescheduled_from: string | null }[];
      ups.forEach((x) => (parentOf[x.id] = x.rescheduled_from));
      ask = ups.map((x) => x.rescheduled_from).filter((id): id is string => !!id && !(id in parentOf));
    }
    const counted: Record<string, number> = {};
    for (const b of list) {
      let k = 0;
      let cur: string | null = b.rescheduled_from;
      while (cur && k < 10) { k++; cur = parentOf[cur] ?? null; }
      if (k > 0) counted[b.id] = k;
    }
    setChanges(counted);
  }, [tab, page]);
  useEffect(() => { load(); }, [load]);

  async function cancel(b: any) {
    if (!reason.trim()) return setMessage('Please write a reason — the player will see it.');
    if (refundTo && !isInstapay(refundTo)) return setMessage(`Refund InstaPay: ${INSTAPAY_HELP}`);
    setBusy(true);
    setMessage('');
    const { data, error } = await supabase.rpc('cancel_booking', { p_booking_id: b.id, p_reason: reason, p_refund_to: refundTo || null });
    setBusy(false);
    if (error) return setMessage(`❌ ${error.message}`);
    setCancellingId(null);
    setReason('');
    setRefundTo('');
    const d = data as any;
    setMessage(Number(d?.refund) > 0
      ? `✅ Booking cancelled. Send the player ${egp(d.refund)} — it's waiting in Cancellations & Refunds.`
      : '✅ Booking cancelled. Nothing was paid, so there is no refund.');
    load();
  }

  const term = search.trim().toLowerCase();
  const shown = (rows || []).filter((b) => !term || [b.player?.full_name, b.player?.phone, b.court?.name, b.court?.facility?.name, b.sport?.name]
    .filter(Boolean).some((v: string) => v.toLowerCase().includes(term)));

  return (
    <>
      <Stack.Screen options={{ title: 'Bookings' }} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
        <Chips>{TABS.map((t) => <Chip key={t.id} label={t.label} on={tab === t.id} onPress={() => { setTab(t.id); setPage(1); setCancellingId(null); }} />)}</Chips>
        <Field label="Search this page" value={search} onChangeText={setSearch} placeholder="Player, phone, court…" />
        {!!message && <Text style={{ color: colors.text, marginBottom: 10 }}>{message}</Text>}
        {rows === null ? <Loading /> : shown.length === 0 ? <Muted>No bookings here.</Muted> : shown.map((b) => {
          const st = statusOf(b);
          const canCancel = ['pending', 'confirmed'].includes(b.status) && new Date(b.start_time) > new Date();
          const paid = b.payment_status === 'paid' || b.payment_status === 'pending_review';
          return (
            <Card key={b.id}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <Text style={{ color: colors.text, fontWeight: '800', flex: 1 }}>{b.court?.name} <Text style={{ color: colors.muted, fontWeight: '400' }}>· {b.sport?.name} · {b.court?.facility?.name}, {b.court?.facility?.city}</Text></Text>
                <Badge tone={st.tone} text={st.label} />
              </View>
              <Line>{whenText(b.start_time, b.end_time)}</Line>
              <Line muted>{b.player?.full_name} · {b.player?.phone} · {egp(b.total_price)}</Line>
              {!!b.refund_to && <Line muted size={12}>Refund InstaPay: <InstapayValue value={b.refund_to} /></Line>}
              <Line size={12}>Booking status: <Text style={{ fontWeight: '700' }}>{bookingStatusText(b)}</Text>{changes[b.id] > 0 ? ` · Changed ${changes[b.id] === 1 ? 'once' : `${changes[b.id]} times`} by the player` : ''}</Line>
              <RefundKindNote b={b} />
              {b.status === 'cancelled' && (
                <Text style={{ color: colors.danger, fontSize: 12, marginTop: 2 }}>
                  Cancelled by {b.cancelled_by}{b.cancellation_reason ? ` — ${b.cancellation_reason}` : ''}
                  {Number(b.refund_amount) > 0 ? ` · refund ${egp(b.refund_amount)} ${b.refund_status === 'refunded' ? 'sent' : 'to send'}` : ''}
                </Text>
              )}
              <PlayerHistory userId={b.user_id} name={b.player?.full_name || 'this player'} currentBookingId={b.id} />
              {canCancel && cancellingId !== b.id && (
                <LinkButton title="Cancel booking" onPress={() => { setCancellingId(b.id); setReason(''); setRefundTo(b.refund_to || ''); setMessage(''); }} />
              )}
              {cancellingId === b.id && (
                <View style={{ marginTop: 10, borderWidth: 1, borderColor: colors.danger, borderRadius: 10, padding: 10 }}>
                  <Line>Cancel this booking? The player gets back everything they paid{paid ? ` (${egp(b.total_price)})` : ' (nothing was paid)'}.</Line>
                  <Field label="Reason the player will see" value={reason} onChangeText={setReason} placeholder="e.g. court under maintenance" />
                  {paid && <Field label="Player's InstaPay for the refund" value={refundTo} onChangeText={(v) => setRefundTo(cleanInstapay(v))} keyboardType="number-pad" placeholder="01xxxxxxxxx" />}
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <View style={{ flex: 1 }}><Button small title={busy ? 'Cancelling...' : 'Yes, cancel it'} onPress={() => cancel(b)} loading={busy} /></View>
                    <View style={{ flex: 1 }}><Button small variant="ghost" title="Keep it" onPress={() => setCancellingId(null)} /></View>
                  </View>
                </View>
              )}
            </Card>
          );
        })}
        <Pager page={page} total={total} onChange={setPage} />
      </ScrollView>
    </>
  );
}
