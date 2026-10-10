import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Dimensions, FlatList, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { photoUrl, supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { colors, fonts, radius, themed } from '@/lib/theme';
import { egp } from '@/lib/format';
import { Button, Card } from '@/components/ui';
import type { CourtRow, ReviewStats } from '@/lib/types';

const W = Dimensions.get('window').width;

export default function CourtPage() {
  const insets = useSafeAreaInsets();
  const s = useS();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { session } = useAuth();
  const [court, setCourt] = useState<CourtRow | null>(null);
  const [stats, setStats] = useState<ReviewStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [c, r] = await Promise.all([
        supabase
          .from('courts')
          .select(
            'id,name,is_indoor,surface_type,maps_url,facility:facilities(name,city,address),' +
              'court_sports(price_per_hour,sport:sports(id,name,slug,emoji)),court_photos(path,sort_order,status)',
          )
          .eq('id', id)
          .maybeSingle(),
        supabase.rpc('court_review_stats', { p_court_id: id }),
      ]);
      setCourt((c.data as unknown as CourtRow) ?? null);
      setStats((r.data as ReviewStats) ?? null);
      setLoading(false);
    })();
  }, [id]);

  if (loading) return <ActivityIndicator style={{ marginTop: 60 }} color={colors.primary} />;
  if (!court) return <Text style={{ color: colors.muted, textAlign: 'center', marginTop: 60 }}>This court is not available.</Text>;

  const photos = court.court_photos
    .filter((p) => p.status === 'approved')
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((p) => photoUrl(p.path))
    .filter((u): u is string => !!u);
  const offers = court.court_sports.filter((x) => x.sport);

  function book(sportSlug: string) {
    if (!session) return router.push('/login');
    router.push({ pathname: '/book/[courtId]', params: { courtId: court!.id, sport: sportSlug } });
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ paddingBottom: 30 + insets.bottom }}>
      <Stack.Screen options={{ title: court.name }} />
      {photos.length > 0 && (
        <FlatList
          data={photos}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          keyExtractor={(u) => u}
          renderItem={({ item }) => <Photo uri={item} />}
        />
      )}
      <View style={{ padding: 16 }}>
        <Text style={s.title}>{court.name}</Text>
        <View style={s.badges}>
          <Text style={s.badge}>{court.is_indoor ? '🏠 Indoor' : '☀️ Outdoor'}</Text>
          {court.surface_type ? <Text style={s.badge}>{court.surface_type}</Text> : null}
          {stats && stats.count > 0 && stats.avg !== null ? <Text style={s.badge}>★ {Number(stats.avg).toFixed(1)}</Text> : null}
        </View>
        <Text style={s.sub}>{court.facility?.name}{court.facility?.city ? ` · ${court.facility.city}` : ''}</Text>
        {court.facility?.address ? <Text style={s.sub}>{court.facility.address}</Text> : null}

        {stats && (
          <Text style={[s.sub, { marginTop: 8 }]}>
            {stats.count > 0 && stats.avg !== null ? `★ ${Number(stats.avg).toFixed(1)} (${stats.count} ratings) · ` : ''}
            {stats.played} bookings played here
          </Text>
        )}

        {court.maps_url ? (
          <Pressable onPress={() => Linking.openURL(court.maps_url!)} style={{ marginTop: 12 }}>
            <Text style={{ color: colors.primaryAlt, fontWeight: '600' }}>📍 Open in Maps</Text>
          </Pressable>
        ) : null}

        <Text style={[s.title, { fontSize: 22, marginTop: 24, marginBottom: 10 }]}>Book a time</Text>
        {offers.map((o) => (
          <Card key={o.sport!.id} glow>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <Text style={{ color: colors.text, fontFamily: fonts.displayBold, fontSize: 20 }}>{o.sport!.emoji} {o.sport!.name}</Text>
              <Text style={{ color: colors.text, fontFamily: fonts.display, fontSize: 18 }}>{egp(Number(o.price_per_hour))}<Text style={{ color: colors.muted, fontSize: 13 }}> /hour</Text></Text>
            </View>
            <Button title={`Book ${o.sport!.name} →`} onPress={() => book(o.sport!.slug)} />
          </Card>
        ))}
      </View>
    </ScrollView>
  );
}

// a court photo that slowly zooms in and out, so the page feels alive
function Photo({ uri }: { uri: string }) {
  const z = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(z, { toValue: 1, duration: 7000, useNativeDriver: true }),
      Animated.timing(z, { toValue: 0, duration: 7000, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [z]);
  return (
    <View style={{ width: W, height: 280, overflow: 'hidden' }}>
      <Animated.View style={{ flex: 1, transform: [{ scale: z.interpolate({ inputRange: [0, 1], outputRange: [1, 1.1] }) }] }}>
        <Image source={{ uri }} style={{ flex: 1 }} contentFit="cover" transition={250} />
      </Animated.View>
      <LinearGradient colors={['transparent', colors.bg]} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 90 }} />
    </View>
  );
}

const useS = themed(() => StyleSheet.create({
  title: { color: colors.text, fontFamily: fonts.display, fontSize: 30, lineHeight: 36 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8, marginBottom: 4 },
  badge: { color: colors.text, backgroundColor: colors.cardAlt, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, fontSize: 12, fontWeight: '700', overflow: 'hidden' },
  sub: { color: colors.muted, marginTop: 4 },
  offer: { backgroundColor: colors.card, borderRadius: radius.lg, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: colors.border },
}));
