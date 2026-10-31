import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient as SvgGradient, Stop } from 'react-native-svg';
import { Text } from '@/components/AppText';
import { Link, useFocusEffect } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { supabase } from '@/lib/supabase';
import { colors, fonts, radius, themed, useTheme } from '@/lib/theme';
import { tap } from '@/lib/haptics';
import { GRADIENT } from './ui';
import { Icon, type IconName } from './Icon';
import { TrustChip, type Trust } from './Friends';
import { toast } from './Toast';

export type Stats = {
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
const GAME_BADGES = [1, 5, 10, 25, 50];
const BADGE_EMOJI: Record<number, string> = { 1: '🎾', 5: '⭐', 10: '🏅', 25: '🥈', 50: '🥇' };

// How far the ring is filled: from the last game badge to the next one (full once every game badge is earned).
function ringProgress(games: number) {
  const next = GAME_BADGES.find((n) => games < n);
  if (!next) return { p: 1, next: null as number | null };
  const prev = [...GAME_BADGES].reverse().find((n) => games >= n) ?? 0;
  return { p: (games - prev) / (next - prev), next };
}

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// The Streak Ring: a blue → pink ring that draws itself to `progress` (0 to 1) around whatever sits inside it.
// `breathe` makes an empty ring pulse slowly (the logged-out screen).
export function ProgressRing({ progress, size = 150, stroke = 10, breathe, children }: { progress: number; size?: number; stroke?: number; breathe?: boolean; children?: ReactNode }) {
  useTheme();
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: progress, duration: 1000, delay: 150, easing: Easing.out(Easing.cubic), useNativeDriver: false })
      .start(({ finished }) => { if (finished && progress > 0) tap(); });
  }, [progress]);
  useEffect(() => {
    if (!breathe) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1.04, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [breathe]);
  const offset = v.interpolate({ inputRange: [0, 1], outputRange: [c, 0] });
  return (
    <Animated.View style={{ width: size, height: size, alignSelf: 'center', transform: [{ scale: pulse }] }}>
      <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
        <Defs>
          <SvgGradient id="zafRing" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={colors.brandBlue} />
            <Stop offset="1" stopColor={colors.brandPink} />
          </SvgGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.cardAlt} strokeWidth={stroke} fill="none" />
        <AnimatedCircle cx={size / 2} cy={size / 2} r={r} stroke="url(#zafRing)" strokeWidth={stroke} fill="none"
          strokeLinecap="round" strokeDasharray={`${c} ${c}`} strokeDashoffset={offset} />
      </Svg>
      <View style={[StyleSheet.absoluteFill, { margin: stroke + 6, borderRadius: size, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }]}>
        {children}
      </View>
    </Animated.View>
  );
}

