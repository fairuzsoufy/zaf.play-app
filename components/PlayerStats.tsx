import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Link, useFocusEffect } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { colors, fonts, radius, themed } from '@/lib/theme';
import { GradientText } from './ui';
import { TrustChip, type Trust } from './Friends';

type Stats = {
  games: number; hosted: number; courts: number; tournaments: number; streak: number; best_streak: number;
  favourites: { court_id: string; court: string; facility: string; games: number }[];
};

type Badge = { key: string; emoji: string; title: string; hint: string; earned: (s: Stats) => boolean };

// Small badges worked out from the numbers, the same list as the website's PlayerStats.
const BADGES: Badge[] = [
  { key: 'first', emoji: '🎾', title: 'First game', hint: 'Play your first game', earned: (s) => s.games >= 1 },
  { key: 'g5', emoji: '⭐', title: '5 games', hint: 'Play 5 games', earned: (s) => s.games >= 5 },
  { key: 'g10', emoji: '🏅', title: '10 games', hint: 'Play 10 games', earned: (s) => s.games >= 10 },
  { key: 'g25', emoji: '🥈', title: '25 games', hint: 'Play 25 games', earned: (s) => s.games >= 25 },
  { key: 'g50', emoji: '🥇', title: '50 games', hint: 'Play 50 games', earned: (s) => s.games >= 50 },
  { key: 'tour', emoji: '🏆', title: 'First tournament', hint: 'Play in a tournament', earned: (s) => s.tournaments >= 1 },
  { key: 'host', emoji: '📣', title: 'Game host', hint: 'Host an open game that gets played', earned: (s) => s.hosted >= 1 },
  { key: 'streak', emoji: '🔥', title: '3-week streak', hint: 'Play 3 weeks in a row', earned: (s) => s.best_streak >= 3 },
  { key: 'explorer', emoji: '🧭', title: 'Explorer', hint: 'Play at 3 different courts', earned: (s) => s.courts >= 3 },
];
const NEXT_GAME_BADGE = [5, 10, 25, 50];

// Profile: games played, weekly streak, courts, level and badges (like the website).
export function PlayerStats() {
  const s = useS();
  const [stats, setStats] = useState<Stats | null>(null);
  const [trust, setTrust] = useState<Trust | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('my_player_stats');
    if (!error && data) setStats(data as Stats);
    const { data: t } = await supabase.rpc('my_trust');
    if (t) setTrust(t as Trust);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!stats) return null;

  const earned = BADGES.filter((b) => b.earned(stats));
  const nextTarget = NEXT_GAME_BADGE.find((n) => stats.games < n);
  const streakText = stats.streak > 0
    ? `${stats.streak}-week streak`
    : stats.best_streak > 0 ? 'Play this week to start a new streak' : 'Play two weeks in a row to start a streak';
  const ordered = [...earned, ...BADGES.filter((b) => !b.earned(stats))]; // earned first

  return (
    <View style={s.card}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {([
          [String(stats.games), stats.games === 1 ? 'Game played' : 'Games played'],
          [stats.streak > 0 ? `🔥 ${stats.streak}` : String(stats.streak), stats.streak === 1 ? 'Week in a row' : 'Weeks in a row'],
          [String(stats.courts), stats.courts === 1 ? 'Court' : 'Courts'],
        ] as const).map(([value, label]) => (
          <View key={label} style={s.tile}>
            <GradientText style={s.num}>{value}</GradientText>
            <Text style={s.small}>{label}</Text>
          </View>
        ))}
      </View>

      <View style={{ alignItems: 'center', marginTop: 10 }}>
        {trust && <TrustChip trust={trust} />}
        <Text style={[s.small, { textAlign: 'center', marginTop: 2 }]}>
          {streakText}
          {stats.best_streak > stats.streak ? ` · best ${stats.best_streak}` : ''}
          {nextTarget ? ` · ${nextTarget - stats.games} more for the ${nextTarget} games badge` : ''}
        </Text>
      </View>

      {stats.games === 0 && (
        <Text style={{ color: colors.text, textAlign: 'center', marginTop: 10 }}>
          Your first game unlocks your first badge. <Link href="/" style={{ color: colors.primaryAlt, textDecorationLine: 'underline' }}>Find a court</Link>
        </Text>
      )}

      <Text style={{ color: colors.text, fontWeight: '700', marginTop: 14, marginBottom: 8 }}>
        Badges <Text style={{ color: colors.muted, fontWeight: '400' }}>· {earned.length} of {BADGES.length}</Text>
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {ordered.map((b) => {
          const got = b.earned(stats);
          return (
            <View key={b.key} style={[s.badge, !got && { opacity: 0.4 }]} accessibilityLabel={got ? b.title : `${b.title}: ${b.hint}`}>
              <Text style={{ fontSize: 22 }}>{b.emoji}</Text>
              <Text style={s.badgeTitle} numberOfLines={2}>{b.title}</Text>
              {!got && <Text style={[s.small, { fontSize: 10, textAlign: 'center' }]} numberOfLines={2}>{b.hint}</Text>}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const useS = themed(() => StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radius.xl, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: colors.border },
  tile: { flex: 1, alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: 10 },
  num: { fontFamily: fonts.display, fontSize: 26, fontVariant: ['tabular-nums'] },
  small: { color: colors.muted, fontSize: 12 },
  badge: { width: 84, alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 8 },
  badgeTitle: { color: colors.text, fontSize: 11, fontWeight: '700', textAlign: 'center', marginTop: 2 },
}));
