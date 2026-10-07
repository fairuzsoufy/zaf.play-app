import { useEffect, useState } from 'react';
import { ActivityIndicator, Dimensions, FlatList, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { photoUrl, supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { colors, radius } from '@/lib/theme';
import { egp } from '@/lib/format';
import { Button } from '@/components/ui';
import type { CourtRow, ReviewStats } from '@/lib/types';

const W = Dimensions.get('window').width;

export default function CourtPage() {
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
    <ScrollView>
      <Stack.Screen options={{ title: court.name }} />
      {photos.length > 0 && (
        <FlatList
          data={photos}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          keyExtractor={(u) => u}
          renderItem={({ item }) => <Image source={{ uri: item }} style={{ width: W, height: 240 }} contentFit="cover" />}
        />
      )}
      <View style={{ padding: 16 }}>
        <Text style={s.title}>{court.name}</Text>
        <Text style={s.sub}>{court.facility?.name}{court.facility?.city ? ` · ${court.facility.city}` : ''}</Text>
        {court.facility?.address ? <Text style={s.sub}>{court.facility.address}</Text> : null}
        <Text style={s.sub}>{court.is_indoor ? 'Indoor' : 'Outdoor'}{court.surface_type ? ` · ${court.surface_type}` : ''}</Text>

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

        <Text style={[s.title, { fontSize: 16, marginTop: 22, marginBottom: 10 }]}>Book a time</Text>
        {offers.map((o) => (
          <View key={o.sport!.id} style={s.offer}>
            <Text style={{ color: colors.text, fontSize: 16, fontWeight: '600', marginBottom: 2 }}>
              {o.sport!.emoji} {o.sport!.name}
            </Text>
            <Text style={{ color: colors.muted, marginBottom: 10 }}>{egp(Number(o.price_per_hour))} / hour</Text>
            <Button title={`Book for ${o.sport!.name}`} onPress={() => book(o.sport!.slug)} />
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  title: { color: colors.text, fontSize: 22, fontWeight: '800' },
  sub: { color: colors.muted, marginTop: 4 },
  offer: { backgroundColor: colors.card, borderRadius: radius.lg, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: colors.border },
});
