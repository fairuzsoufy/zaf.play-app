import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, BackHandler, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { photoUrl, supabase } from '@/lib/supabase';
import { colors, gradient, radius } from '@/lib/theme';
import { egp } from '@/lib/format';
import { GradientBar, Logo, Tagline } from '@/components/Brand';
import { Note } from '@/components/ui';
import type { CourtRow, Sport } from '@/lib/types';

type SportFull = Sport & { icon_url: string | null; outdoor_only: boolean; indoor_only: boolean };
type Type = 'indoor' | 'outdoor' | 'any';

const COURT_SELECT =
  'id,name,is_indoor,surface_type,maps_url,' +
  'facility:facilities(name,city,address),' +
  'court_sports(price_per_hour,sport:sports(id,name,slug,emoji)),' +
  'court_photos(path,sort_order,status)';

const cover = (c: CourtRow) => photoUrl(c.court_photos.filter((p) => p.status === 'approved').sort((a, b) => a.sort_order - b.sort_order)[0]?.path);
const countLabel = (n: number, none = 'Coming soon') => (n === 0 ? none : `${n} court${n === 1 ? '' : 's'}`);

// The same path as the website: sport, then area, then indoor/outdoor (only if there is a choice), then the courts.
export default function Home() {
  const router = useRouter();
  const [courts, setCourts] = useState<CourtRow[]>([]);
  const [sports, setSports] = useState<SportFull[]>([]);
  const [areas, setAreas] = useState<string[]>([]);
  const [ratings, setRatings] = useState<Record<string, { avg: number; n: number }>>({});
  const [sport, setSport] = useState<SportFull | null>(null);
  const [area, setArea] = useState<string | null>(null);
  const [type, setType] = useState<Type | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    const [c, sp, ar] = await Promise.all([
      supabase.from('courts').select(COURT_SELECT).eq('is_active', true).eq('is_approved', true),
      supabase.from('sports').select('id,name,slug,emoji,icon_url,outdoor_only,indoor_only').eq('is_active', true).order('sort_order'),
      supabase.from('areas').select('name').eq('is_active', true).order('sort_order'),
    ]);
    if (c.error || sp.error || ar.error) setErr('Could not load the courts. Pull down to try again.');
    setCourts(((c.data ?? []) as unknown as CourtRow[]).filter((x) => x.facility));
    setSports((sp.data ?? []) as SportFull[]);
    setAreas((ar.data ?? []).map((x: { name: string }) => x.name));
    const { data: revs } = await supabase.from('reviews').select('court_id,rating');
    const m: Record<string, { sum: number; n: number }> = {};
    (revs ?? []).forEach((r: any) => { const x = m[r.court_id] ?? { sum: 0, n: 0 }; m[r.court_id] = { sum: x.sum + r.rating, n: x.n + 1 }; });
    setRatings(Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { avg: v.sum / v.n, n: v.n }])));
    setLoading(false);
    setRefreshing(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const sportCourts = useMemo(() => (sport ? courts.filter((c) => c.court_sports.some((x) => x.sport?.id === sport.id)) : []), [courts, sport]);
  const fixedType: Type | undefined = sport?.outdoor_only ? 'outdoor' : sport?.indoor_only ? 'indoor' : undefined;
  const inArea = (a: string) => sportCourts.filter((c) => c.facility?.city === a);
  // the indoor/outdoor question is skipped when this area only has one kind
  const kinds = area ? new Set(inArea(area).map((c) => c.is_indoor)) : new Set<boolean>();
  const onlyType: Type | undefined = kinds.size === 1 ? ([...kinds][0] ? 'indoor' : 'outdoor') : undefined;
  const effectiveType: Type | null = type ?? (area ? fixedType ?? onlyType ?? null : null);
  const step = !sport ? 'sport' : !area ? 'area' : !effectiveType ? 'type' : 'results';

  const results = useMemo(() => {
    if (!sport || !area || !effectiveType) return [];
    const price = (c: CourtRow) => Number(c.court_sports.find((x) => x.sport?.id === sport.id)?.price_per_hour ?? 0);
    return inArea(area)
      .filter((c) => effectiveType === 'any' || (effectiveType === 'indoor' ? c.is_indoor : !c.is_indoor))
      .sort((a, b) => price(a) - price(b));
  }, [sport, area, effectiveType, sportCourts]); // eslint-disable-line react-hooks/exhaustive-deps

  function back() {
    if (step === 'results' && type) setType(null);
    else if (step === 'results' || step === 'type') setArea(null);
    else if (step === 'area') setSport(null);
  }
  // Android's back button goes one step up instead of leaving the app
  useEffect(() => {
    const h = BackHandler.addEventListener('hardwareBackPress', () => { if (step === 'sport') return false; back(); return true; });
    return () => h.remove();
  }); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <View style={{ flex: 1, backgroundColor: colors.bg }}><ActivityIndicator style={{ marginTop: 120 }} color={colors.primary} /></View>;

  const areasWithCourts = areas.filter((a) => inArea(a).length > 0);
  const typeOptions = ([
    ['indoor', '🏠', 'Indoor'], ['outdoor', '☀️', 'Outdoor'], ['any', '✨', 'Show both'],
  ] as const).map(([t, icon, label]) => ({
    t, icon, label,
    count: inArea(area ?? '').filter((c) => t === 'any' || (t === 'indoor' ? c.is_indoor : !c.is_indoor)).length,
  })).filter((o, _i, all) => o.count > 0 && (o.t !== 'any' || all.filter((x) => x.t !== 'any' && x.count > 0).length > 1));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.primary} onRefresh={() => { setRefreshing(true); load(); }} />}
      >
        {step === 'sport' ? (
          <View style={{ alignItems: 'center', marginBottom: 22 }}>
            <Logo size={84} />
            <View style={{ marginTop: 10 }}><Tagline /></View>
            <Text style={s.hero}>Pick your sport.</Text>
            <Text style={[s.hero, { color: colors.pink, marginTop: 0 }]}>We'll find the court.</Text>
            <Text style={{ color: colors.muted, textAlign: 'center', marginTop: 10 }}>Pay by InstaPay, get confirmed, and show up to play.</Text>
          </View>
        ) : (
          <View style={{ marginBottom: 16 }}>
            <Pressable onPress={back} hitSlop={10} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
              <Text style={{ color: colors.primaryAlt, fontSize: 16, fontWeight: '700' }}>‹ {step === 'area' ? 'All sports' : step === 'type' || (step === 'results' && !type) ? 'Choose another area' : 'Indoor or outdoor'}</Text>
            </Pressable>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <SportIcon sport={sport!} size={34} />
              <Text style={{ color: colors.text, fontSize: 26, fontWeight: '800' }}>{sport!.name}</Text>
            </View>
            <View style={{ marginTop: 10, flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              <Crumb label={sport!.name} onPress={() => { setSport(null); setArea(null); setType(null); }} />
              {area && <Crumb label={area} onPress={() => { setArea(null); setType(null); }} />}
              {area && effectiveType && effectiveType !== 'any' && !fixedType && <Crumb label={effectiveType === 'indoor' ? 'Indoor' : 'Outdoor'} onPress={() => setType(null)} />}
            </View>
          </View>
        )}

        {err && <Note kind="error">{err}</Note>}

        {step === 'sport' && (
          <View>
            <Text style={s.step}>1 · What do you want to play?</Text>
            <View style={s.grid}>
              {sports.map((x) => {
                const n = courts.filter((c) => c.court_sports.some((cs) => cs.sport?.id === x.id)).length;
                return (
                  <Pressable key={x.id} disabled={n === 0} onPress={() => setSport(x)} style={({ pressed }) => [s.sportBox, n === 0 && { opacity: 0.45 }, pressed && { opacity: 0.8, transform: [{ scale: 0.98 }] }]}>
                    <SportIcon sport={x} size={52} />
                    <Text style={s.sportName}>{x.name}</Text>
                    <Text style={s.sportSub}>{(x.outdoor_only ? 'Outdoor · ' : x.indoor_only ? 'Indoor · ' : '') + countLabel(n)}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}

        {step === 'area' && (
          <View>
            <Text style={s.step}>2 · Where do you want to play?</Text>
            {areasWithCourts.length === 0 ? (
              <Text style={{ color: colors.muted }}>No {sport!.name} courts are open yet. Check back soon.</Text>
            ) : (
              areasWithCourts.map((a) => (
                <Pressable key={a} onPress={() => { setArea(a); setType(null); }} style={({ pressed }) => [s.row, pressed && { opacity: 0.8 }]}>
                  <Text style={{ fontSize: 22 }}>📍</Text>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={{ color: colors.text, fontSize: 17, fontWeight: '700' }}>{a}</Text>
                    <Text style={{ color: colors.muted, marginTop: 2 }}>{countLabel(inArea(a).length)}</Text>
                  </View>
                  <Text style={{ color: colors.muted, fontSize: 22 }}>›</Text>
                </Pressable>
              ))
            )}
          </View>
        )}

        {step === 'type' && (
          <View>
            <Text style={s.step}>3 · Indoor or outdoor?</Text>
            <View style={s.grid}>
              {typeOptions.map((o) => (
                <Pressable key={o.t} onPress={() => setType(o.t)} style={({ pressed }) => [s.sportBox, pressed && { opacity: 0.8 }]}>
                  <Text style={{ fontSize: 44 }}>{o.icon}</Text>
                  <Text style={s.sportName}>{o.label}</Text>
                  <Text style={s.sportSub}>{countLabel(o.count)}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {step === 'results' && (
          <View>
            <Text style={{ color: colors.text, fontSize: 20, fontWeight: '800', marginBottom: 4 }}>
              {sport!.name} courts in {area}{effectiveType !== 'any' && !fixedType ? ` · ${effectiveType === 'indoor' ? 'Indoor' : 'Outdoor'}` : ''}
            </Text>
            <Text style={{ color: colors.muted, marginBottom: 14 }}>{fixedType ? `${sport!.name} courts are always ${fixedType}.` : `${results.length} court${results.length === 1 ? '' : 's'}, cheapest first`}</Text>
            {results.length === 0 && <Text style={{ color: colors.muted, textAlign: 'center', marginTop: 30 }}>No {sport!.name.toLowerCase()} courts here yet. Try another area.</Text>}
            {results.map((c) => {
              const price = Number(c.court_sports.find((x) => x.sport?.id === sport!.id)?.price_per_hour ?? 0);
              const img = cover(c);
              const rt = ratings[c.id];
              return (
                <Pressable key={c.id} onPress={() => router.push({ pathname: '/court/[id]', params: { id: c.id, sport: sport!.slug } })} style={({ pressed }) => [s.court, pressed && { opacity: 0.88 }]}>
                  {img ? <Image source={{ uri: img }} style={s.courtImg} contentFit="cover" transition={150} /> : <View style={[s.courtImg, { backgroundColor: colors.cardAlt }]} />}
                  <View style={{ padding: 14 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                      <Text style={{ color: colors.text, fontSize: 18, fontWeight: '800', flex: 1 }}>{c.name}</Text>
                      <Text style={s.chip}>{c.is_indoor ? '🏠 Indoor' : '☀️ Outdoor'}</Text>
                    </View>
                    <Text style={{ color: colors.muted, marginTop: 4 }}>{c.facility?.name}</Text>
                    <Text style={{ color: colors.muted, fontSize: 13 }}>{c.facility?.address ? `${c.facility.address}, ` : ''}{c.facility?.city}</Text>
                    <Text style={{ color: colors.muted, fontSize: 13, marginTop: 6 }}>
                      {rt ? <Text style={{ color: colors.warning }}>{'★'.repeat(Math.round(rt.avg))}<Text style={{ color: colors.border }}>{'★'.repeat(5 - Math.round(rt.avg))}</Text>  <Text style={{ color: colors.text, fontWeight: '700' }}>{rt.avg.toFixed(1)}</Text> ({rt.n})</Text> : 'No ratings yet'}
                    </Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
                      <Text><Text style={{ color: colors.pink, fontSize: 24, fontWeight: '800' }}>{egp(price).replace(' EGP', '')}</Text><Text style={{ color: colors.muted }}> EGP / hour</Text></Text>
                      <LinearGradient colors={gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.go}><Text style={{ color: '#fff', fontWeight: '700' }}>View & book</Text></LinearGradient>
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}
        {step === 'sport' && <View style={{ marginTop: 24 }}><GradientBar /></View>}
      </ScrollView>
    </SafeAreaView>
  );
}

function SportIcon({ sport, size }: { sport: SportFull; size: number }) {
  const uri = sport.icon_url ? photoUrl(sport.icon_url) : null;
  if (uri) return <Image source={{ uri }} style={{ width: size, height: size }} contentFit="contain" />;
  return <Text style={{ fontSize: size * 0.9 }}>{sport.emoji ?? '🏅'}</Text>;
}

function Crumb({ label, onPress }: { label: string; onPress: () => void }) {
  return <Pressable onPress={onPress} style={s.crumb}><Text style={{ color: colors.muted, fontSize: 12, fontWeight: '600' }}>{label} ✕</Text></Pressable>;
}

const s = StyleSheet.create({
  hero: { color: colors.text, fontSize: 30, fontWeight: '900', fontStyle: 'italic', marginTop: 14, textAlign: 'center' },
  step: { color: colors.muted, fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  sportBox: { width: '48%', flexGrow: 1, minHeight: 142, backgroundColor: colors.card, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', padding: 14 },
  sportName: { color: colors.text, fontSize: 17, fontWeight: '800', marginTop: 10, textAlign: 'center' },
  sportSub: { color: colors.muted, fontSize: 12, marginTop: 3, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: 16, marginBottom: 10 },
  court: { backgroundColor: colors.card, borderRadius: radius.xl, overflow: 'hidden', marginBottom: 16, borderWidth: 1, borderColor: colors.border },
  courtImg: { width: '100%', height: 170 },
  chip: { color: colors.muted, fontSize: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 3, overflow: 'hidden' },
  go: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: radius.md },
  crumb: { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5 },
});
