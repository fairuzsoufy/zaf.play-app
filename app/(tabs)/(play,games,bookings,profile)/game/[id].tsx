import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, Share, StyleSheet, View, RefreshControl } from 'react-native';
import { Text, TextInput } from '@/components/AppText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { colors, radius, themed } from '@/lib/theme';
import { countdown, dateTimeText, egp, levelText, whenText } from '@/lib/format';
import { instapayFee, REVIEW_MINUTES } from '@/lib/payment';
import { useRequestId } from '@/lib/requestId';
import { gameShortUrl } from '@/lib/shortId';
import { Button, GradientFill, Note, Skeleton } from '@/components/ui';
import { TrustChip } from '@/components/Friends';
import { ProofForm } from '@/components/ProofForm';
import { askToNotify } from '@/components/BookingAlerts';
import { toast } from '@/components/Toast';
import { GameHistory } from '@/components/GameHistory';

// One open game: who's in, spots left, join / pay / leave, and the host's invite and cancel tools (the website's /games/[id]).
const INVITE_STATE: Record<string, string> = {
  invited: '⏳ Invited, waiting for reply',
  paying: '💳 Accepted, paying now',
  review: '🔎 Paid, being checked',
  paid: '✅ Paid, in the game',
  declined: '❌ Declined',
};
const RULE_TEXT: Record<string, string> = { mixed: 'Mixed', men: 'Men only', women: 'Women only' };

