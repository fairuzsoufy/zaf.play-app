import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { Text } from '@/components/AppText';
import { supabase } from '@/lib/supabase';
import { dateTimeText, egp, teamSizeText } from '@/lib/format';
import { searchMatches } from '@/lib/courtTimes';
import { signedUrls, splitProofs } from '@/lib/admin';
import { colors } from '@/lib/theme';
import { Card, InstapayValue, Line, PhotoPick, ProofImages, uploadPicked, type Picked } from '@/components/admin';
import { TournamentHistory } from '@/components/TournamentHistory';
import { Badge, H2, LinkButton, Loading, Muted, Pager, PAGE_SIZE } from '@/components/owner';
import { Button, Field, Note } from '@/components/ui';

// Games & Tournaments, like the website's /admin/games: open-game and tournament payments to check,
// game refunds to send, tournaments to approve, and the history.
export default function AdminGames() {
  const router = useRouter();
  const [q, setQ] = useState<any>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [all, setAll] = useState<any[]>([]);
  const [hist, setHist] = useState<any>(null);
  const [histPage, setHistPage] = useState(1);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [msgFor, setMsgFor] = useState('');
  const [reason, setReason] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<Record<string, Picked>>({});
  const [search, setSearch] = useState('');
  const [allPage, setAllPage] = useState(1);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_games_queue');
    if (error) return setMsg(`❌ ${error.message}`);
    const d = data as any;
    setQ(d);
    setUrls(await signedUrls('payment-proofs', [...(d?.team_payments || []), ...(d?.game_payments || [])].flatMap((x: any) => splitProofs(x.proof_path))));
    const { data: list } = await supabase.rpc('owner_tournaments');
    setAll(((list as any[]) || []).filter((t) => t.status !== 'pending'));
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { supabase.rpc('admin_open_game_history', { p_page: histPage }).then(({ data }) => data && setHist(data)); }, [histPage, q]);
  useEffect(() => { if (!msg) return; const t = setTimeout(() => { setMsg(''); setMsgFor(''); }, 8000); return () => clearTimeout(t); }, [msg]);

  async function act(key: string, fn: () => PromiseLike<{ error: { message: string } | null }>, done: string) {
    setBusy(key);
    setMsg('');
    const { error } = await fn();
    setBusy('');
    setMsg(error ? `❌ ${error.message}` : done);
    setMsgFor(error ? key : '');
    load();
  }

  async function refund(r: any) {
    setMsgFor('');
    const f = files[r.id];
    if (!f) return setMsg('⚠️ Please attach the photo of the InstaPay transfer first.');
    const { path, error } = await uploadPicked('refund-proofs', `${r.kind}-${r.id}`, f);
    if (error) return setMsg(`❌ ${error}`);
    await act(r.id, () => (r.kind === 'game'
      ? supabase.rpc('admin_mark_open_game_refunded', { p_player_id: r.id, p_proof_path: path })
      : supabase.rpc('admin_mark_team_refunded', { p_team_id: r.id, p_proof_path: path })), '✅ Refund marked as sent.');
  }

  if (!q) return msg ? <View style={{ padding: 16 }}><Note kind="error">{msg}</Note></View> : <Loading />;

  const decide = ({ id, onYes, onNo, yes = 'Approve' }: { id: string; onYes: () => void; onNo: () => void; yes?: string }) => (
    <View style={{ marginTop: 8 }}>
      <Field label="Reason (if rejecting)" value={reason[id] || ''} onChangeText={(v) => setReason({ ...reason, [id]: v })} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}><Button small title={yes} onPress={onYes} loading={busy === id} /></View>
        <View style={{ flex: 1 }}><Button small variant="ghost" title="Reject" onPress={onNo} disabled={busy === id || !(reason[id] || '').trim()} /></View>
      </View>
      {!!msg && msgFor === id && <Text style={{ color: msg.startsWith('❌') ? colors.danger : colors.success, fontSize: 13, marginTop: 4 }}>{msg}</Text>}
    </View>
  );
  const m = (x: any, ...fields: any[]) => searchMatches(search, fields.join(' '));
  const gamePays = (q.game_payments || []).filter((p: any) => m(p, p.player, p.phone, p.game));
  const teamPays = (q.team_payments || []).filter((p: any) => m(p, p.team, p.tournament, p.captain, p.phone));
  const refunds = (q.refunds || []).filter((r: any) => m(r, r.who, r.phone, r.what));
  const toApprove = (q.tournaments || []).filter((t: any) => m(t, t.title, t.sport, t.court, t.branch, t.by));
  const allFound = all.filter((t) => m(t, t.title, t.court, t.branch, t.status));

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.primary} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <Stack.Screen options={{ title: 'Games & Tournaments' }} />
      {!!msg && !msgFor && <Note kind={msg.startsWith('❌') || msg.startsWith('⚠️') ? 'error' : 'ok'}>{msg}</Note>}
      <Field label="Search by name, phone, game, team or tournament" value={search} onChangeText={setSearch} />

      <H2>Open-game payments ({q.game_payments.length})</H2>
      {gamePays.length === 0 ? <Muted style={{ marginBottom: 16 }}>Nothing waiting.</Muted> : gamePays.map((p: any) => (
        <Card key={p.id}>
          <ProofImages paths={splitProofs(p.proof_path)} urls={urls} />
          <Line bold>{egp(p.amount)} · {p.player}{p.is_host ? ' (host)' : ''} · {p.phone}</Line>
          <Line muted>{p.game}</Line>
          {p.game_status === 'cancelled' && <Note kind="error">This game was cancelled by the host. If you approve, the money is added to the refunds to send back in full.</Note>}
          <Line>This payment covers <Text style={{ fontWeight: '700' }}>{p.seats} spot{p.seats > 1 ? 's' : ''}</Text> out of {p.spots}{p.seats > 1 && p.is_host ? ' (the host paid for friends too)' : ''}.</Line>
          <Line muted size={12}>Approved so far: {p.paid} of {p.spots} · after approving: {Math.min(p.spots, Number(p.paid) + Number(p.seats))} of {p.spots} paid, {Math.max(0, p.spots - Number(p.paid) - Number(p.seats))} still open</Line>
          <Line size={12}>Refunds to <InstapayValue value={p.refund_to} /></Line>
          {decide({
            id: p.id,
            onYes: () => act(p.id, () => supabase.rpc('admin_review_open_game_payment', { p_player_id: p.id, p_approve: true }), '✅ Approved.'),
            onNo: () => act(p.id, () => supabase.rpc('admin_review_open_game_payment', { p_player_id: p.id, p_approve: false, p_reason: reason[p.id] }), 'Rejected.'),
          })}
        </Card>
      ))}

      <H2>Tournament entry payments ({q.team_payments.length})</H2>
      {teamPays.length === 0 ? <Muted style={{ marginBottom: 16 }}>Nothing waiting.</Muted> : teamPays.map((p: any) => (
        <Card key={p.id}>
          <ProofImages paths={splitProofs(p.proof_path)} urls={urls} />
          <Line bold>{egp(p.amount)} · team {p.team}</Line>
          <Text style={{ color: colors.primaryAlt, fontSize: 13 }} onPress={() => router.push(`/tournament/${p.code}`)}>{p.tournament}</Text>
          <Line muted>captain {p.captain} · {p.phone}</Line>
          <Line size={12}>Refunds to <InstapayValue value={p.refund_to} /></Line>
          {decide({
            id: p.id,
            onYes: () => act(p.id, () => supabase.rpc('admin_review_team_payment', { p_team_id: p.id, p_approve: true }), '✅ Team confirmed.'),
            onNo: () => act(p.id, () => supabase.rpc('admin_review_team_payment', { p_team_id: p.id, p_approve: false, p_reason: reason[p.id] }), 'Rejected — the captain can pay again.'),
          })}
        </Card>
      ))}

      <H2>Refunds to send ({q.refunds.length})</H2>
      {refunds.length === 0 ? <Muted style={{ marginBottom: 16 }}>Nothing to send.</Muted> : refunds.map((r: any) => (
        <Card key={r.id}>
          <Line bold>Send {egp(r.amount)} to <InstapayValue value={r.refund_to} /></Line>
          <Line muted>{r.who} · {r.phone} — {r.what}</Line>
          {Number(r.fee) > 0 && <Line muted size={12}>InstaPay fee {egp(r.fee)} already taken off (the player left).</Line>}
          <PhotoPick title="Photo of the transfer (shown to the player)" value={files[r.id] || null} onChange={(f) => setFiles({ ...files, [r.id]: f })} />
          <Button small title="Mark as sent" onPress={() => refund(r)} loading={busy === r.id} />
          {!!msg && msgFor === r.id && <Text style={{ color: colors.danger, fontSize: 13 }}>{msg}</Text>}
        </Card>
      ))}

      <H2>Tournaments to approve ({q.tournaments.length})</H2>
      {toApprove.length === 0 ? <Muted style={{ marginBottom: 16 }}>Nothing waiting.</Muted> : toApprove.map((t: any) => (
        <Card key={t.id}>
          <Line bold size={15}>{t.title}</Line>
          <Line muted>{t.sport} · {teamSizeText(t.team_size)} · {t.format === 'groups' ? 'Groups + knockout' : 'Knockout'} · up to {t.max_teams} teams · {Number(t.entry_fee) > 0 ? `${egp(t.entry_fee)} / team` : 'free'}</Line>
          <Line muted>{t.court} ({t.branch}) · by {t.by}</Line>
          <Line muted size={12}>Registration {dateTimeText(t.reg_opens_at)} → {dateTimeText(t.reg_closes_at)} · Plays {dateTimeText(t.starts_at)} → {dateTimeText(t.ends_at)}</Line>
          {t.description && <Line>{t.description}</Line>}
          <TournamentHistory id={t.id} />
          {decide({
            id: t.id,
            onYes: () => act(t.id, () => supabase.rpc('admin_review_tournament', { p_id: t.id, p_approve: true }), '✅ Tournament approved — the court is blocked for it.'),
            onNo: () => act(t.id, () => supabase.rpc('admin_review_tournament', { p_id: t.id, p_approve: false, p_reason: reason[t.id] }), 'Rejected.'),
          })}
        </Card>
      ))}

      <H2>Open-game history{hist ? ` (${hist.total})` : ''}</H2>
      <Muted style={{ marginBottom: 8 }}>Every game where you checked a payment, newest first.</Muted>
      {!hist || hist.games.length === 0 ? <Muted style={{ marginBottom: 16 }}>No approved games yet.</Muted> : (
        <>
          {hist.games.map((h: any) => (
            <Card key={h.game_id}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                <Line bold>{h.game}</Line>
                <Badge tone={h.status === 'cancelled' ? 'neutral' : h.status === 'full' ? 'ok' : 'info'} text={h.status === 'full' ? 'Full — game is on' : h.status === 'cancelled' ? 'Cancelled' : 'Open'} />
              </View>
              <Line muted size={12}>Host {h.host} · {h.taken}/{h.spots} spots filled · {egp(h.price_per_spot)} per spot</Line>
              {h.status === 'cancelled' && h.cancel_reason && <Line muted size={12}>{h.cancel_reason}</Line>}
              {(h.payments || []).map((x: any) => (
                <View key={x.id} style={{ borderTopWidth: 1, borderColor: colors.border, paddingVertical: 6, marginTop: 4 }}>
                  <Line>{x.player}{x.is_host ? ' (host)' : ''} · {x.seats} spot{x.seats > 1 ? 's' : ''} · {egp(x.amount)} · {x.status === 'rejected' ? '❌ Rejected' : x.status === 'left' ? '↩ Left the game' : x.status === 'paid' ? '✅ Approved' : x.status}</Line>
                  {x.paid_sent_at && <Line muted size={11}>💳 Paid (sent the screenshot): {dateTimeText(x.paid_sent_at)}</Line>}
                  {x.reviewed_at && <Line muted size={11}>{x.status === 'rejected' ? '❌ Rejected' : '✅ Checked by you'}: {dateTimeText(x.reviewed_at)}</Line>}
                  {x.reject_reason && <Line muted size={11}>Reason: {x.reject_reason}</Line>}
                  {x.left_at && <Line muted size={11}>↩ Asked to leave: {dateTimeText(x.left_at)}</Line>}
                  {x.refund_status === 'due' && <Line muted size={11}>⏳ Refund of {egp(x.refund_amount)} still to send</Line>}
                  {x.refund_status === 'refunded' && <Line muted size={11}>💸 Refunded {egp(x.refund_amount)}: {x.refunded_at ? dateTimeText(x.refunded_at) : ''}</Line>}
                  {/* a full game can't be left online: the admin takes the seat off with a refund */}
                  {h.status === 'full' && x.status === 'paid' && !x.is_host && (
                    <LinkButton danger title="Remove from the game and refund" disabled={busy === `rm-${x.id}`}
                      onPress={() => act(`rm-${x.id}`, () => supabase.rpc('admin_remove_open_game_player', { p_player_id: x.id }), `Seat removed. ${x.player}'s refund is in the refunds list (minus the InstaPay fee).`)} />
                  )}
                </View>
              ))}
            </Card>
          ))}
          <Pager page={histPage} total={hist.total} onChange={setHistPage} />
        </>
      )}

      <H2>All tournaments</H2>
      {all.length === 0 ? <Muted>None yet. Owners create them from their dashboard (Tournaments tab).</Muted> : (
        <>
          {allFound.slice((allPage - 1) * PAGE_SIZE, allPage * PAGE_SIZE).map((t) => (
            <Card key={t.id}>
              <Text style={{ color: colors.primaryAlt, fontWeight: '700' }} onPress={() => router.push(`/tournament/${t.code}`)}>{t.title}</Text>
              <Line muted size={12}>{t.court} ({t.branch}) · {dateTimeText(t.starts_at)} · {t.confirmed}/{t.max_teams} teams · {t.status}</Line>
              <TournamentHistory id={t.id} />
            </Card>
          ))}
          <Pager page={allPage} total={allFound.length} onChange={setAllPage} />
        </>
      )}
    </ScrollView>
  );
}
