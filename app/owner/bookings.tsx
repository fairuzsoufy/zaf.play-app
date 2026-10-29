import { useCallback, useEffect, useState } from 'react';
import { Linking, ScrollView, View, RefreshControl } from 'react-native';
import { Text } from '@/components/AppText';
import { useRouter, type Href } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { branchScope } from '@/lib/access';
import { cancelReasonText, isMoved, refundInfo } from '@/lib/refundKind';
import { useT } from '@/lib/ownerLang';
import { colors } from '@/lib/theme';
import { Badge, Box, Chip, Chips, fmtEGP, LinkButton, Loading, Muted, Pager, PAGE_SIZE, useOwner } from '@/components/owner';
import { Button, Field } from '@/components/ui';

type Tab = 'upcoming' | 'past' | 'all';
type Show = 'all' | 'paid' | 'cancelled';
const TAB_LABELS: Record<Tab, string> = { upcoming: 'Upcoming', past: 'Past', all: 'All dates' };
const SHOW_LABELS: Record<Show, string> = { all: 'All', paid: 'Paid', cancelled: 'Cancelled' };

// a booking the player changed is not a cancellation: its new version is listed instead
const NOT_MOVED = 'moved_to.is.null,or(rescheduled_from.is.null,payment_status.neq.unpaid)';

const TIME = { timeZone: 'Africa/Cairo', hour: 'numeric', minute: '2-digit', hour12: true } as const;
const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', TIME).replace(/am|pm/, (x) => x.toUpperCase());

