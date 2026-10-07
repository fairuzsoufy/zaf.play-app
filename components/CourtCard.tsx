import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { photoUrl } from '@/lib/supabase';
import { colors, radius, themed } from '@/lib/theme';
import { egp } from '@/lib/format';
import type { CourtRow } from '@/lib/types';

export function firstPhoto(c: CourtRow): string | null {
  const p = c.court_photos
    .filter((x) => x.status === 'approved')
    .sort((a, b) => a.sort_order - b.sort_order)[0];
  return photoUrl(p?.path);
}

export function CourtCard({ court, sportId }: { court: CourtRow; sportId: string | null }) {
  const router = useRouter();
  const offers = court.court_sports.filter((x) => x.sport);
  const shown = sportId ? offers.filter((x) => x.sport!.id === sportId) : offers;
  const from = shown.length ? Math.min(...shown.map((x) => Number(x.price_per_hour))) : null;
  const img = firstPhoto(court);

  return (
    <Pressable
      onPress={() => router.push({ pathname: '/court/[id]', params: { id: court.id } })}
      style={({ pressed }) => [s.card, pressed && { opacity: 0.85 }]}
    >
      {img ? <Image source={{ uri: img }} style={s.img} contentFit="cover" transition={150} /> : <View style={[s.img, { backgroundColor: colors.cardAlt }]} />}
      <View style={{ padding: 14 }}>
        <Text style={s.title}>{court.name}</Text>
        <Text style={s.sub}>
          {court.facility?.name}{court.facility?.city ? ` · ${court.facility.city}` : ''}
        </Text>
        <View style={s.row}>
          <Text style={s.sub}>
            {offers.map((x) => `${x.sport!.emoji ?? ''} ${x.sport!.name}`.trim()).join('  ')}
          </Text>
        </View>
        {from !== null && <Text style={s.price}>from {egp(from)} / hour</Text>}
      </View>
    </Pressable>
  );
}

const s = themed(() => ({
  card: { backgroundColor: colors.card, borderRadius: radius.lg, overflow: 'hidden', marginBottom: 14, borderWidth: 1, borderColor: colors.border },
  img: { width: '100%', height: 150 },
  title: { color: colors.text, fontSize: 17, fontWeight: '700' },
  sub: { color: colors.muted, marginTop: 3, fontSize: 13 },
  row: { marginTop: 4 },
  price: { color: colors.primaryAlt, marginTop: 8, fontWeight: '700' },
}));
