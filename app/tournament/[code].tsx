import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { colors, radius, themed } from '@/lib/theme';
import { dateTimeText, egp, roundName, teamSizeText, timeLabel, untilText } from '@/lib/format';
import { instapayFee, REVIEW_MINUTES } from '@/lib/payment';
import { useRequestId } from '@/lib/requestId';
import { Button, Note } from '@/components/ui';
import { ProofForm } from '@/components/ProofForm';
import { PlayerSearch, type FoundPlayer } from '@/components/PlayerSearch';
import { askToNotify } from '@/components/BookingAlerts';

const STATUS_TEXT: Record<string, string> = {
  pending: 'Waiting for Zaf Play approval',
  rejected: 'Not approved',
  approved: 'Registration',
  closed: 'Registration closed',
  scheduled: 'Schedule ready',
  finished: 'Finished',
  cancelled: 'Cancelled',
};

// A tournament (the website's /t/[code]): register a team, invite teammates, pay the entry fee, follow teams,
// groups, the knockout and results. Owners and staff who run it can close registration, make the schedule,
// enter scores and cancel.
export default function Tournament() {
  const s = useS();
  const insets = useSafeAreaInsets();
  const { code } = useLocalSearchParams<{ code: string }>();
  const router = useRouter();
  const { session } = useAuth();
  const req = useRequestId();
  const [t, setT] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [teamName, setTeamName] = useState('');
  const [mates, setMates] = useState<FoundPlayer[]>([]);
  const [swapFor, setSwapFor] = useState<string | null>(null);
  const [scores, setScores] = useState<Record<string, { a: string; b: string }>>({});
  const scroll = useRef<ScrollView>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('tournament_page', { p_code: code });
    setT(data);
    setLoading(false);
  }, [code]);

  useEffect(() => { load(); }, [load, session]);
  useEffect(() => { const x = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(x); }, []);
  const tid: string = t?.id || '';
  useEffect(() => {
    if (!tid) return;
    const ch = supabase.channel(`t-${tid}-${Date.now()}`)
      .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'tournaments', filter: `id=eq.${tid}` }, () => load())
      .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'tournament_teams', filter: `tournament_id=eq.${tid}` }, () => load())
      .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'tournament_members' }, () => load())
      .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'tournament_matches', filter: `tournament_id=eq.${tid}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [tid, load]);

  async function run(fn: () => PromiseLike<{ error: { message: string } | null }>, ok: string) {
    setBusy(true);
    setMsg('');
    const { error } = await fn();
    if (!error) req.done();
    setBusy(false);
    setMsg(error ? `❌ ${error.message}` : ok);
    load();
  }

  function ask(title: string, message: string, onYes: () => void) {
    Alert.alert(title, message, [{ text: 'No', style: 'cancel' }, { text: 'Yes', style: 'destructive', onPress: onYes }]);
  }

  async function register() {
    if (!session) return router.push('/login');
    if (!teamName.trim() && t.team_size > 1) return setMsg('Please choose a team name.');
    await run(() => supabase.rpc('create_team', { p_request_id: req.get(), p_tournament_id: t.id, p_name: teamName.trim(), p_members: mates.map((m) => m.id) }),
      t.team_size > 1 ? '✅ Team created. Your teammates got an invitation, they accept it in Games → My games.' : '✅ You are registered. Now pay the entry fee.');
    setMates([]);
  }

  if (loading) return <ActivityIndicator style={{ marginTop: 60 }} color={colors.primary} />;
  if (!t) return <Text style={{ color: colors.muted, margin: 40, textAlign: 'center' }}>Tournament not found.</Text>;

  const opens = new Date(t.reg_opens_at).getTime();
  const closes = new Date(t.reg_closes_at).getTime();
  const regOpen = t.status === 'approved' && now >= opens && now < closes;
  const my = t.my_team;
  const myActive = my && ['forming', 'ready', 'review', 'confirmed'].includes(my.status);
  const full = t.confirmed >= t.max_teams;
  const groups: string[] = Array.from(new Set((t.standings || []).map((x: any) => x.group_label))) as string[];
  const groupMatches = (t.matches || []).filter((m: any) => m.stage === 'group');
  const koMatches = (t.matches || []).filter((m: any) => m.stage === 'knockout' && m.status !== 'bye');
  const rounds: number[] = (Array.from(new Set(koMatches.map((m: any) => m.round))) as number[]).sort((a, b) => a - b);
  const champion = t.status === 'finished' ? koMatches.find((m: any) => m.round === t.rounds)?.winner_id : null;
  const championName = champion ? (t.teams || []).find((x: any) => x.id === champion)?.name : null;

  const matchRow = (m: any) => {
    const sc = scores[m.id] || { a: m.score_a != null ? String(m.score_a) : '', b: m.score_b != null ? String(m.score_b) : '' };
    const canScore = t.can_manage && m.a && m.b && ['scheduled', 'done'].includes(m.status);
    return (
      <View key={m.id} style={[s.card, { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6, padding: 10 }]}>
        <Text style={{ color: colors.muted, width: 62, fontSize: 12 }}>{m.starts_at ? timeLabel(m.starts_at) : '—'}</Text>
        <Text style={{ color: colors.text, flex: 1 }}>
          <Text style={m.winner_id && m.winner_id === m.a_id ? { fontWeight: '800' } : null}>{m.a || 'TBD'}</Text>
          <Text style={{ color: colors.muted }}> vs </Text>
          <Text style={m.winner_id && m.winner_id === m.b_id ? { fontWeight: '800' } : null}>{m.b || 'TBD'}</Text>
        </Text>
        {canScore ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <TextInput value={sc.a} keyboardType="number-pad" onChangeText={(v) => setScores({ ...scores, [m.id]: { ...sc, a: v.replace(/\D/g, '') } })} style={s.score} accessibilityLabel="Score" />
            <Text style={{ color: colors.muted }}>–</Text>
            <TextInput value={sc.b} keyboardType="number-pad" onChangeText={(v) => setScores({ ...scores, [m.id]: { ...sc, b: v.replace(/\D/g, '') } })} style={s.score} accessibilityLabel="Score" />
            <Button small title="Save" disabled={busy || sc.a === '' || sc.b === ''}
              onPress={() => run(() => supabase.rpc('set_match_score', { p_match_id: m.id, p_score_a: Number(sc.a), p_score_b: Number(sc.b) }), '✅ Score saved.')} />
          </View>
        ) : (
          <Text style={{ color: colors.text, fontWeight: '700' }}>{m.status === 'done' ? `${m.score_a} – ${m.score_b}` : ''}</Text>
        )}
      </View>
    );
  };

  const myStatusText = !my ? '' : my.status === 'forming' ? 'Waiting for teammates' : my.status === 'ready' ? (my.is_captain ? 'Ready, pay to enter' : 'Waiting for the captain to pay')
    : my.status === 'review' ? 'Payment being checked' : 'You are in ✓';

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior="padding" keyboardVerticalOffset={insets.top + (Platform.OS === 'ios' ? 44 : 56)}>
    <ScrollView ref={scroll} style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: 'Tournament' }} />
      <Text style={{ color: colors.brandPink, fontWeight: '700' }}>🏆 {t.sport} tournament</Text>
      <Text style={{ color: colors.text, fontSize: 24, fontWeight: '800', marginTop: 2 }}>{t.title}</Text>
      <Text style={{ color: colors.muted }}>{t.court} · {t.branch}, {t.city}</Text>
      <View style={{ marginTop: 10, alignSelf: 'flex-start' }}>
        <Button small variant="ghost" title="Share link" onPress={() => Share.share({ message: `${t.title} on Zaf Play: https://zafplay.com/t/${t.code}` })} />
      </View>

      {championName && <View style={[s.card, { marginTop: 14, borderColor: colors.brandPink }]}><Text style={{ color: colors.muted }}>Champions</Text><Text style={{ color: colors.text, fontWeight: '800', fontSize: 20 }}>{championName}</Text></View>}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
        <Fact label="Starts" value={dateTimeText(t.starts_at)} />
        <Fact label="Format" value={`${teamSizeText(t.team_size)}\n${t.format === 'groups' ? 'Groups, then knockout' : 'Knockout'}`} />
        <Fact label="Entry fee" value={Number(t.entry_fee) > 0 ? `${egp(t.entry_fee)} / team` : 'Free'} />
        <Fact label="Teams" value={`${t.confirmed} / ${t.max_teams}`} />
      </View>
      {!!t.description && <Text style={{ color: colors.text, marginTop: 12 }}>{t.description}</Text>}

      <View style={[s.card, { marginTop: 14 }]}>
        <Text style={{ color: regOpen ? colors.success : colors.muted, fontWeight: '700' }}>
          {t.status === 'approved' ? (now < opens ? 'Registration not open yet' : now < closes ? 'Registration open' : 'Registration closed') : STATUS_TEXT[t.status]}
        </Text>
        <Text style={{ color: colors.muted, marginTop: 4 }}>Opens {dateTimeText(t.reg_opens_at)}{now < opens ? ` (${untilText(t.reg_opens_at, now)})` : ''}</Text>
        <Text style={{ color: colors.muted }}>Closes {dateTimeText(t.reg_closes_at)}{regOpen ? ` (${untilText(t.reg_closes_at, now)})` : ''}</Text>
      </View>
      {t.status === 'cancelled' && <View style={{ marginTop: 10 }}><Note kind="error">This tournament was cancelled{t.cancel_reason ? `: ${t.cancel_reason}` : ''}. Paid teams get their entry fee back in full.</Note></View>}
      {t.status === 'rejected' && <View style={{ marginTop: 10 }}><Note kind="error">Not approved{t.reject_reason ? `: ${t.reject_reason}` : ''}.</Note></View>}
      {t.status === 'pending' && <View style={{ marginTop: 10 }}><Note kind="ok">Zaf Play is reviewing this tournament. Players will see it once it's approved.</Note></View>}

      {!!msg && <Text style={{ color: colors.text, marginTop: 12 }}>{msg}</Text>}

      {/* the owner moved the tournament: the captain keeps the place or withdraws with a full refund */}
      {my?.is_captain && my.status === 'confirmed' && my.time_change_answer === 'pending' && (
        <View style={[s.card, { marginTop: 14, borderColor: colors.warning, gap: 8 }]}>
          <Text style={{ color: colors.warning, fontWeight: '700' }}>The tournament time changed</Text>
          <Text style={{ color: colors.text }}>It now plays {dateTimeText(t.starts_at)} → {dateTimeText(t.ends_at)}. Can your team still play?</Text>
          <Button small title="Keep our place at the new time" disabled={busy}
            onPress={() => run(() => supabase.rpc('answer_tournament_time_change', { p_team_id: my.id, p_stay: true }), '✅ Your team keeps its place at the new time.')} />
          <Button small variant="ghost" title="Withdraw with a full refund" disabled={busy}
            onPress={() => run(() => supabase.rpc('answer_tournament_time_change', { p_team_id: my.id, p_stay: false }), 'Your team was withdrawn. The entry fee comes back to you in full.')} />
          <Text style={{ color: colors.muted, fontSize: 12 }}>If you don't answer, your team keeps its place.</Text>
        </View>
      )}

      <View style={{ marginTop: 14 }}>
        {myActive ? (
          <View style={[s.card, { gap: 10 }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
              <Text style={{ color: colors.text, fontWeight: '700', flex: 1 }}>Your team: {my.name}</Text>
              <Text style={{ color: my.status === 'confirmed' ? colors.success : colors.primary, fontWeight: '700', fontSize: 12 }}>{myStatusText}</Text>
            </View>
            {(my.members || []).map((m: any) => (
              <View key={m.user_id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <Text style={{ color: colors.text, flex: 1 }}>{m.name}{m.username ? <Text style={{ color: colors.muted }}> @{m.username}</Text> : null}{m.is_captain ? <Text style={{ color: colors.primary }}>  Captain</Text> : null}</Text>
                <Text style={{ color: m.status === 'accepted' ? colors.success : m.status === 'declined' ? colors.brandPink : colors.muted, fontSize: 12 }}>
                  {m.status === 'accepted' ? 'In' : m.status === 'declined' ? 'Declined' : 'Invited'}
                </Text>
                {my.is_captain && !m.is_captain && m.status !== 'accepted' && ['forming', 'ready'].includes(my.status) && (
                  <Pressable onPress={() => setSwapFor(swapFor === m.user_id ? null : m.user_id)}><Text style={s.link}>Replace</Text></Pressable>
                )}
              </View>
            ))}
            {swapFor && (
              <PlayerSearch exclude={(my.members || []).map((m: any) => m.user_id)} onPick={(p) => {
                const old = swapFor;
                setSwapFor(null);
                run(() => supabase.rpc('replace_teammate', { p_team_id: my.id, p_old: old, p_new: p.id }), `✅ ${p.full_name} was invited.`);
              }} />
            )}
            {my.my_status === 'invited' && (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 1 }}><Button small title="Accept invitation" disabled={busy} onPress={() => run(() => supabase.rpc('respond_team_invite', { p_team_id: my.id, p_accept: true }), '✅ You joined the team.')} /></View>
                <View style={{ flex: 1 }}><Button small variant="ghost" title="Decline" disabled={busy} onPress={() => run(() => supabase.rpc('respond_team_invite', { p_team_id: my.id, p_accept: false }), 'Invitation declined.')} /></View>
              </View>
            )}
            {my.status === 'ready' && my.is_captain && regOpen && !full && (Number(t.entry_fee) > 0 ? (
              <>
                <Text style={{ color: colors.text }}>You pay for the whole team ({t.team_size} player{t.team_size > 1 ? 's' : ''}). Your place is saved once we approve the payment: first paid, first in.</Text>
                <ProofForm amount={Number(t.entry_fee)} onFocusRefund={() => setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 300)}
                  onSubmit={async (path, refundTo) => {
                    const { error } = await supabase.rpc('submit_team_payment', { p_request_id: req.get(), p_team_id: my.id, p_proof_path: path, p_refund_to: refundTo });
                    if (!error) { req.done(); askToNotify(); }
                    load();
                    return error ? error.message : null;
                  }} />
              </>
            ) : (
              <Button title="Confirm our place (free)" disabled={busy}
                onPress={() => run(() => supabase.rpc('submit_team_payment', { p_request_id: req.get(), p_team_id: my.id, p_proof_path: null, p_refund_to: null }), '✅ Your team is in!')} />
            ))}
            {my.status === 'ready' && my.is_captain && regOpen && full && <Text style={{ color: colors.danger }}>The tournament is full. You can still withdraw your team.</Text>}
            {!!my.reject_reason && my.status === 'ready' && <Text style={{ color: colors.danger }}>Last payment wasn't accepted: {my.reject_reason}</Text>}
            {my.status === 'review' && <Text style={{ color: colors.muted }}>We check payments within {REVIEW_MINUTES} minutes. This page updates by itself.</Text>}
            {my.is_captain && ['forming', 'ready'].includes(my.status) && (
              <Pressable onPress={() => ask('Withdraw your team?', 'Your team is removed from the tournament.', () => run(() => supabase.rpc('withdraw_team', { p_team_id: my.id }), 'Your team was withdrawn.'))}>
                <Text style={s.link}>Withdraw team</Text>
              </Pressable>
            )}
            {my.is_captain && my.status === 'confirmed' && regOpen && (
              <Pressable onPress={() => ask('Withdraw your team?', "Your place is released and the entry fee is sent back to your InstaPay (minus InstaPay's small fee).", () => run(() => supabase.rpc('withdraw_team', { p_team_id: my.id }), 'Your team was withdrawn.'))}>
                <Text style={s.link}>Withdraw team (refund {egp(Number(my.amount) - instapayFee(Number(my.amount)))})</Text>
              </Pressable>
            )}
            {!my.is_captain && my.my_status === 'accepted' && ['forming', 'ready'].includes(my.status) && (
              <Pressable onPress={() => ask('Leave this team?', 'Your captain can invite someone else.', () => run(() => supabase.rpc('leave_team', { p_team_id: my.id }), 'You left the team.'))}>
                <Text style={s.link}>Leave team</Text>
              </Pressable>
            )}
          </View>
        ) : regOpen && !full ? (
          <View style={[s.card, { gap: 10 }]}>
            <Text style={{ color: colors.text, fontWeight: '700' }}>{t.team_size > 1 ? 'Register your team' : 'Register'}</Text>
            {t.team_size > 1 && (
              <>
                <TextInput value={teamName} onChangeText={setTeamName} maxLength={30} placeholder="Team name (English)" placeholderTextColor={colors.muted} style={s.input} />
                <Text style={{ color: colors.text }}>Teammates ({mates.length}/{t.team_size - 1})</Text>
                {mates.map((m) => (
                  <View key={m.id} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ color: colors.text }}>{m.full_name} {m.username ? <Text style={{ color: colors.muted }}>@{m.username}</Text> : null}</Text>
                    <Pressable onPress={() => setMates(mates.filter((x) => x.id !== m.id))}><Text style={s.link}>Remove</Text></Pressable>
                  </View>
                ))}
                {!!session && mates.length < t.team_size - 1 && <PlayerSearch exclude={mates.map((m) => m.id)} onPick={(p) => setMates([...mates, p])} />}
                <Text style={{ color: colors.muted, fontSize: 12 }}>Your teammates get an invitation and must accept it. Then you (the captain) pay the entry fee for the whole team.</Text>
              </>
            )}
            <Button title={!session ? 'Log in to register' : t.team_size > 1 ? 'Create team & send invitations' : 'Register'}
              disabled={busy || (!!session && mates.length < t.team_size - 1)} onPress={register} />
          </View>
        ) : regOpen && full ? (
          <View style={s.card}><Text style={{ color: colors.text }}>The tournament is full.</Text></View>
        ) : null}
        {my && my.refund_status && my.refund_status !== 'none' && (
          <View style={[s.card, { marginTop: 10 }]}>
            <Text style={{ color: colors.text }}>Refund of <Text style={{ fontWeight: '700' }}>{egp(my.refund_amount)}</Text> {my.refund_status === 'refunded' ? 'was sent ✓' : 'is on its way to your InstaPay.'}</Text>
          </View>
        )}
      </View>

      {t.can_manage && !['cancelled', 'finished', 'rejected'].includes(t.status) && (
        <View style={[s.card, { marginTop: 14, borderColor: colors.brandPink, gap: 8 }]}>
          <Text style={{ color: colors.text, fontWeight: '700' }}>Run this tournament</Text>
          {t.status === 'approved' && (
            <Button small variant="ghost" title="Close registration now" disabled={busy}
              onPress={() => ask('Close registration now?', "Teams that haven't paid yet are removed. Then you can make the schedule.", () => run(() => supabase.rpc('close_tournament_registration', { p_id: t.id }), '✅ Registration closed.'))} />
          )}
          {['closed', 'scheduled'].includes(t.status) && !(t.matches || []).some((m: any) => m.status === 'done' && m.score_a !== null) && (
            <Button small title={t.status === 'scheduled' ? 'Make the schedule again (new draw)' : 'Make the schedule'} disabled={busy}
              onPress={() => run(() => supabase.rpc('make_tournament_schedule', { p_id: t.id }), '✅ Schedule made. Enter the scores below as the games finish.')} />
          )}
          <Pressable onPress={() => ask('Cancel the tournament?', 'The court is released and every paid team gets its entry fee back in full.', () => run(() => supabase.rpc('cancel_tournament', { p_id: t.id, p_reason: null }), 'Tournament cancelled.'))}>
            <Text style={[s.link, { color: colors.danger }]}>Cancel tournament</Text>
          </Pressable>
          {t.status === 'approved' && <Text style={{ color: colors.muted, fontSize: 12 }}>Registration also closes by itself at the closing time. Teams that haven't paid by then are removed.</Text>}
        </View>
      )}

      <Text style={s.h2}>Teams ({t.confirmed}/{t.max_teams}){t.waiting > 0 ? <Text style={{ color: colors.muted, fontWeight: '400', fontSize: 13 }}> · {t.waiting} still registering</Text> : null}</Text>
      {(t.teams || []).length === 0 ? <Text style={{ color: colors.muted }}>No teams yet, be the first.</Text> : (t.teams as any[]).map((x, i) => (
        <View key={x.id} style={[s.card, { marginBottom: 6, padding: 10 }]}>
          <Text style={{ color: colors.text, fontWeight: '700' }}>{i + 1}. {x.name}{x.group ? <Text style={{ color: colors.primaryAlt }}>  Group {x.group}</Text> : null}</Text>
          <Text style={{ color: colors.muted }}>{(x.members || []).join(', ')}</Text>
        </View>
      ))}

      {(t.matches || []).length > 0 && (
        <>
          <Text style={s.h2}>Schedule & results</Text>
          {groups.map((gl) => (
            <View key={gl} style={{ marginBottom: 12 }}>
              <Text style={{ color: colors.text, fontWeight: '700', marginBottom: 6 }}>Group {gl}</Text>
              <View style={[s.card, { padding: 10, marginBottom: 8 }]}>
                <View style={s.tr}>{['#', 'Team', 'P', 'W', 'L', '+/−'].map((h, i) => <Text key={h} style={[s.td, i === 1 && { flex: 3 }, { color: colors.muted }]}>{h}</Text>)}</View>
                {(t.standings as any[]).filter((x) => x.group_label === gl).map((x) => (
                  <View key={x.team_id} style={s.tr}>
                    {[x.rank, x.team, x.played, x.won, x.lost, x.points_for - x.points_against].map((v, i) => (
                      <Text key={i} style={[s.td, i === 1 && { flex: 3 }, x.rank <= 2 && { fontWeight: '700' }]} numberOfLines={1}>{v}</Text>
                    ))}
                  </View>
                ))}
              </View>
              {groupMatches.filter((m: any) => m.group === gl).map(matchRow)}
            </View>
          ))}
          {rounds.map((r) => (
            <View key={r} style={{ marginBottom: 12 }}>
              <Text style={{ color: colors.text, fontWeight: '700', marginBottom: 6 }}>{roundName(r, t.rounds)}</Text>
              {koMatches.filter((m: any) => m.round === r).map(matchRow)}
            </View>
          ))}
          {groups.length > 0 && <Text style={{ color: colors.muted, fontSize: 12 }}>The top 2 of each group go to the knockout. Ranking: wins, then points difference, then points scored.</Text>}
        </>
      )}
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  const s = useS();
  return (
    <View style={[s.card, { width: '48%', padding: 10 }]}>
      <Text style={{ color: colors.muted, fontSize: 11 }}>{label}</Text>
      <Text style={{ color: colors.text, fontWeight: '700', marginTop: 2 }}>{value}</Text>
    </View>
  );
}

const useS = themed(() => StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: 14, borderWidth: 1, borderColor: colors.border },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, color: colors.text },
  score: { width: 40, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingVertical: 4, textAlign: 'center', color: colors.text },
  link: { color: colors.muted, textDecorationLine: 'underline' },
  h2: { color: colors.text, fontWeight: '800', fontSize: 17, marginTop: 20, marginBottom: 10 },
  tr: { flexDirection: 'row', paddingVertical: 4 },
  td: { flex: 1, color: colors.text, fontSize: 13 },
}));
