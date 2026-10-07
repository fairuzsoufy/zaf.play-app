import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { photoUrl } from '@/lib/supabase';
import { colors, fonts, radius, themed } from '@/lib/theme';
import { egp } from '@/lib/format';
import { GradientFill, PressableScale } from './ui';
import type { CourtRow } from '@/lib/types';

export function firstPhoto(c: CourtRow): string | null {
  const p = c.court_photos
    .filter((x) => x.status === 'approved')
    .sort((a, b) => a.sort_order - b.sort_order)[0];
  return photoUrl(p?.path);
}

// A court: its photo with the name over it, the sports and the price. Cards slide in one after the other.
export function CourtCard({ court, sportId, index = 0 }: { court: CourtRow; sportId: string | null; index?: number }) {
  const s = useS();
  const router = useRouter();
  const offers = court.court_sports.filter((x) => x.sport);
  const shown = sportId ? offers.filter((x) => x.sport!.id === sportId) : offers;
  const from = shown.length ? Math.min(...shown.map((x) => Number(x.price_per_hour))) : null;
  const img = firstPhoto(court);

  const rise = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(rise, { toValue: 1, duration: 450, delay: Math.min(index, 6) * 80, useNativeDriver: true }).start();
  }, [rise, index]);

  return (
    <Animated.View style={{ opacity: rise, transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }] }}>
      <PressableScale
        onPress={() => router.push({ pathname: '/court/[id]', params: { id: court.id } })}
        accessibilityRole="button"
        accessibilityLabel={court.name}
        style={s.card}
        scaleTo={0.97}
      >
        <View style={s.photo}>
          {img
            ? <Image source={{ uri: img }} style={StyleSheet.absoluteFill} contentFit="cover" transition={250} />
            : <View style={[StyleSheet.absoluteFill, { overflow: 'hidden', opacity: 0.35 }]}><GradientFill /></View>}
          <LinearGradient colors={['transparent', 'rgba(7,6,13,0.92)']} style={s.shade} />
          <View style={s.tag}>
            <Text style={s.tagText}>{court.is_indoor ? 'Indoor' : 'Outdoor'}</Text>
          </View>
          {from !== null && (
            <View style={s.price}>
              <GradientFill />
              <Text style={s.priceText}>{egp(from)}<Text style={{ fontSize: 11 }}> /h</Text></Text>
            </View>
          )}
          <View style={s.over}>
            <Text style={s.title} numberOfLines={1}>{court.name}</Text>
            <Text style={s.place} numberOfLines={1}>
              📍 {court.facility?.name}{court.facility?.city ? ` · ${court.facility.city}` : ''}
            </Text>
          </View>
        </View>
        <View style={s.sports}>
          {offers.map((x) => (
            <View key={x.sport!.id} style={[s.chip, x.sport!.id === sportId && s.chipOn]}>
              <Text style={[s.chipText, x.sport!.id === sportId && { color: colors.text }]}>{`${x.sport!.emoji ?? ''} ${x.sport!.name}`.trim()}</Text>
            </View>
          ))}
        </View>
      </PressableScale>
    </Animated.View>
  );
}

const useS = themed(() => StyleSheet.create({
  card: {
    backgroundColor: colors.card, borderRadius: radius.xl, overflow: 'hidden', marginBottom: 16, borderWidth: 1, borderColor: colors.border,
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 5,
  },
  photo: { height: 190, justifyContent: 'flex-end', backgroundColor: colors.cardAlt },
  shade: { position: 'absolute', left: 0, right: 0, bottom: 0, top: '35%' },
  over: { padding: 14 },
  title: { color: '#fff', fontFamily: fonts.display, fontSize: 22 },
  place: { color: 'rgba(255,255,255,0.85)', fontSize: 13, marginTop: 2 },
  tag: { position: 'absolute', top: 12, left: 12, backgroundColor: 'rgba(7,6,13,0.6)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  tagText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  price: { position: 'absolute', top: 12, right: 12, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5, overflow: 'hidden' },
  priceText: { color: '#fff', fontFamily: fonts.displayBold, fontSize: 15 },
  sports: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, padding: 12 },
  chip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: colors.cardAlt, borderWidth: 1, borderColor: colors.border },
  chipOn: { borderColor: colors.brandPurple, backgroundColor: colors.soft },
  chipText: { color: colors.muted, fontSize: 12, fontWeight: '600' },
}));
