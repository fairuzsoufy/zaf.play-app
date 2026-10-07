import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, BackHandler, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { Image } from 'expo-image';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { photoUrl, supabase } from '@/lib/supabase';
import { colors, radius } from '@/lib/theme';
import { CourtCard } from '@/components/CourtCard';
import { GradientFill, Note } from '@/components/ui';
import type { CourtRow, Sport } from '@/lib/types';

const logo = require('@/assets/zaf-logo.png');

const COURT_SELECT =
  'id,name,is_indoor,surface_type,maps_url,' +
  'facility:facilities(name,city,address),' +
  'court_sports(price_per_hour,sport:sports(id,name,slug,emoji)),' +
  'court_photos(path,sort_order,status)';

// A sport's picture (icon_url, served by the website) when it has one, otherwise its emoji.
function SportIcon({ sport, size }: { sport: Sport; size: number }) {
  const uri = photoUrl(sport.icon_url);
  if (uri) return <Image source={{ uri }} style={{ width: size, height: size }} contentFit="contain" />;
  return <Text style={{ fontSize: size * 0.85, lineHeight: size }}>{sport.emoji || '🏅'}</Text>;
}

function countLabel(n: number) {
  return n === 0 ? 'Coming soon' : `${n} court${n === 1 ? '' : 's'}`;
}

// One big sport box; they rise in one after the other.
function SportTile({ sport, count, index, onPress }: { sport: Sport; count: number; index: number; onPress: () => void }) {
  const rise = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(rise, { toValue: 1, duration: 420, delay: 40 * index, useNativeDriver: true }).start();
  }, [rise, index]);

  const empty = count === 0;
  return (
    <Animated.View
      style={[
        s.tileWrap,
        { opacity: rise, transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] },
      ]}
    >
      <Pressable
        onPress={onPress}
        disabled={empty}
        accessibilityRole="button"
        accessibilityLabel={`${sport.name}, ${countLabel(count)}`}
        style={({ pressed }) => [s.tile, empty && { opacity: 0.45 }, pressed && s.tilePressed]}
      >
        <View style={s.tileIcon}>
          <SportIcon sport={sport} size={46} />
        </View>
        <Text style={s.tileName} numberOfLines={1}>{sport.name}</Text>
        <Text style={[s.tileCount, !empty && { color: colors.primaryAlt }]}>{countLabel(count)}</Text>
      </Pressable>
    </Animated.View>
  );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[s.chip, on && s.chipOn]}>
      {on && <GradientFill />}
      <Text style={{ color: on ? '#fff' : colors.muted, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

export default function Courts() {
  const insets = useSafeAreaInsets();
  const [courts, setCourts] = useState<CourtRow[]>([]);
  const [sports, setSports] = useState<Sport[]>([]);
  const [areas, setAreas] = useState<string[]>([]);
  const [sport, setSport] = useState<Sport | null>(null);
  const [area, setArea] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    const [c, sp, ar] = await Promise.all([
      supabase.from('courts').select(COURT_SELECT).eq('is_active', true).eq('is_approved', true),
      supabase.from('sports').select('id,name,slug,emoji,icon_url').eq('is_active', true).order('sort_order'),
      supabase.from('areas').select('name').eq('is_active', true).order('sort_order'),
    ]);
    if (c.error || sp.error || ar.error) setErr('Could not load the courts. Pull down to try again.');
    setCourts(((c.data ?? []) as unknown as CourtRow[]).filter((x) => x.facility));
    setSports((sp.data ?? []) as Sport[]);
    setAreas((ar.data ?? []).map((x: { name: string }) => x.name));
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const refresh = () => { setRefreshing(true); load(); };
  const pickSport = (x: Sport) => { setArea(null); setSport(x); };

  // Android back button: from the courts, go back to the sports first
  useFocusEffect(
    useCallback(() => {
      if (!sport) return;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => { setSport(null); return true; });
      return () => sub.remove();
    }, [sport]),
  );

  const countBySport = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of courts) for (const x of c.court_sports) if (x.sport) m.set(x.sport.id, (m.get(x.sport.id) ?? 0) + 1);
    return m;
  }, [courts]);

  // sports with courts first, the "coming soon" ones after
  const orderedSports = useMemo(
    () => [...sports].sort((a, b) => Number((countBySport.get(b.id) ?? 0) > 0) - Number((countBySport.get(a.id) ?? 0) > 0)),
    [sports, countBySport],
  );

  const sportCourts = useMemo(
    () => (sport ? courts.filter((c) => c.court_sports.some((x) => x.sport?.id === sport.id)) : []),
    [courts, sport],
  );
  // only the areas that actually have a court for this sport
  const sportAreas = useMemo(
    () => areas.filter((a) => sportCourts.some((c) => c.facility?.city === a)),
    [areas, sportCourts],
  );
  const list = useMemo(() => sportCourts.filter((c) => !area || c.facility?.city === area), [sportCourts, area]);

  if (loading) {
    return (
      <View style={[s.center, { paddingTop: insets.top }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const refreshControl = <RefreshControl refreshing={refreshing} tintColor={colors.primary} onRefresh={refresh} />;

  // Step 1: choose a sport
  if (!sport) {
    return (
      <ScrollView
        style={{ backgroundColor: colors.bg }}
        contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 24 }}
        refreshControl={refreshControl}
      >
        <View style={s.brand}>
          <Image source={logo} style={s.brandLogo} contentFit="contain" accessibilityLabel="Zaf Play" />
          <Text style={s.brandTag}>
            Play. Compete. <Text style={{ color: colors.brandPink, fontWeight: '800' }}>Connect.</Text>
          </Text>
        </View>

        {err && <Note kind="error">{err}</Note>}

        <Text style={s.h1}>What do you want to play?</Text>
        <Text style={s.lead}>Pick a sport to see the courts you can book.</Text>

        <View style={s.grid}>
          {orderedSports.map((x, i) => (
            <SportTile key={x.id} sport={x} index={i} count={countBySport.get(x.id) ?? 0} onPress={() => pickSport(x)} />
          ))}
        </View>
      </ScrollView>
    );
  }

  // Step 2: the courts for that sport
  return (
    <FlatList
      data={list}
      keyExtractor={(c) => c.id}
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 24 }}
      refreshControl={refreshControl}
      ListHeaderComponent={
        <View style={{ marginBottom: 6 }}>
          <Pressable onPress={() => setSport(null)} hitSlop={10} style={s.back} accessibilityRole="button">
            <Text style={s.backText}>‹  All sports</Text>
          </Pressable>

          <View style={s.banner}>
            <View style={s.bannerIcon}>
              <SportIcon sport={sport} size={40} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.bannerTitle}>{sport.name}</Text>
              <Text style={s.bannerSub}>{countLabel(list.length)}{area ? ` in ${area}` : ' to book'}</Text>
            </View>
            <Pressable onPress={() => setSport(null)} style={s.change} accessibilityRole="button">
              <Text style={s.changeText}>Change</Text>
            </Pressable>
          </View>

          {err && <Note kind="error">{err}</Note>}

          {sportAreas.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
              <Chip label="All areas" on={!area} onPress={() => setArea(null)} />
              {sportAreas.map((x) => (
                <Chip key={x} label={x} on={area === x} onPress={() => setArea(x)} />
              ))}
            </ScrollView>
          )}
        </View>
      }
      renderItem={({ item }) => <CourtCard court={item} sportId={sport.id} />}
      ListEmptyComponent={<Text style={s.empty}>No {sport.name.toLowerCase()} courts here yet.</Text>}
    />
  );
}