export default function OpenGame() {
  const s = useS();
  const insets = useSafeAreaInsets();
  const { id, new: isNew } = useLocalSearchParams<{ id: string; new?: string }>();
  const router = useRouter();
  const { session } = useAuth();
  const req = useRequestId();
  const [g, setG] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [rule, setRule] = useState<'mixed' | 'men' | 'women'>('mixed');
  const [myGender, setMyGender] = useState<string | null>(null);
  const [friends, setFriends] = useState<{ id: string; name: string; username: string }[]>([]);
  const [friendQ, setFriendQ] = useState('');
  const [proofUrl, setProofUrl] = useState('');
  const [approvedNote, setApprovedNote] = useState(false);
  const prevStatus = useRef<string | null>(null);
  const scroll = useRef<ScrollView>(null);

  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('open_game_detail', { p_game_id: id });
    setLoadFailed(!!error);
    if (!error) setG(data); // a failed refresh keeps the game on screen
    setLoading(false);
    const { data: r, error: rErr } = await supabase.rpc('open_game_gender_rule', { p_game_id: id });
    if (!rErr && (r === 'men' || r === 'women')) setRule(r);
    if (session) {
      const { data: u } = await supabase.from('users').select('gender').eq('id', session.user.id).single();
      setMyGender((u as any)?.gender || null);
    }
  }, [id, session]);

  const loadFriends = useCallback(async () => {
    if (!session) return;
    const { data } = await supabase.rpc('my_friends');
    setFriends(((data as any[]) || []).filter((f) => f.username));
  }, [session]);

  useEffect(() => { load(); loadFriends(); }, [load, loadFriends]);
  useEffect(() => { const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => {
    const ch = supabase.channel(`game-${id}-${Date.now()}`)
      .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'open_games', filter: `id=eq.${id}` }, () => load())
      .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'open_game_players', filter: `game_id=eq.${id}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [id, load]);

  // when my own timer has just run out, look again a moment later so the screen shows what the database decided
  const myHoldOver = g?.me?.status === 'holding' && new Date(g.me.hold_expires_at).getTime() <= now;
  useEffect(() => {
    if (!myHoldOver) return;
    const t = setTimeout(load, 3000);
    return () => clearTimeout(t);
  }, [myHoldOver, load]);

  // say clearly when Zaf Play approves the payment
  const myStatus = g?.me?.status as string | undefined;
  useEffect(() => {
    if (prevStatus.current === 'review' && myStatus === 'paid') setApprovedNote(true);
    prevStatus.current = myStatus ?? null;
  }, [myStatus]);

  const proofPath = g?.me?.refund_proof_path as string | undefined;
  useEffect(() => {
    if (!proofPath) return;
    supabase.storage.from('refund-proofs').createSignedUrl(proofPath, 3600).then(({ data }) => setProofUrl(data?.signedUrl || ''));
  }, [proofPath]);

  async function join() {
    if (busy) return;
    setMsg('');
    if (!session) return router.push('/login');
    setBusy(true);
    const { error } = await supabase.rpc('join_open_game', { p_request_id: req.get(), p_game_id: id });
    setBusy(false);
    if (error) setMsg(`❌ ${error.message}`);
    else req.done();
    load();
  }

  async function invite(username: string) {
    if (!username.trim()) return;
    setMsg('');
    setBusy(true);
    const { data, error } = await supabase.rpc('invite_to_game_and_befriend', { p_game_id: id, p_username: username });
    setBusy(false);
    if (error) setMsg(`❌ ${error.message}`);
    else {
      setMsg(`✅ Invitation sent to ${(data as any)?.name || username}. It shows in the player list below.`);
      setFriendQ('');
      loadFriends();
    }
    load();
  }

  async function uninvite(username: string) {
    await supabase.rpc('remove_game_invite', { p_game_id: id, p_username: username });
    load();
  }

  async function setVisibility(v: 'public' | 'private') {
    setMsg('');
    const { error } = await supabase.rpc('set_open_game_visibility', { p_game_id: id, p_visibility: v });
    if (error) setMsg(`❌ ${error.message}`);
    load();
  }

  function confirm(title: string, message: string, yes: string, run: () => void) {
    Alert.alert(title, message, [{ text: 'Keep it', style: 'cancel' }, { text: yes, style: 'destructive', onPress: run }]);
  }

  async function leave() {
    setBusy(true);
    const { data, error } = await supabase.rpc('leave_open_game', { p_game_id: id });
    setBusy(false);
    const refund = Number((data as any)?.refund || 0);
    setMsg(error ? `❌ ${error.message}` : refund > 0 ? `You left the game. ${egp(refund)} is on its way to your InstaPay.` : 'You left the game.');
    load();
  }

  async function releaseSpot() {
    setBusy(true);
    const { data, error } = await supabase.rpc('release_friend_spot', { p_game_id: id });
    setBusy(false);
    const d = data as any;
    setMsg(error ? `❌ ${error.message}` : Number(d?.refund) > 0
      ? `One friend spot released. ${egp(d.refund)} is on its way to your InstaPay (the transfer fee of ${egp(d.fee)} is taken from it). Nobody else is refunded.`
      : 'One friend spot released. Nothing to refund because you had not paid yet.');
    load();
  }

  async function cancelGame() {
    setBusy(true);
    const { error } = await supabase.rpc('host_cancel_open_game', { p_game_id: id });
    setBusy(false);
    setMsg(error ? `❌ ${error.message}` : 'Game cancelled. Everyone else who paid gets their money back in full; the InstaPay fees of all the refunds are taken from your own refund.');
    load();
  }

  function shareText() {
    const spotsLeft = g.spots - g.taken;
    return `Join my ${g.sport} game on Zaf Play 🏅\n\nPlace: ${g.court} · ${g.branch}, ${g.city}\nTime: ${whenText(g.start_time, g.end_time)}\nPrice: ${egp(g.price_per_spot)} per player (${spotsLeft} spot${spotsLeft === 1 ? '' : 's'} left)\n\nTap the link to pay and join: ${gameShortUrl(id)}`;
  }

  if (loading) return <Skeleton />;
  if (!g && loadFailed) {
    return (
      <View style={{ padding: 40, alignItems: 'center' }}>
        <Text style={{ color: colors.muted, marginBottom: 12 }}>This game didn't load. Check your connection.</Text>
        <Button title="Try again" variant="ghost" onPress={load} />
      </View>
    );
  }
  if (!g) return <Text style={{ color: colors.muted, margin: 40, textAlign: 'center' }}>Game not found.</Text>;

  const me = g.me;
  const active = me && ['holding', 'review', 'paid'].includes(me.status) && !(me.status === 'holding' && new Date(me.hold_expires_at).getTime() <= now);
  const left = g.spots - g.taken;
  // men-only / women-only games: who may press Join (the database checks this too)
  const wrongGender = rule !== 'mixed' && !!myGender && myGender !== (rule === 'men' ? 'male' : 'female');
  const needGender = rule !== 'mixed' && !myGender && !!session;
  const holdLeft = me?.status === 'holding' ? new Date(me.hold_expires_at).getTime() - now : 0;
  const othersIn = g.taken - (me?.status === 'holding' ? Number(me.seats || 1) : 0);
  // the host never paid in time, or the game was already cancelled for that
  const hostTimeUp = !!g.is_host && g.status === 'open' && othersIn <= 0 && (me?.status === 'expired' || (me?.status === 'holding' && holdLeft <= 0));
  const timerCancelled = g.status === 'cancelled' && /timer ran out|Nobody paid/i.test(g.cancel_reason || '');
  const timerOut = hostTimeUp || timerCancelled;
  const spotTimeUp = !g.is_host && g.status === 'open' && !!me && (me.status === 'expired' || (me.status === 'holding' && holdLeft <= 0));
  const cancelledNotice = g.status === 'cancelled' && !timerCancelled;
  const invitedSlots = (g.invites || []).filter((i: any) => i.status !== 'declined' && !i.joined);
  const sent = new Set((g.invites || []).filter((i: any) => i.status !== 'declined' || i.joined).map((i: any) => i.username));
  const q = friendQ.trim().toLowerCase().replace(/^@/, '');
  const friendList = friends.filter((f) => !sent.has(f.username) && (f.name.toLowerCase().includes(q) || f.username.toLowerCase().includes(q))).slice(0, 5);

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior="padding" keyboardVerticalOffset={insets.top + (Platform.OS === 'ios' ? 44 : 56)}>
    <ScrollView ref={scroll} style={{ backgroundColor: colors.bg }}
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.primary} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />} contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: g.visibility === 'private' ? 'Private game 🔒' : 'Open game' }} />
      <Text style={{ color: colors.text, fontSize: 20, fontWeight: '800' }}>{g.sport} {g.visibility === 'private' ? 'private game 🔒' : 'open game'}</Text>
      <Text style={{ color: colors.muted, marginTop: 2 }}>{g.court} · {g.branch}, {g.city}</Text>

      <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
        <Fact label="When" value={whenText(g.start_time, g.end_time)} />
        <Fact label="Per player" value={egp(g.price_per_spot)} />
        <Fact label="Level · who" value={`${levelText(g.level)} · ${RULE_TEXT[rule]}`} />
      </View>

      {timerOut && (
        <View style={{ marginTop: 14 }}>
          <Note kind="error">
            ⏰ The timer ran out, this game is cancelled.{'\n'}
            {g.is_host ? 'The payment was not sent in time, so the court was released and nobody was charged.' : 'The host did not pay in time, so the court was released and this game is cancelled.'}
          </Note>
          <Button title={g.is_host ? 'Book a new slot →' : 'Find another game →'}
            onPress={() => g.is_host ? router.replace({ pathname: '/book/[courtId]', params: { courtId: g.court_id, sport: g.sport_slug, host: '1' } }) : router.replace('/(tabs)/(games)/games')} />
        </View>
      )}
      {spotTimeUp && <View style={{ marginTop: 14 }}><Note kind="error">⏰ Your time ran out and your spot was released. Nothing was charged. Press Join below to get a new spot if there is still room.</Note></View>}
      {!!g.note && <View style={[s.card, { marginTop: 12 }]}><Text style={{ color: colors.text }}>“{g.note}”</Text></View>}

      {g.status === 'open' && left > 0 && !hostTimeUp && (
        <View style={[s.card, { marginTop: 14 }, (isNew === '1' || g.is_host) && { borderColor: colors.brandPink }]}>
          <Text style={{ color: colors.text, fontWeight: '700' }}>{isNew === '1' ? '🎉 Your game is live, invite players' : g.is_host ? 'Invite players' : 'Know someone who plays?'}</Text>
          <Text style={{ color: colors.muted, marginTop: 4 }}>
            Send this link. They open it, tap Join and pay their own {egp(g.price_per_spot)}.{' '}
            {g.visibility === 'private' ? "This game is private: it isn't listed under Games, only people with the link or an invitation can join." : 'It also shows under Games for everyone looking for a game.'}
          </Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
            <View style={{ flex: 1 }}><Button small title="WhatsApp" onPress={() => Linking.openURL(`https://wa.me/?text=${encodeURIComponent(shareText())}`)} /></View>
            <View style={{ flex: 1 }}><Button small variant="ghost" title="Share…" onPress={() => Share.share({ message: shareText() })} /></View>
          </View>

          {g.is_host && (
            <View style={{ marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: colors.border }}>
              <Text style={{ color: colors.text, fontWeight: '700' }}>Invite your friends</Text>
              <Text style={{ color: colors.muted, fontSize: 12 }}>They get an email and see it under Games → My games. They accept and pay their own share.</Text>
              {(g.invites || []).map((i: any) => (
                <View key={i.username} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, gap: 8 }}>
                  <Text style={{ color: colors.text, flex: 1 }}>{i.name} <Text style={{ color: colors.muted }}>@{i.username}</Text></Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>{INVITE_STATE[i.state || (i.status === 'declined' ? 'declined' : 'invited')]}</Text>
                  {!i.joined && <Pressable accessibilityRole="button" onPress={() => uninvite(i.username)}><Text style={{ color: colors.muted, textDecorationLine: 'underline', fontSize: 12 }}>Remove</Text></Pressable>}
                </View>
              ))}
              <TextInput value={friendQ} onChangeText={setFriendQ} autoCapitalize="none" autoCorrect={false} placeholderTextColor={colors.muted}
                placeholder={friends.length ? 'Search your friends by name…' : 'Type a username, e.g. @sara'} style={s.input}
                onFocus={() => setTimeout(() => scroll.current?.scrollTo({ y: 300, animated: true }), 300)} />
              {!!q && friendList.map((f) => (
                <View key={f.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                  <Text style={{ color: colors.text, flex: 1 }}>{f.name} <Text style={{ color: colors.muted }}>@{f.username}</Text></Text>
                  <Button small title="Invite" disabled={busy} onPress={() => invite(f.username)} />
                </View>
              ))}
              {!!q && !friends.some((f) => f.username.toLowerCase() === q) && (
                <View style={{ marginTop: 8 }}><Button small variant="ghost" title={`Invite @${q} & add to my friends`} disabled={busy} onPress={() => invite(q)} /></View>
              )}
              <Pressable accessibilityRole="button" onPress={() => setVisibility(g.visibility === 'private' ? 'public' : 'private')} style={{ marginTop: 12 }}>
                <Text style={{ color: colors.muted, fontSize: 12 }}>
                  Game type: <Text style={{ fontWeight: '700' }}>{g.visibility === 'private' ? 'Private' : 'Public'}</Text> ·{' '}
                  <Text style={{ textDecorationLine: 'underline' }}>{g.visibility === 'private' ? 'Make it public (show under Games)' : 'Make it private (hide from Games)'}</Text>
                </Text>
              </Pressable>
            </View>
          )}
        </View>
      )}

      {cancelledNotice && (
        <View style={{ marginTop: 14 }}>
          <Note kind="error">This game was cancelled.{g.cancel_reason ? `\n${g.cancel_reason}` : ''}{'\n'}If you paid, Zaf Play sends your full refund to your InstaPay.</Note>
        </View>
      )}
      {g.status === 'full' && (
        <View style={{ marginTop: 14 }}>
          <Note kind="ok">The game is on! Everyone has paid and the court is booked.</Note>
          {!!g.maps_url && <Button small variant="ghost" title="Open in Google Maps" onPress={() => Linking.openURL(g.maps_url)} />}
        </View>
      )}

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 18 }}>
        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 17 }}>Players {g.taken}/{g.spots}</Text>
        {g.status === 'open' && <Text style={{ color: colors.muted, fontSize: 12 }}>Must fill by {dateTimeText(g.fill_by)}</Text>}
      </View>
      <View style={s.bar}><View style={{ width: `${(g.taken / g.spots) * 100}%`, height: '100%', overflow: 'hidden' }}><GradientFill /></View></View>
      {(g.players || []).map((p: any, i: number) => (
        <View key={`p${i}`}>
          <View style={s.player}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text }}>👤 {p.name}{p.username ? <Text style={{ color: colors.muted }}> @{p.username}</Text> : null}{p.is_host ? <Text style={{ color: colors.primary, fontWeight: '700' }}>  Host</Text> : null}</Text>
              {p.trust && <TrustChip trust={p.trust} />}
            </View>
            <Text style={{ color: p.paid ? colors.success : colors.muted, fontWeight: '700', fontSize: 12 }}>{p.paid ? 'Paid' : 'Paying'}</Text>
          </View>
          {Array.from({ length: Math.max(0, (p.seats || 1) - 1) }).map((_, k) => (
            <View key={`f${k}`} style={s.player}>
              <Text style={{ color: colors.text, flex: 1 }}>👤 {String(p.name).split(' ')[0]}'s friend</Text>
              <Text style={{ color: p.paid ? colors.success : colors.muted, fontWeight: '700', fontSize: 12 }}>{p.paid ? 'Paid' : 'Paying'}</Text>
            </View>
          ))}
        </View>
      ))}
      {invitedSlots.slice(0, Math.max(0, left)).map((i: any) => (
        <View key={`i${i.username}`} style={[s.player, s.empty]}>
          <Text style={{ color: colors.text, flex: 1 }}>👤 {i.name} <Text style={{ color: colors.muted }}>@{i.username}</Text></Text>
          <Text style={{ color: colors.muted, fontSize: 12 }}>⏳ Invited, waiting</Text>
        </View>
      ))}
      {Array.from({ length: Math.max(0, left - invitedSlots.length) }).map((_, i) => (
        <View key={`e${i}`} style={[s.player, s.empty]}><Text style={{ color: colors.muted }}>Open spot</Text></View>
      ))}

      {!!msg && !timerOut && <Text style={{ color: colors.text, marginTop: 14 }}>{msg}</Text>}

      <View style={{ marginTop: 16, gap: 12 }}>
        {!active && g.status === 'open' && (wrongGender || needGender) && (
          <View style={s.card}>
            <Text style={{ color: colors.text, textAlign: 'center' }}>
              This game is for {rule === 'men' ? 'men' : 'women'} only.{needGender ? ' Choose male or female in your Profile to join.' : ''}
            </Text>
            {needGender && <View style={{ marginTop: 8 }}><Button small variant="ghost" title="Open my profile" onPress={() => router.push({ pathname: '/(tabs)/(profile)/profile', params: { edit: '1' } })} /></View>}
          </View>
        )}
        {!active && g.status === 'open' && !hostTimeUp && !wrongGender && !needGender && (
          <Button title={left <= 0 ? 'Game is full' : session ? `Join for ${egp(g.price_per_spot)}` : 'Log in to join'} disabled={left <= 0} loading={busy} onPress={join} />
        )}

        {me?.status === 'holding' && holdLeft > 0 && (
          <>
            <View style={[s.card, { borderColor: colors.warning, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 0 }]}>
              <Text style={{ color: colors.warning, flex: 1 }}>
                {Number(me.seats) > 1 ? `Your ${me.seats} spots (you + ${me.seats - 1} friend${me.seats > 2 ? 's' : ''}) are held for` : 'Your spot is held for'}
              </Text>
              <Text style={{ color: colors.warning, fontWeight: '800', fontSize: 20 }}>{countdown(holdLeft)}</Text>
            </View>
            <ProofForm
              amount={Number(me.amount)}
              onFocusRefund={() => setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 300)}
              onSubmit={async (path, refundTo) => {
                const { error } = await supabase.rpc('submit_open_game_payment', { p_request_id: req.get(), p_player_id: me.id, p_proof_path: path, p_refund_to: refundTo });
                if (!error) { req.done(); askToNotify(); toast("Payment sent! We'll confirm it shortly."); }
                load();
                return error ? error.message : null;
              }}
            />
          </>
        )}
        {me?.status === 'review' && (
          <Note kind="ok">
            ⏳ Payment received, waiting for approval. We check it within {REVIEW_MINUTES} minutes.
            {me.sent_at ? (() => { const l = new Date(me.sent_at).getTime() + REVIEW_MINUTES * 60000 - now; return l > 0 ? ` Approval within ${countdown(l)}.` : " Taking a little longer, we're on it."; })() : ''}
          </Note>
        )}
        {(approvedNote || (me?.status === 'paid' && g.status !== 'full')) && (
          <Note kind="ok">
            ✅ Payment approved, your spot is confirmed! {Number(me?.seats) > 1 ? `Your ${me.seats} spots are` : 'Your spot is'} yours.
            {me?.approved_at ? ` Approved ${dateTimeText(me.approved_at)}.` : ''} The court is booked once every spot is paid.
          </Note>
        )}
        {me?.status === 'rejected' && (
          <Note kind="error">Your payment wasn't accepted.{me.reject_reason ? ` ${me.reject_reason}` : ''} You can join again if there's still a spot.</Note>
        )}
        {me && me.refund_status && me.refund_status !== 'none' && !(g.status === 'open' && !active && left > 0) && (
          <View style={s.card}>
            <Text style={{ color: colors.text }}>
              Refund of <Text style={{ fontWeight: '700' }}>{egp(me.refund_amount)}</Text>{' '}
              {me.refund_status === 'refunded' ? `was sent to your InstaPay ✓${me.refunded_at ? ` (${dateTimeText(me.refunded_at)})` : ''}` : 'is on its way to your InstaPay.'}
            </Text>
            {!!proofUrl && (
              <Pressable accessibilityRole="button" onPress={() => Linking.openURL(proofUrl)} style={{ marginTop: 8 }}>
                <Text style={{ color: colors.muted, fontSize: 12 }}>Proof of the transfer, tap to enlarge</Text>
                <Image source={{ uri: proofUrl }} style={{ width: 140, height: 180, borderRadius: radius.sm, marginTop: 4 }} contentFit="cover" />
              </Pressable>
            )}
          </View>
        )}

        {active && g.status === 'open' && (me.status === 'paid' || me.status === 'holding') && !g.is_host && (
          <Pressable accessibilityRole="button" disabled={busy} onPress={() => confirm('Leave this game?', 'Your spot opens for someone else and your money is sent back to your InstaPay.', 'Yes, leave', leave)}>
            <Text style={s.link}>
              {me.status === 'paid' ? `Leave this game (refund ${egp(Number(me.amount) - instapayFee(Number(me.amount)))} after InstaPay's fee)` : "Leave this game (you haven't paid, nothing to refund)"}
            </Text>
          </Pressable>
        )}
        {g.is_host && g.status === 'open' && !hostTimeUp && active && Number(me?.seats) > 1 && me?.status !== 'review' && (
          <Pressable accessibilityRole="button" disabled={busy} onPress={() => confirm('Release one friend spot?', 'One of the spots you paid for opens up for someone else. Only that one spot is refunded to your InstaPay (minus the transfer fee). Your own spot and your other friends stay.', 'Yes, release it', releaseSpot)}>
            <Text style={s.link}>
              Release one friend spot{me?.status === 'paid' ? ` (refund ${egp(Number(g.price_per_spot) - instapayFee(Number(g.price_per_spot)))} for that spot only)` : " (you haven't paid yet, nothing to refund)"}
            </Text>
          </Pressable>
        )}
        {g.is_host && g.status === 'open' && !hostTimeUp && (
          <Pressable accessibilityRole="button" disabled={busy} onPress={() => confirm('Cancel this game?', 'The court is released and everyone else who paid gets their money back in full. The InstaPay transfer fees of all those refunds are deducted from YOUR refund.', 'Yes, cancel the game', cancelGame)}>
            <Text style={[s.link, { color: colors.danger }]}>Cancel the game (everyone who paid gets 100% back)</Text>
          </Pressable>
        )}
      </View>

      <View style={[s.card, { marginTop: 20 }]}>
        <Text style={{ color: colors.text, fontWeight: '700', marginBottom: 4 }}>How open games work</Text>
        <Text style={s.small}>• Everyone pays their own spot by InstaPay. You have 5 minutes to send the screenshot after joining.</Text>
        <Text style={s.small}>• The court is booked once every spot is paid.</Text>
        <Text style={s.small}>• If the game isn't full by {dateTimeText(g.fill_by)}, it's cancelled and everyone gets their money back in full.</Text>
        <Text style={s.small}>• Before it's full you can leave and get your money back minus InstaPay's small transfer fee. Once it's full, spots can't be cancelled online.</Text>
      </View>
      {!!session && <GameHistory gameId={String(id)} />}
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  const s = useS();
  return (
    <View style={[s.card, { flex: 1, marginBottom: 0, padding: 10 }]}>
      <Text style={{ color: colors.muted, fontSize: 12 }}>{label}</Text>
      <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13, marginTop: 2 }}>{value}</Text>
    </View>
  );
}

const useS = themed(() => StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: 14, borderWidth: 1, borderColor: colors.border, marginBottom: 0 },
  bar: { height: 8, borderRadius: 4, backgroundColor: colors.cardAlt, overflow: 'hidden', marginTop: 8, marginBottom: 10 },
  player: { backgroundColor: colors.card, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: colors.border, marginBottom: 6, flexDirection: 'row', alignItems: 'center', gap: 8 },
  empty: { backgroundColor: 'transparent', borderStyle: 'dashed' },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, color: colors.text, marginTop: 12 },
  link: { color: colors.muted, textDecorationLine: 'underline', textAlign: 'center' },
  small: { color: colors.muted, fontSize: 12, marginTop: 3 },
}));
