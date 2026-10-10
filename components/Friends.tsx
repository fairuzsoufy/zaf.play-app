import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { colors, fonts, radius, themed, useTheme } from '@/lib/theme';
import { Button } from './ui';

// same as the website's lib/trust.ts (worked out by the database: private.player_trust)
export type Trust = { games: number; no_shows: number; level: 'new' | 'regular' | 'experienced' | 'veteran' };
const LEVEL_INFO: Record<Trust['level'], { emoji: string; label: string }> = {
  new: { emoji: '🌱', label: 'New player' },
  regular: { emoji: '🎾', label: 'Regular' },
  experienced: { emoji: '⚡', label: 'Experienced' },
  veteran: { emoji: '🏆', label: 'Veteran' },
};

type Friend = { id: string; name: string; username: string; trust?: Trust | null };
type Found = { id: string; full_name: string; username: string | null };
const PER_PAGE = 5;

// "🎾 Regular · 12 games", and the no-shows if the court marked any (like the website's TrustChip)
export function TrustChip({ trust }: { trust?: Trust | null }) {
  useTheme();
  if (!trust) return null;
  const info = LEVEL_INFO[trust.level] || LEVEL_INFO.new;
  return (
    <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
      {info.emoji} {info.label} · {trust.games} {trust.games === 1 ? 'game' : 'games'}
      {trust.no_shows > 0
        ? <Text style={{ color: trust.no_shows >= 2 ? colors.danger : colors.muted }}> · {trust.no_shows} no-show{trust.no_shows === 1 ? '' : 's'}</Text>
        : trust.games >= 3 ? <Text style={{ color: colors.success }}> · never missed a game</Text> : null}
    </Text>
  );
}

// Profile: my friends, 5 per page. Find a player by @username, email or phone and add them; remove with one tap.
export function FriendsCard() {
  const s = useS();
  const { scheme } = useTheme();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<{ term: string; list: Found[] } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('my_friends');
    setFriends((data as Friend[]) || []);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // live search, like the website's PlayerSearch (exact email / phone, username can be the start)
  const term = q.trim().replace(/^@/, '');
  useEffect(() => {
    if (term.length < 3) return;
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc('find_players', { p_query: term });
      setFound({ term, list: (data as Found[]) || [] });
    }, 300);
    return () => clearTimeout(t);
  }, [term]);
  const mine = new Set(friends.map((f) => f.id));
  const results = found && found.term === term ? found.list.filter((p) => !mine.has(p.id)) : [];
  const searching = term.length >= 3 && !(found && found.term === term);

  async function add(username: string) {
    if (!username.trim()) return;
    setBusy(true);
    setMsg(null);
    const { data, error } = await supabase.rpc('add_friend', { p_username: username.trim() });
    setBusy(false);
    if (error) return setMsg({ ok: false, text: error.message });
    setMsg({ ok: true, text: `${(data as any)?.name ?? 'Your friend'} added to your friends.` });
    setQ('');
    load();
  }

  async function remove(id: string) {
    await supabase.rpc('remove_friend', { p_friend_id: id });
    load();
  }

  const pages = Math.max(1, Math.ceil(friends.length / PER_PAGE));
  const current = Math.min(page, pages - 1); // stays valid after removing the last friend on a page
  const shown = friends.slice(current * PER_PAGE, (current + 1) * PER_PAGE);

  return (
    <View style={s.card}>
      <Text style={s.title}>My friends</Text>
      <Text style={s.muted}>Find players by @username, email or phone, then invite them to your games in one tap.</Text>

      <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
        <TextInput
          value={q} onChangeText={setQ} placeholder="@username, email or phone" placeholderTextColor={colors.muted}
          autoCapitalize="none" autoCorrect={false} keyboardAppearance={scheme} returnKeyType="done"
          onSubmitEditing={() => add(term)} aria-label="Find a player" style={s.input}
        />
        <Button small title="Add" onPress={() => add(term)} loading={busy} disabled={!term} />
      </View>

      {term.length >= 3 && (
        <View style={s.results}>
          {searching && <Text style={s.resultText}>Searching...</Text>}
          {!searching && results.length === 0 && <Text style={s.resultText}>No player found. Emails and phone numbers must match exactly.</Text>}
          {results.map((p, i) => (
            <Pressable key={p.id} disabled={!p.username || busy} onPress={() => p.username && add(p.username)}
              style={({ pressed }) => [s.result, i > 0 && s.divider, pressed && { backgroundColor: colors.soft }]}>
              <Text style={{ color: colors.text, flex: 1 }}>
                {p.full_name} {p.username ? <Text style={{ color: colors.muted }}>@{p.username}</Text> : null}
              </Text>
              <Text style={{ color: p.username ? colors.primaryAlt : colors.muted, fontWeight: '700' }}>{p.username ? '+ Add' : 'No username'}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {msg && <Text style={{ color: msg.ok ? colors.success : colors.danger, marginTop: 8 }}>{msg.ok ? '✅ ' : '❌ '}{msg.text}</Text>}

      {friends.length === 0 ? (
        <Text style={[s.muted, { marginTop: 12 }]}>No friends yet.</Text>
      ) : (
        <>
          <View style={{ marginTop: 10 }}>
            {shown.map((f, i) => (
              <View key={f.id} style={[s.row, i > 0 && s.divider]}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontWeight: '600' }}>{f.name} <Text style={{ color: colors.muted, fontWeight: '400' }}>@{f.username}</Text></Text>
                  <TrustChip trust={f.trust} />
                </View>
                <Pressable hitSlop={10} onPress={() => remove(f.id)}>
                  <Text style={{ color: colors.muted, fontSize: 12, textDecorationLine: 'underline' }}>Remove</Text>
                </Pressable>
              </View>
            ))}
          </View>
          {pages > 1 && (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 8 }}>
              <Pressable onPress={() => setPage(current - 1)} disabled={current === 0} style={[s.pager, current === 0 && { opacity: 0.3 }]} accessibilityLabel="Previous friends">
                <Text style={{ color: colors.text, fontSize: 18 }}>‹</Text>
              </Pressable>
              <Text style={[s.muted, { fontVariant: ['tabular-nums'] }]}>
                {current * PER_PAGE + 1}–{Math.min((current + 1) * PER_PAGE, friends.length)} of {friends.length}
              </Text>
              <Pressable onPress={() => setPage(current + 1)} disabled={current >= pages - 1} style={[s.pager, current >= pages - 1 && { opacity: 0.3 }]} accessibilityLabel="Next friends">
                <Text style={{ color: colors.text, fontSize: 18 }}>›</Text>
              </Pressable>
            </View>
          )}
        </>
      )}
    </View>
  );
}

const useS = themed(() => StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radius.xl, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: colors.border },
  title: { color: colors.text, fontFamily: fonts.displayBold, fontSize: 20 },
  muted: { color: colors.muted, fontSize: 13, marginTop: 2 },
  input: {
    flex: 1, backgroundColor: colors.bg, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md,
    color: colors.text, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15,
  },
  results: { marginTop: 6, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: 'hidden' },
  result: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12 },
  resultText: { color: colors.muted, padding: 12, fontSize: 13 },
  divider: { borderTopWidth: 1, borderTopColor: colors.border },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10 },
  pager: { width: 34, height: 34, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
}));