const s = StyleSheet.create({
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },

  brand: { alignItems: 'center', marginBottom: 18 },
  brandLogo: { width: 130, height: 130 },
  brandTag: { color: '#D4D6E4', fontStyle: 'italic', fontSize: 15, letterSpacing: 0.4, marginTop: -6 },

  h1: { color: colors.text, fontSize: 26, fontWeight: '800', marginTop: 4 },
  lead: { color: colors.muted, fontSize: 15, marginTop: 4, marginBottom: 16 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6 },
  tileWrap: { width: '50%', padding: 6 },
  tile: {
    backgroundColor: colors.card, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border,
    paddingVertical: 22, paddingHorizontal: 12, alignItems: 'center',
  },
  tilePressed: { borderColor: colors.brandPurple, backgroundColor: colors.cardAlt, transform: [{ scale: 0.97 }] },
  tileIcon: {
    width: 76, height: 76, borderRadius: 38, backgroundColor: colors.cardAlt,
    alignItems: 'center', justifyContent: 'center', marginBottom: 12,
  },
  tileName: { color: colors.text, fontSize: 17, fontWeight: '700' },
  tileCount: { color: colors.muted, fontSize: 13, marginTop: 4, fontWeight: '600' },

  back: { alignSelf: 'flex-start', paddingVertical: 6, marginBottom: 10 },
  backText: { color: colors.primaryAlt, fontSize: 16, fontWeight: '600' },
  banner: {
    flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.card,
    borderRadius: radius.xl, borderWidth: 1, borderColor: colors.brandPurple, padding: 16, marginBottom: 14,
  },
  bannerIcon: {
    width: 60, height: 60, borderRadius: 30, backgroundColor: colors.cardAlt, alignItems: 'center', justifyContent: 'center',
  },
  bannerTitle: { color: colors.text, fontSize: 22, fontWeight: '800' },
  bannerSub: { color: colors.muted, marginTop: 2 },
  change: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.lg, backgroundColor: colors.cardAlt },
  changeText: { color: colors.text, fontWeight: '600' },

  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.lg, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, marginRight: 8 },
  chipOn: { borderColor: 'transparent', overflow: 'hidden' },

  empty: { color: colors.muted, textAlign: 'center', marginTop: 40 },
});
