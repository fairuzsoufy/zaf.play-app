import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/components/AppText';
import { useFocusEffect, useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { colors, radius, themed } from '@/lib/theme';
import { dateTimeText, egp, levelText, teamSizeText, untilText, whenText } from '@/lib/format';
import { HOLD_MINUTES } from '@/lib/payment';
import { Button, GradientFill } from '@/components/ui';
import { TrustChip } from '@/components/Friends';

type Tab = 'open' | 'tournaments' | 'mine';

const TEAM_STATUS: Record<string, string> = {
  forming: 'Waiting for teammates',
  ready: 'Ready, captain pays',
  review: 'Payment being checked',
  confirmed: 'In ✓',
  withdrawn: 'Withdrawn',
  rejected: 'Not accepted',
  expired: 'Not completed in time',
};
const SPOT_STATUS: Record<string, string> = {
  holding: `Pay within ${HOLD_MINUTES} min`,
  review: 'Payment being checked',
  paid: 'Paid ✓',
  left: 'You left',
  rejected: 'Payment not accepted',
};

// Games: open games anyone can join, tournaments, and my own games, teams and invitations (the website's /games).
export default function Games() {
  const s = useS();
  const router = useRouter();
  const { session } = useAuth();
  const [tab, setTab] = useState<Tab>('open');
  const [sports, setSports] = useState<{ slug: string; name: string }[]>([]);
  const [cities, setCities] = useState<string[]>([]);
  const [sport, setSport] = useState('');
  const [city, setCity] = useState('');
  const [games, setGames] = useState<any[]>([]);
  const [tournaments, setTournaments] = useState<any[]>([]);
  const [mine, setMine] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    const args = { p_sport: sport || null, p_city: city || null };
    const [g, t] = await Promise.all([supabase.rpc('list_open_games', args), supabase.rpc('list_tournaments', args)]);
    // a failed load keeps what is on screen and says so, instead of showing "No open games"
    setLoadFailed(!!(g.error || t.error));
    if (!g.error) setGames((g.data as any[]) || []);
    if (!t.error) setTournaments((t.data as any[]) || []);
    if (session) {
      const { data } = await supabase.rpc('my_games');
      setMine(data);
    } else setMine(null);
    setLoading(false);
    setRefreshing(false);
  }, [sport, city, session]);

  useEffect(() => {
    (async () => {
      const [{ data: sp }, { data: ci }] = await Promise.all([
        supabase.from('sports').select('slug, name').eq('is_active', true).order('name'),
        supabase.from('areas').select('name').eq('is_active', true).order('name'),
      ]);
      setSports((sp as any[]) || []);
      setCities(((ci as any[]) || []).map((c) => c.name));
    })();
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  // spots fill and empty while the list is open
  useEffect(() => {
    const ch = supabase.channel(`games-${Date.now()}`)
      .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'open_games' }, () => load())
      .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'open_game_players' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  async function answer(teamId: string, accept: boolean) {
    setBusy(teamId);
    const { error } = await supabase.rpc('respond_team_invite', { p_team_id: teamId, p_accept: accept });
    setBusy('');
    if (error) Alert.alert('Could not answer', error.message);
    load();
  }

  async function declineGame(gameId: string) {
    setBusy(gameId);
    await supabase.rpc('decline_game_invite', { p_game_id: gameId });
    setBusy('');
    load();
  }

  const open = (id: string) => router.push({ pathname: '/game/[id]', params: { id } });
  const gameInvites = (mine?.game_invites as any[]) || [];
  const invites = (mine?.invites as any[]) || [];
  const openT = (code: string) => router.push({ pathname: '/tournament/[code]', params: { code } });
  // one card per game: my live spot first
  const myGames = (() => {
    const by = new Map<string, any[]>();
    ((mine?.games as any[]) || []).forEach((r) => by.set(r.game_id, [...(by.get(r.game_id) || []), r]));
    const live = (r: any) => ['holding', 'review', 'paid'].includes(r.my_status);
    return Array.from(by.values()).map((rows) => [...rows].sort((x, y) => Number(live(y)) - Number(live(x)))[0]);
  })();

  const tabs: { key: Tab; label: string; n?: number }[] = [
    { key: 'open', label: 'Open games', n: games.length },
    { key: 'tournaments', label: 'Tournaments', n: tournaments.length },
    ...(session ? [{ key: 'mine' as Tab, label: 'My games', n: invites.length + gameInvites.length || undefined }] : []),
  ];

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}>
      <Text style={{ color: colors.muted, marginBottom: 12 }}>Join a game with other players, or host your own and share the cost.</Text>
      <Button title="+ Host a game" onPress={() => router.push('/')} />
      <Text style={{ color: colors.muted, fontSize: 12, marginTop: 6, marginBottom: 14 }}>Pick a court, then turn on “Invite players to share the cost”.</Text>

      {gameInvites.length > 0 && tab !== 'mine' && (
        <Pressable accessibilityRole="button" onPress={() => setTab('mine')} style={[s.card, { borderColor: colors.brandPink }]}>
          <Text style={{ color: colors.text, fontWeight: '700' }}>🎾 You have {gameInvites.length} game invitation{gameInvites.length > 1 ? 's' : ''}</Text>
          <Text style={{ color: colors.muted, marginTop: 2 }}>A friend invited you to play. Tap to see.</Text>
        </Pressable>
      )}

      {invites.length > 0 && tab !== 'mine' && (
        <Pressable accessibilityRole="button" onPress={() => setTab('mine')} style={[s.card, { borderColor: colors.brandPink }]}>
          <Text style={{ color: colors.text, fontWeight: '700' }}>You have {invites.length} team invitation{invites.length > 1 ? 's' : ''}</Text>
          <Text style={{ color: colors.muted, marginTop: 2 }}>Tap to answer.</Text>
        </Pressable>
      )}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12, flexGrow: 0 }}>
        {tabs.map((t) => (
          <Pressable accessibilityRole="button" key={t.key} onPress={() => setTab(t.key)} style={[s.tab, tab === t.key && s.tabOn]}>
            {tab === t.key && <GradientFill />}
            <Text style={{ color: tab === t.key ? '#fff' : colors.muted, fontWeight: '600' }}>{t.label}{t.n ? ` (${t.n})` : ''}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {tab !== 'mine' && (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
            <Chip on={!sport} label="All sports" onPress={() => setSport('')} />
            {sports.map((x) => <Chip key={x.slug} on={sport === x.slug} label={x.name} onPress={() => setSport(x.slug)} />)}
          </ScrollView>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
            <Chip on={!city} label="All areas" onPress={() => setCity('')} />
            {cities.map((c) => <Chip key={c} on={city === c} label={c} onPress={() => setCity(c)} />)}
          </ScrollView>
          {loadFailed && <Text style={{ color: colors.warning, marginBottom: 10 }}>We couldn't load the latest games. Pull down to try again.</Text>}
        </>
      )}

      {tab === 'open' && (
        <>

          {!loading && games.length === 0 && !loadFailed && (
            <View style={[s.card, { alignItems: 'center' }]}>
              <Text style={{ fontSize: 28 }}>🙌</Text>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 17, marginTop: 4 }}>No open games right now</Text>
              <Text style={{ color: colors.muted, marginTop: 4 }}>Start one and let others join you.</Text>
            </View>
          )}
          {games.map((g) => {
            const left = g.spots - g.taken;
            return (
              <Pressable accessibilityRole="button" key={g.id} onPress={() => open(g.id)} style={s.card}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontWeight: '700' }}>{g.sport} · {g.court}</Text>
                    <Text style={{ color: colors.muted }}>{g.branch}, {g.city}</Text>
                  </View>
                  <Text style={[s.pill, { color: g.status === 'full' ? colors.muted : left <= 1 ? colors.brandPink : colors.primaryAlt }]}>
                    {g.status === 'full' ? 'Full' : `${left} spot${left === 1 ? '' : 's'} left`}
                  </Text>
                </View>
                <Text style={{ color: colors.text, marginTop: 8 }}>📅 {whenText(g.start_time, g.end_time)}</Text>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                  <Text style={{ color: colors.muted, flex: 1 }}>
                    {levelText(g.level)}{g.gender_rule === 'men' ? ' · Men only' : g.gender_rule === 'women' ? ' · Women only' : ''} · host {g.host}
                  </Text>
                  <Text style={{ color: colors.text, fontWeight: '700' }}>{egp(g.price_per_spot)} / player</Text>
                </View>
                {g.host_trust && <TrustChip trust={g.host_trust} />}
                <View style={s.bar}><View style={{ width: `${(g.taken / g.spots) * 100}%`, height: '100%', overflow: 'hidden' }}><GradientFill /></View></View>
                {g.mine && <Text style={{ color: colors.brandPink, fontWeight: '700', marginTop: 6, fontSize: 12 }}>You're in this game</Text>}
              </Pressable>
            );
          })}

          <View style={s.card}>
            <Text style={{ color: colors.text, fontWeight: '700', marginBottom: 6 }}>How open games work</Text>
            {[
              ['Host', 'Pick a court, time and number of players. Pay only your spot.'],
              ['Share', 'Send the game link on WhatsApp or anywhere. Everyone can also find it here.'],
              ['Join & pay', 'Each player taps Join and pays their own share by InstaPay.'],
              ['Play', 'When every spot is paid, the court is booked. Not full in time? Everyone gets 100% back.'],
            ].map(([t, d], i) => (
              <Text key={t} style={{ color: colors.muted, marginTop: 4 }}><Text style={{ color: colors.text, fontWeight: '700' }}>{i + 1}. {t}: </Text>{d}</Text>
            ))}
          </View>
        </>
      )}

      {tab === 'tournaments' && (
        <>
          {!loading && tournaments.length === 0 && (
            <View style={[s.card, { alignItems: 'center' }]}>
              <Text style={{ color: colors.text, fontWeight: '800' }}>No tournaments yet</Text>
              <Text style={{ color: colors.muted, marginTop: 4, textAlign: 'center' }}>Follow us on Instagram to hear first when the next one opens.</Text>
            </View>
          )}
          {tournaments.map((t) => {
            const now = Date.now();
            const opens = new Date(t.reg_opens_at).getTime();
            const closes = new Date(t.reg_closes_at).getTime();
            const isOpen = t.status === 'approved' && now >= opens && now < closes;
            const state = t.status !== 'approved' ? 'Registration closed' : now < opens ? `Opens ${untilText(t.reg_opens_at)}` : now < closes ? `Closes ${untilText(t.reg_closes_at)}` : 'Registration closed';
            return (
              <Pressable accessibilityRole="button" key={t.id} onPress={() => openT(t.code)} style={s.card}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                  <Text style={{ color: colors.text, fontWeight: '700', flex: 1 }}>🏆 {t.title}</Text>
                  <Text style={[s.pill, { color: isOpen ? colors.success : colors.muted }]}>{state}</Text>
                </View>
                <Text style={{ color: colors.muted, marginTop: 2 }}>{t.sport} · {teamSizeText(t.team_size)}</Text>
                <Text style={{ color: colors.text, marginTop: 6 }}>{dateTimeText(t.starts_at)} · {t.court}, {t.branch}</Text>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                  <Text style={{ color: colors.muted }}>{t.confirmed}/{t.max_teams} teams</Text>
                  <Text style={{ color: colors.text, fontWeight: '700' }}>{Number(t.entry_fee) > 0 ? `${egp(t.entry_fee)} / team` : 'Free'}</Text>
                </View>
              </Pressable>
            );
          })}
        </>
      )}

      {tab === 'mine' && mine && (
        <>
          {invites.length > 0 && (
            <>
              <Text style={s.h2}>Team invitations</Text>
              {invites.map((i: any) => (
                <View key={i.team_id} style={s.card}>
                  <Text style={{ color: colors.text }}><Text style={{ fontWeight: '700' }}>{i.captain}</Text> invited you to team <Text style={{ fontWeight: '700' }}>{i.team}</Text></Text>
                  <Pressable accessibilityRole="button" onPress={() => openT(i.code)}><Text style={{ color: colors.muted, marginTop: 2, textDecorationLine: 'underline' }}>{i.tournament} · {dateTimeText(i.starts_at)}</Text></Pressable>
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                    <View style={{ flex: 1 }}><Button small title="Accept" loading={busy === i.team_id} onPress={() => answer(i.team_id, true)} /></View>
                    <View style={{ flex: 1 }}><Button small variant="ghost" title="Decline" disabled={busy === i.team_id} onPress={() => answer(i.team_id, false)} /></View>
                  </View>
                </View>
              ))}
            </>
          )}
          {gameInvites.length > 0 && (
            <>
              <Text style={s.h2}>Game invitations</Text>
              {gameInvites.map((i: any) => (
                <View key={i.game_id} style={s.card}>
                  <Text style={{ color: colors.text }}><Text style={{ fontWeight: '700' }}>{i.host}</Text> invited you to play <Text style={{ fontWeight: '700' }}>{i.sport}</Text>{i.visibility === 'private' ? ' 🔒' : ''}</Text>
                  <Text style={{ color: colors.muted, marginTop: 2 }}>{i.court} · {whenText(i.start_time, i.end_time)} · {egp(i.price_per_spot)} / player · {i.taken}/{i.spots} in</Text>
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                    <View style={{ flex: 1 }}><Button small title="See game & join" onPress={() => open(i.game_id)} /></View>
                    <View style={{ flex: 1 }}><Button small variant="ghost" title="Decline" loading={busy === i.game_id} onPress={() => declineGame(i.game_id)} /></View>
                  </View>
                </View>
              ))}
            </>
          )}
          <Text style={s.h2}>My open games</Text>
          {myGames.length === 0 && <Text style={{ color: colors.muted }}>None yet.</Text>}
          {myGames.map((g) => (
            <Pressable accessibilityRole="button" key={g.game_id} onPress={() => open(g.game_id)} style={s.card}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontWeight: '700' }}>{g.sport} · {g.court}</Text>
                  <Text style={{ color: colors.muted }}>{whenText(g.start_time, g.end_time)} · {g.taken}/{g.spots} players{g.visibility === 'private' ? ' · 🔒 private' : ''}{g.is_host ? ' · you host' : ''}</Text>
                </View>
                <Text style={[s.pill, { color: g.status === 'cancelled' ? colors.muted : g.my_status === 'paid' ? colors.success : colors.primary }]}>
                  {g.status === 'cancelled' ? 'Cancelled' : g.status === 'full' && g.my_status === 'paid' ? 'Game on ✓' : SPOT_STATUS[g.my_status] || g.my_status}
                </Text>
              </View>
              {g.refund_status && g.refund_status !== 'none' && (
                <Text style={{ color: colors.muted, marginTop: 6, fontSize: 12 }}>
                  💸 Refund {egp(g.refund_amount)} {g.refund_status === 'refunded' ? `sent ✓${g.refunded_at ? ` · ${dateTimeText(g.refunded_at)}` : ''}` : 'on its way'}
                </Text>
              )}
            </Pressable>
          ))}
          <Text style={s.h2}>My tournament teams</Text>
          {((mine.teams as any[]) || []).length === 0 && <Text style={{ color: colors.muted }}>None yet.</Text>}
          {((mine.teams as any[]) || []).map((t) => (
            <Pressable accessibilityRole="button" key={t.team_id} onPress={() => openT(t.code)} style={s.card}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontWeight: '700' }}>{t.team}{t.is_captain ? ' (captain)' : ''}</Text>
                  <Text style={{ color: colors.muted }}>{t.tournament} · {dateTimeText(t.starts_at)}</Text>
                </View>
                <Text style={[s.pill, { color: t.status === 'confirmed' ? colors.success : colors.primary }]}>{TEAM_STATUS[t.status] || t.status}</Text>
              </View>
              {t.refund_status && t.refund_status !== 'none' && (
                <Text style={{ color: colors.muted, marginTop: 6, fontSize: 12 }}>Refund {egp(t.refund_amount)} {t.refund_status === 'refunded' ? 'sent ✓' : 'on its way'}</Text>
              )}
            </Pressable>
          ))}
        </>
      )}
    </ScrollView>
  );
}

function Chip({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) {
  const s = useS();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={[s.tab, on && s.tabOn]}>
      {on && <GradientFill />}
      <Text style={{ color: on ? '#fff' : colors.muted, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

const useS = themed(() => StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: 14, borderWidth: 1, borderColor: colors.border, marginBottom: 12 },
  tab: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.lg, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, marginRight: 8, overflow: 'hidden' },
  tabOn: { borderColor: 'transparent' },
  pill: { fontWeight: '700', fontSize: 12 },
  bar: { height: 6, borderRadius: 3, backgroundColor: colors.cardAlt, overflow: 'hidden', marginTop: 10 },
  h2: { color: colors.text, fontWeight: '800', fontSize: 17, marginTop: 8, marginBottom: 10 },
}));
