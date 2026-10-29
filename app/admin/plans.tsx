import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Text } from '@/components/AppText';
import { supabase } from '@/lib/supabase';
import { searchMatches } from '@/lib/courtTimes';
import { courtPlanSummary, effectiveEnd, loadPlans, periodState, PLAN_NAMES, planDate, STATE_LABEL, type Period, type Plan, type PlanRequest } from '@/lib/plans';
import { useRequestId } from '@/lib/requestId';
import { colors } from '@/lib/theme';
import { Card, Line } from '@/components/admin';
import { Badge, Chip, Chips, H2, LinkButton, Loading, Muted, Pager, PAGE_SIZE } from '@/components/owner';
import { Button, Field } from '@/components/ui';

type Filter = 'all' | 'soon' | 'off' | 'trial' | 'partner';
const daysText = (n: number) => (n === 1 ? '1 day' : `${n} days`);

// Court Plans, like the website's admin page: owners' renew / stop requests, and every approved court's
// trial or partner plan with start, add, end and its history.
export default function AdminPlans() {
  const router = useRouter();
  const req = useRequestId(); // one id per attempt, so a double tap or retry is done once
  const [plans, setPlans] = useState<Record<string, Plan>>({});
  const [courts, setCourts] = useState<any[] | null>(null);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [requests, setRequests] = useState<PlanRequest[]>([]);
  const [upcoming, setUpcoming] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [openHistory, setOpenHistory] = useState<Record<string, boolean>>({});
  const [decliningId, setDecliningId] = useState<string | null>(null);
  const [ending, setEnding] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setPlans(await loadPlans());
    const [c, p, r, b] = await Promise.all([
      supabase.from('courts')
        .select('id, name, is_approved, is_active, bookable_until, created_at, facility:facilities ( id, name, city, owner:users ( full_name, phone, email ) )')
        .eq('is_approved', true).order('created_at', { ascending: true }),
      supabase.from('court_subscriptions').select('*').order('starts_at', { ascending: false }),
      supabase.from('court_plan_requests').select('*').order('created_at', { ascending: false }).limit(300),
      supabase.from('bookings').select('court_id').eq('booking_source', 'player').in('status', ['pending', 'confirmed']).gt('start_time', new Date().toISOString()),
    ]);
    setCourts(c.data || []);
    setPeriods((p.data as Period[]) || []);
    setRequests((r.data as PlanRequest[]) || []);
    const counts: Record<string, number> = {};
    ((b.data as any[]) || []).forEach((x) => (counts[x.court_id] = (counts[x.court_id] || 0) + 1));
    setUpcoming(counts);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function review(id: string, approve: boolean) {
    setBusy(true);
    setMessage('');
    const { data, error } = await supabase.rpc('admin_review_court_plan_request', { p_request_id: id, p_approve: approve, p_reason: approve ? null : reason });
    setBusy(false);
    if (error) return setMessage(`❌ ${error.message}`);
    setDecliningId(null);
    setReason('');
    const d = data as any;
    setMessage(!approve ? 'Request declined.' : d?.subscription_id ? '✅ Approved — the new period is lined up.'
      : `✅ Approved — the court is off now.${d?.upcoming_bookings ? ` ${d.upcoming_bookings} booking(s) already made stay booked.` : ''}`);
    load();
  }

  async function startPlan(courtId: string, plan: string) {
    setBusy(true);
    setMessage('');
    const { error } = await supabase.rpc('admin_start_court_plan', { p_request_id: req.get(), p_court_id: courtId, p_plan: plan });
    setBusy(false);
    if (error) return setMessage(`❌ ${error.message}`);
    req.done();
    setMessage(`✅ ${PLAN_NAMES[plan]} added.`);
    load();
  }

  async function endPlan(courtId: string) {
    setBusy(true);
    setMessage('');
    const { data, error } = await supabase.rpc('admin_end_court_plan', { p_court_id: courtId, p_reason: reason });
    setBusy(false);
    if (error) return setMessage(`❌ ${error.message}`);
    setEnding(null);
    setReason('');
    const d = data as any;
    setMessage(`Court plan ended — the court is off now.${d?.upcoming_bookings ? ` ${d.upcoming_bookings} booking(s) already made stay booked.` : ''}`);
    load();
  }

  const courtById: Record<string, any> = {};
  (courts || []).forEach((c) => (courtById[c.id] = c));
  const pending = requests.filter((r) => r.status === 'pending');
  const rows = (courts || []).map((c) => {
    const mine = periods.filter((p) => p.court_id === c.id);
    return { c, mine, s: courtPlanSummary(mine) };
  });
  const test = (f: Filter, s: ReturnType<typeof courtPlanSummary>) =>
    f === 'soon' ? s.endingSoon : f === 'off' ? !s.isLive : f === 'trial' ? s.current?.plan === 'trial' : f === 'partner' ? s.current?.plan === 'partner' : true;
  const labels: Record<Filter, string> = { all: 'All courts', soon: 'Ending soon', off: 'Off', trial: PLAN_NAMES.trial, partner: PLAN_NAMES.partner };
  const shown = rows.filter((r) => test(filter, r.s) && (!search.trim() || searchMatches(search,
    [r.c.name, r.c.facility?.name, r.c.facility?.city, r.c.facility?.owner?.full_name, r.c.facility?.owner?.phone, r.c.facility?.owner?.email].filter(Boolean).join(' '))));
  const paged = shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const now = Date.now();

  return (
    <>
      <Stack.Screen options={{ title: 'Court Plans' }} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
        {!!message && <Text style={{ color: colors.text, marginBottom: 10 }}>{message}</Text>}
        <H2>Requests ({pending.length})</H2>
        {courts === null ? <Loading /> : pending.length === 0 ? <Muted style={{ marginBottom: 16 }}>No requests waiting. 🎉</Muted> : pending.map((r) => {
          const c = courtById[r.court_id];
          const s = courtPlanSummary(periods.filter((p) => p.court_id === r.court_id));
          const next = plans[r.plan || 'partner'];
          return (
            <Card key={r.id} tone="warn">
              <Line bold size={15}>{r.kind === 'renew' ? `${s.isLive ? 'Renew' : 'Restart'} as ${PLAN_NAMES[r.plan || 'partner']}` : 'Stop this court'}</Line>
              <Line>{c?.name} · {c?.facility?.name}, {c?.facility?.city}</Line>
              <Line muted>{c?.facility?.owner?.full_name} · {c?.facility?.owner?.phone} · sent {planDate(r.created_at)}</Line>
              <Line muted>Now: {s.current ? `${PLAN_NAMES[s.current.plan]} ${Number(s.current.commission_percent)}% until ${planDate(s.current.ends_at)}` : 'no running plan (court is off)'}</Line>
              {r.kind === 'renew' && next && <Line muted>If approved: {next.name} {next.commission_percent}% from {s.isLive ? planDate(s.until) : 'today'} for {next.months} months</Line>}
              {r.kind === 'stop' && <Line muted>Upcoming bookings on this court: {upcoming[r.court_id] || 0} (they stay booked)</Line>}
              {!!r.note && <Line>Note: “{r.note}”</Line>}
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                <View style={{ flex: 1 }}><Button small title="Approve" onPress={() => review(r.id, true)} disabled={busy} /></View>
                <View style={{ flex: 1 }}><Button small variant="ghost" title="Decline" onPress={() => { setDecliningId(decliningId === r.id ? null : r.id); setReason(''); }} /></View>
              </View>
              {decliningId === r.id && (
                <>
                  <Field label="Reason the owner will see" value={reason} onChangeText={setReason} />
                  <Button small title="Decline request" onPress={() => review(r.id, false)} disabled={busy} />
                </>
              )}
            </Card>
          );
        })}

        <Chips>{(Object.keys(labels) as Filter[]).map((f) => <Chip key={f} label={`${labels[f]} (${rows.filter((r) => test(f, r.s)).length})`} on={filter === f} onPress={() => { setFilter(f); setPage(1); }} />)}</Chips>
        <Field label="Search" value={search} onChangeText={(v) => { setSearch(v); setPage(1); }} placeholder="Court, branch, city, owner name or phone" />
        {courts !== null && shown.length === 0 && <Muted>{search.trim() ? 'No courts match your search.' : 'Nothing here.'}</Muted>}
        {paged.map(({ c, mine, s }) => (
          <Card key={c.id}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View style={{ flex: 1 }}>
                <Line bold size={15}>{c.name}</Line>
                <Line muted size={12}>{c.facility?.name}, {c.facility?.city}</Line>
              </View>
              {s.current ? <Badge tone={s.endingSoon ? 'warn' : 'ok'} text={`${PLAN_NAMES[s.current.plan]} · ${Number(s.current.commission_percent)}%`} /> : <Badge tone="bad" text="Off" />}
            </View>
            <Line>Owner: <Text style={{ textDecorationLine: 'underline' }} onPress={() => router.push('/admin/users' as any)}>{c.facility?.owner?.full_name}</Text> · {c.facility?.owner?.phone}</Line>
            {s.current && (
              <>
                <Line muted>{planDate(s.current.starts_at)} → {planDate(s.current.ends_at)}</Line>
                <Text style={{ color: s.endingSoon ? colors.warning : colors.muted, fontSize: 12, fontWeight: s.endingSoon ? '700' : '400' }}>
                  {daysText(Math.max(0, Math.ceil((new Date(s.current.ends_at).getTime() - now) / 86400000)))} left
                </Text>
              </>
            )}
            <Line muted>Next: {s.upcoming ? `${PLAN_NAMES[s.upcoming.plan]} ${Number(s.upcoming.commission_percent)}%` : '—'}</Line>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 }}>
              {!s.upcoming && <LinkButton title={`${s.isLive ? 'Add' : 'Start'} ${PLAN_NAMES.partner}`} onPress={() => startPlan(c.id, 'partner')} disabled={busy} />}
              {!s.isLive && !s.upcoming && <LinkButton title={`Start ${PLAN_NAMES.trial}`} onPress={() => startPlan(c.id, 'trial')} disabled={busy} />}
              {s.isLive && <LinkButton title="End plan" onPress={() => { setEnding(ending === c.id ? null : c.id); setReason(''); }} />}
              {mine.length > 0 && <LinkButton title={openHistory[c.id] ? 'Hide history' : 'History'} onPress={() => setOpenHistory((h) => ({ ...h, [c.id]: !h[c.id] }))} />}
            </View>
            {ending === c.id && (
              <View style={{ marginTop: 8, borderWidth: 1, borderColor: colors.danger, borderRadius: 10, padding: 10 }}>
                <Line>End {c.name} now? {upcoming[c.id] ? `${upcoming[c.id]} upcoming booking(s) stay booked.` : ''}</Line>
                <Field label="Reason the owner will see" value={reason} onChangeText={setReason} />
                <Button small title="End plan" onPress={() => endPlan(c.id)} disabled={busy} />
              </View>
            )}
            {openHistory[c.id] && (
              <View style={{ marginTop: 8, backgroundColor: colors.bg, borderRadius: 10, padding: 8 }}>
                {mine.map((p) => {
                  const st = periodState(p);
                  return <Line key={p.id} size={12}>{PLAN_NAMES[p.plan]} · {Number(p.commission_percent)}% · {planDate(p.starts_at)} → {planDate(effectiveEnd(p))} · {STATE_LABEL[st]}{p.end_reason && (st === 'stopped' || st === 'cancelled') ? ` — ${p.end_reason}` : ''}</Line>;
                })}
                {requests.filter((r) => r.court_id === c.id && r.status !== 'pending').map((r) => (
                  <Line key={r.id} muted size={12}>Request · {r.kind === 'renew' ? `renew as ${PLAN_NAMES[r.plan || 'partner']}` : 'stop'} · {planDate(r.created_at)} · {r.status === 'rejected' ? 'declined' : r.status}{r.reject_reason ? ` — ${r.reject_reason}` : ''}</Line>
                ))}
              </View>
            )}
          </Card>
        ))}
        <Pager page={page} total={shown.length} onChange={setPage} />
      </ScrollView>
    </>
  );
}