// All of an owner's player bookings, like the website's dashboard Bookings: Upcoming / Past / All dates,
// paid / cancelled / all, by court, with cancel (with a reason) and no-show for managers.
export default function OwnerBookings() {
  const router = useRouter();
  const { access } = useOwner();
  const { t, tm, locale } = useT();
  const canManage = !!access.manage_bookings;
  const showShare = !!access.view_finances;
  const scope = branchScope(access);
  const [tab, setTab] = useState<Tab>('upcoming');
  const [show, setShow] = useState<Show>('paid');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<any[] | null>(null);
  const [total, setTotal] = useState(0);
  const [courts, setCourts] = useState<any[]>([]);
  const [courtFilter, setCourtFilter] = useState('');
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelBusy, setCancelBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    supabase.from('courts').select('id, name, is_active, is_approved, facility:facilities!inner ( id, name, owner_id )')
      .eq('facility.owner_id', access.owner_id || '').order('name')
      .then(({ data }) => setCourts(((data as any[]) || []).filter((c) => !scope || scope.includes(c.facility?.id))));
  }, []);

  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    const nowIso = new Date().toISOString();
    const from = (page - 1) * PAGE_SIZE;
    let q = supabase
      .from('bookings')
      .select(
        `id, start_time, end_time, total_price, owner_net_amount, status, payment_status,
         cancelled_by, cancellation_reason, cancelled_at, cancel_request_status,
         refund_amount, refund_fee, refund_status, retained_amount, rescheduled_from, credit_amount, moved_to,
         sport:sports ( name ), booking_extras ( name, qty ), open_games ( spots ),
         player:users!bookings_user_id_fkey ( full_name, phone ),
         court:courts ( name, facility:facilities ( name ) )`,
        { count: 'exact' }
      )
      .eq('booking_source', 'player');
    if (courtFilter) q = q.eq('court_id', courtFilter);
    if (tab === 'upcoming') q = q.gte('end_time', nowIso).order('start_time', { ascending: true });
    else if (tab === 'past') q = q.lt('end_time', nowIso).order('start_time', { ascending: false });
    else q = q.order('start_time', { ascending: false });
    if (show === 'paid') q = q.neq('status', 'cancelled').eq('payment_status', 'paid');
    else if (show === 'cancelled') q = q.eq('status', 'cancelled').is('moved_to', null).or('rescheduled_from.is.null,payment_status.neq.unpaid');
    else q = q.or(`status.neq.cancelled,and(${NOT_MOVED})`);
    const { data, count } = await q.range(from, from + PAGE_SIZE - 1);
    setRows((data as any[]) || []);
    setTotal(count || 0);
  }, [tab, show, page, courtFilter]);

  useEffect(() => { load(); }, [load]);

  function pick(next: () => void) {
    next();
    setPage(1);
    setCancellingId(null);
    setMessage('');
  }

  async function confirmCancel(id: string) {
    if (!cancelReason.trim()) return setMessage(t('Please write a short reason — the player will see it.'));
    setCancelBusy(true);
    setMessage('');
    const { data, error } = await supabase.rpc('cancel_booking', { p_booking_id: id, p_reason: cancelReason });
    setCancelBusy(false);
    if (error) return setMessage(`❌ ${error.message}`);
    const r = data as { owner_fee?: number; refund?: number } | null;
    setCancellingId(null);
    setCancelReason('');
    setMessage(Number(r?.owner_fee) > 0
      ? `✅ ${t("Booking cancelled. Zaf Play refunds the player {refund}; InstaPay's fee for that refund ({fee}) is deducted from your next payout.", { refund: fmtEGP(Number(r?.refund)), fee: fmtEGP(Number(r?.owner_fee)) })}`
      : `✅ ${t('Booking cancelled. The player can see it in their bookings with your reason.')}`);
    load();
  }

  async function markNoShow(id: string, noShow: boolean) {
    setMessage('');
    const { error } = await supabase.rpc('mark_no_show', { p_booking_id: id, p_no_show: noShow });
    if (error) return setMessage(`❌ ${error.message}`);
    setMessage(noShow ? `✅ ${t("Marked as a no-show. It shows on the player's record.")}` : `✅ ${t('No-show removed.')}`);
    load();
  }

  const over = (b: any) => new Date(b.end_time).getTime() <= Date.now();
  const canMarkNoShow = (b: any) => canManage && b.payment_status === 'paid' && ['confirmed', 'completed'].includes(b.status) && over(b);
  const canCancelRow = (b: any) => canManage && tab !== 'past' && ['pending', 'confirmed'].includes(b.status) && new Date(b.start_time) > new Date();

  function statusText(b: any) {
    if (b.status === 'no_show') return t('No-show');
    if (b.status === 'pending' && b.payment_status === 'unpaid') return t('Awaiting payment');
    if (b.status === 'pending' && b.payment_status === 'pending_review') return t('Payment in review');
    if (isMoved(b)) return t('Changed by the player');
    if (b.status === 'completed' || (b.status === 'confirmed' && over(b))) return t('Played');
    if (b.status === 'confirmed') return t('Upcoming');
    return t(b.status);
  }
  const tone = (b: any) => (b.status === 'cancelled' ? 'bad' : b.status === 'pending' ? 'warn' : b.status === 'no_show' ? 'neutral' : b.status === 'confirmed' && !over(b) ? 'ok' : 'info');

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.primary} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <Chips>
        {(['upcoming', 'past', 'all'] as Tab[]).map((x) => <Chip key={x} label={t(TAB_LABELS[x])} on={tab === x} onPress={() => pick(() => setTab(x))} />)}
      </Chips>
      <Muted>{t('Show:')}</Muted>
      <Chips>
        {(['paid', 'cancelled', 'all'] as Show[]).map((x) => <Chip key={x} label={t(SHOW_LABELS[x])} on={show === x} onPress={() => pick(() => setShow(x))} />)}
      </Chips>
      {courts.length > 1 && (
        <>
          <Muted>{t('Court:')}</Muted>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
            <Chip label={t('All courts')} on={!courtFilter} onPress={() => pick(() => setCourtFilter(''))} />
            {courts.map((c) => (
              <Chip key={c.id} label={`${c.name} · ${c.facility?.name}${c.is_active && c.is_approved ? '' : ` (${t('not active')})`}`}
                on={courtFilter === c.id} onPress={() => pick(() => setCourtFilter(c.id))} />
            ))}
          </ScrollView>
        </>
      )}
      {canManage && courts.some((c) => c.is_active && c.is_approved) && (
        <>
          <Muted>{t('Block time on a court:')}</Muted>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
            {courts.filter((c) => c.is_active && c.is_approved).map((c) => (
              <Chip key={c.id} label={`${c.name} · ${c.facility?.name} →`} on={false} onPress={() => router.push(`/owner/block/${c.id}` as Href)} />
            ))}
          </ScrollView>
        </>
      )}

      {!!message && <Text style={{ color: colors.text, marginBottom: 10 }}>{message}</Text>}

      {rows === null ? <Loading /> : rows.length === 0 ? (
        <Muted>
          {show === 'cancelled' ? t('No cancelled bookings here.')
            : show === 'paid' ? t('No paid bookings here.')
            : tab === 'upcoming' ? t('No upcoming bookings yet.')
            : tab === 'past' ? t('No past bookings yet.') : t('No bookings yet.')}
        </Muted>
      ) : rows.map((b) => {
        const refund = refundInfo(b);
        const game = Array.isArray(b.open_games) ? b.open_games[0] : b.open_games;
        return (
          <Box key={b.id}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontWeight: '800' }}>
                  {new Date(b.start_time).toLocaleDateString(locale, { timeZone: 'Africa/Cairo', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                </Text>
                <Muted>{tm(`${clock(b.start_time)} – ${clock(b.end_time)}`)}</Muted>
              </View>
              <Badge tone={tone(b)} text={statusText(b)} />
            </View>
            <Text style={{ color: colors.text, marginTop: 8 }}>
              {b.court?.name} · {b.court?.facility?.name}{b.sport?.name ? ` · ${b.sport.name}` : ''}
            </Text>
            {(b.booking_extras || []).length > 0 && (
              <Text style={{ color: colors.primary, fontSize: 12 }}>+ {(b.booking_extras as any[]).map((x) => `${x.name} × ${x.qty}`).join(', ')}</Text>
            )}
            {!!game && <Text style={{ color: colors.primaryAlt, fontSize: 12 }}>{t('Open game')}</Text>}
            <Text style={{ color: colors.text, marginTop: 4 }}>
              {t('Player')}: {b.player?.full_name || '—'}
              {b.player?.phone ? <Text style={{ color: colors.primaryAlt }} onPress={() => Linking.openURL(`tel:${b.player.phone}`)}>  {b.player.phone}</Text> : null}
            </Text>
            <Text style={{ color: colors.text, marginTop: 4 }}>
              {t('Price')}: {fmtEGP(b.total_price)}{showShare ? `  ·  ${t('Your share')}: ${fmtEGP(b.owner_net_amount)}` : ''}
              {b.payment_status === 'paid' ? <Text style={{ color: colors.success }}>  · {t('Paid')}</Text> : null}
            </Text>
            {b.cancel_request_status === 'pending' && b.status !== 'cancelled' && (
              <Text style={{ color: colors.warning, fontSize: 12, marginTop: 4 }}>{t('Player asked to cancel — Zaf Play is reviewing')}</Text>
            )}
            {b.status !== 'cancelled' && !!b.rescheduled_from && (
              <Muted style={{ fontSize: 12, marginTop: 4 }}>{t('Time changed by the player (before {a}, now {b})', { a: fmtEGP(b.credit_amount), b: fmtEGP(b.total_price) })}</Muted>
            )}
            {refund && (
              <View style={{ marginTop: 6 }}>
                <Badge tone={refund.tone === 'green' ? 'ok' : refund.tone === 'amber' ? 'warn' : 'bad'} text={t(refund.label)} />
                {(refund.sent || refund.due) && <Text style={{ color: colors.text, fontSize: 12, marginTop: 4 }}>{refund.sent ? `✅ ${t('Refund sent')}` : `⏳ ${t('Zaf Play is sending the refund')}`}</Text>}
                <Muted style={{ fontSize: 12, marginTop: 2 }}>{refund.detail}</Muted>
                {!(refund.kind === 'full' && b.cancelled_by === 'admin') && !!cancelReasonText(b) && <Muted style={{ fontSize: 12 }}>{cancelReasonText(b)}.</Muted>}
                {refund.refund > 0 && (
                  <Muted style={{ fontSize: 12 }}>
                    {t('Refund')} {fmtEGP(refund.refund)}{refund.fee > 0 ? ` (${t('after {fee} InstaPay fee', { fee: fmtEGP(refund.fee) })})` : ''}
                    {refund.kept > 0 ? ` · ${t('kept {amount}', { amount: fmtEGP(refund.kept) })}` : ''}
                  </Muted>
                )}
              </View>
            )}
            {b.status === 'cancelled' && !refund && (
              <Muted style={{ fontSize: 12, marginTop: 4 }}>
                {cancelReasonText(b) || t(b.cancelled_by === 'owner' ? 'by the branch' : b.cancelled_by === 'player' ? 'by the player' : 'by Zaf Play')}
              </Muted>
            )}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 }}>
              {canMarkNoShow(b) && <LinkButton title={t('Mark no-show')} onPress={() => markNoShow(b.id, true)} />}
              {canManage && b.status === 'no_show' && <LinkButton title={t('Undo no-show')} onPress={() => markNoShow(b.id, false)} />}
              {canCancelRow(b) && cancellingId !== b.id && (
                <LinkButton danger title={t('Cancel')} onPress={() => { setCancellingId(b.id); setCancelReason(''); setMessage(''); }} />
              )}
            </View>
            {cancellingId === b.id && (
              <View style={{ marginTop: 8 }}>
                <Text style={{ color: colors.text, fontWeight: '700', marginBottom: 4 }}>{t('Cancel this booking? Tell the player why:')}</Text>
                {b.payment_status === 'paid' && (
                  <Text style={{ color: colors.warning, fontSize: 12, marginBottom: 8 }}>
                    {t("The player paid, so Zaf Play refunds them in full. InstaPay's fee for sending that refund (0.1%, min 0.50, max 20 EGP — about {fee}) is deducted from your next payout.", { fee: fmtEGP(Math.min(20, Math.max(0.5, Math.round(Number(b.total_price) * 0.1) / 100))) })}
                  </Text>
                )}
                <Field label={t('Reason')} value={cancelReason} onChangeText={setCancelReason} placeholder={t('e.g. Court maintenance at this time')} />
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <View style={{ flex: 1 }}><Button small title={cancelBusy ? t('Cancelling...') : t('Yes, cancel booking')} onPress={() => confirmCancel(b.id)} loading={cancelBusy} /></View>
                  <View style={{ flex: 1 }}><Button small variant="ghost" title={t('Keep it')} onPress={() => setCancellingId(null)} /></View>
                </View>
              </View>
            )}
          </Box>
        );
      })}
      <Pager page={page} total={total} onChange={setPage} />
    </ScrollView>
  );
}