// A number that rolls up from 0 when it first shows.
function CountUp({ value, style }: { value: number; style: object }) {
  const v = useRef(new Animated.Value(0)).current;
  const [n, setN] = useState(0);
  useEffect(() => {
    const id = v.addListener(({ value: x }) => setN(Math.round(x)));
    Animated.timing(v, { toValue: value, duration: 900, delay: 200, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
    return () => v.removeListener(id);
  }, [value]);
  return <Text style={style}>{n}</Text>;
}

// The streak flame flickers gently while the streak is alive.
function Flicker({ on, children }: { on: boolean; children: ReactNode }) {
  const v = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!on) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1.15, duration: 420, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(v, { toValue: 0.95, duration: 380, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(v, { toValue: 1, duration: 500, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [on]);
  return <Animated.View style={{ transform: [{ scale: v }] }}>{children}</Animated.View>;
}

// Days of this month the player played (their own bookings that were played).
function useMonthDays(uid?: string) {
  const [days, setDays] = useState<Set<number> | null>(null);
  const load = useCallback(async () => {
    if (!uid) return;
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const { data } = await supabase.from('bookings').select('start_time,end_time,status').eq('user_id', uid)
      .gte('start_time', start.toISOString()).lte('start_time', now.toISOString()).in('status', ['confirmed', 'completed']);
    const played = new Set<number>();
    for (const b of (data ?? []) as any[]) if (b.status === 'completed' || new Date(b.end_time) < now) played.add(new Date(b.start_time).getDate());
    setDays(played);
  }, [uid]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  return days;
}

// This month as one thin bar per day; days played are tall and in the gradient. They rise one after another.
function MonthBars({ played }: { played: Set<number> }) {
  const s = useS();
  const today = new Date().getDate();
  const anims = useRef(Array.from({ length: 31 }, () => new Animated.Value(0))).current;
  useEffect(() => {
    Animated.stagger(30, anims.slice(0, today).map((a) => Animated.spring(a, { toValue: 1, useNativeDriver: false, speed: 14, bounciness: 8 }))).start();
  }, [played]);
  return (
    <View style={s.tileCard}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={s.cap}>THIS MONTH</Text>
        <Text style={[s.cap, { color: played.size ? colors.success : colors.muted }]}>
          {played.size ? `${played.size} day${played.size === 1 ? '' : 's'} played` : 'No games yet this month'}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 30, marginTop: 10 }}>
        {Array.from({ length: today }, (_, i) => {
          const on = played.has(i + 1);
          const h = anims[i].interpolate({ inputRange: [0, 1], outputRange: [2, on ? 30 : 8] });
          return (
            <Animated.View key={i} style={{ flex: 1, height: h, borderRadius: 3, overflow: 'hidden', backgroundColor: colors.cardAlt }}>
              {on && <LinearGradient colors={GRADIENT} style={StyleSheet.absoluteFill} />}
            </Animated.View>
          );
        })}
      </View>
    </View>
  );
}

function Tile({ icon, value, label, flicker, suffix }: { icon: IconName; value: number; label: string; flicker?: boolean; suffix?: string }) {
  const s = useS();
  return (
    <View style={[s.tileCard, s.tile]}>
      <View style={s.tileIcon}>
        <Flicker on={!!flicker}><Icon name={icon} color={colors.primary} size={17} /></Flicker>
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
          <CountUp value={value} style={s.num} />
          {suffix ? <Text style={[s.small, { marginLeft: 4 }]}>{suffix}</Text> : null}
        </View>
        <Text style={s.small} numberOfLines={1}>{label}</Text>
      </View>
    </View>
  );
}

// A player's numbers for the Profile: stats, trust level and the days played this month. Reloads when the screen comes back.
export function usePlayerStats(uid?: string) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [trust, setTrust] = useState<Trust | null>(null);
  const days = useMonthDays(uid);
  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('my_player_stats');
    if (!error && data) setStats(data as Stats);
    const { data: t } = await supabase.rpc('my_trust');
    if (t) setTrust(t as Trust);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const { p, next } = ringProgress(stats?.games ?? 0);
  return { stats, trust, days, progress: stats ? p : 0, next };
}

// One line under the name: how many games to the next game badge.
export function nextBadgeText(games: number, next: number | null) {
  if (!next) return 'Every game badge earned 🥇';
  const left = next - games;
  return `${left} game${left === 1 ? '' : 's'} to ${BADGE_EMOJI[next]} ${next === 1 ? 'your first game badge' : `${next} games`}`;
}

// The Me tab: stat tiles, this month and every badge in one row (tap one to see what it's for). Fits one screen.
export function StatsPanel({ stats, trust, days, credit }: { stats: Stats | null; trust: Trust | null; days: Set<number> | null; credit: number | null }) {
  const s = useS();
  if (!stats) return <ActivityIndicator style={{ marginTop: 30 }} color={colors.primary} />;
  const earned = BADGES.filter((b) => b.earned(stats));
  const ordered = [...earned, ...BADGES.filter((b) => !b.earned(stats))];
  return (
    <View>
      {trust && <View style={{ alignSelf: 'flex-start', marginBottom: 2 }}><TrustChip trust={trust} /></View>}
      <View style={[s.grid, { marginTop: 6 }]}>
        <Tile icon="ball" value={stats.games} label={stats.games === 1 ? 'Game played' : 'Games played'} />
        <Tile icon="flame" value={stats.streak} label={stats.streak === 1 ? 'Week in a row' : 'Weeks in a row'} flicker={stats.streak > 0} />
        <Tile icon="pin" value={stats.courts} label={stats.courts === 1 ? 'Court' : 'Courts'} />
        <Tile icon="wallet" value={credit ?? 0} suffix="EGP" label="Credit" />
      </View>
      {stats.best_streak > stats.streak && (
        <Text style={[s.small, { textAlign: 'center', marginTop: 6 }]}>
          {stats.streak > 0 ? 'Keep it going' : 'Play this week to start a new streak'} · best {stats.best_streak} weeks
        </Text>
      )}
      {days && <MonthBars played={days} />}
      {stats.games === 0 && (
        <Text style={{ color: colors.text, textAlign: 'center', marginTop: 10 }}>
          Your first game unlocks your first badge. <Link href="/" style={{ color: colors.primaryAlt, textDecorationLine: 'underline' }}>Find a court</Link>
        </Text>
      )}
      <Text style={{ color: colors.text, fontFamily: fonts.displayBold, fontSize: 15, marginTop: 14, marginBottom: 6 }}>
        Badges <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 13 }}>· {earned.length} of {BADGES.length}</Text>
      </Text>
      <View style={{ flexDirection: 'row', gap: 5 }}>
        {ordered.map((b) => {
          const got = b.earned(stats);
          return (
            <Pressable key={b.key} onPress={() => toast(got ? `${b.emoji} ${b.title}` : `${b.title}: ${b.hint}`)} accessibilityRole="button"
              accessibilityLabel={got ? b.title : `${b.title}: ${b.hint}`} style={[s.badge, !got && { opacity: 0.35 }]}>
              <Text style={{ fontSize: 17 }}>{b.emoji}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const useS = themed(() => StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 },
  tileCard: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: 12, marginTop: 8 },
  tile: { flexDirection: 'row', alignItems: 'center', gap: 10, width: '48.5%', marginTop: 0 },
  tileIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: colors.cardAlt, alignItems: 'center', justifyContent: 'center' },
  num: { color: colors.tabOn, fontFamily: fonts.display, fontSize: 21, fontVariant: ['tabular-nums'] },
  cap: { color: colors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 0.6 },
  small: { color: colors.muted, fontSize: 12 },
  badge: { flex: 1, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, borderRadius: radius.sm },
}));
