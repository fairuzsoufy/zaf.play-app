import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { supabase } from '@/lib/supabase';
import { colors, radius } from '@/lib/theme';
import { CourtCard } from '@/components/CourtCard';
import { Note } from '@/components/ui';
import type { CourtRow, Sport } from '@/lib/types';

const COURT_SELECT =
  'id,name,is_indoor,surface_type,maps_url,' +
  'facility:facilities(name,city,address),' +
  'court_sports(price_per_hour,sport:sports(id,name,slug,emoji)),' +
  'court_photos(path,sort_order,status)';

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[s.chip, on && s.chipOn]}>
      <Text style={{ color: on ? '#fff' : colors.muted, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

export default function Courts() {
  const [courts, setCourts] = useState<CourtRow[]>([]);
  const [sports, setSports] = useState<Sport[]>([]);
  const [areas, setAreas] = useState<string[]>([]);
  const [sportId, setSportId] = useState<string | null>(null);
  const [area, setArea] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    const [c, sp, ar] = await Promise.all([
      supabase.from('courts').select(COURT_SELECT).eq('is_active', true).eq('is_approved', true),
      supabase.from('sports').select('id,name,slug,emoji').eq('is_active', true).order('sort_order'),
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

  const list = useMemo(
    () =>
      courts.filter(
        (c) =>
          (!sportId || c.court_sports.some((x) => x.sport?.id === sportId)) &&
          (!area || c.facility?.city === area),
      ),
    [courts, sportId, area],
  );

  if (loading) return <ActivityIndicator style={{ marginTop: 60 }} color={colors.primary} />;

  return (
    <FlatList
      data={list}
      keyExtractor={(c) => c.id}
      contentContainerStyle={{ padding: 16 }}
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.primary} onRefresh={() => { setRefreshing(true); load(); }} />}
      ListHeaderComponent={
        <View style={{ marginBottom: 6 }}>
          {err && <Note kind="error">{err}</Note>}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
            <Chip label="All sports" on={!sportId} onPress={() => setSportId(null)} />
            {sports.map((x) => (
              <Chip key={x.id} label={`${x.emoji ?? ''} ${x.name}`.trim()} on={sportId === x.id} onPress={() => setSportId(x.id)} />
            ))}
          </ScrollView>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
            <Chip label="All areas" on={!area} onPress={() => setArea(null)} />
            {areas.map((x) => (
              <Chip key={x} label={x} on={area === x} onPress={() => setArea(x)} />
            ))}
          </ScrollView>
        </View>
      }
      renderItem={({ item }) => <CourtCard court={item} sportId={sportId} />}
      ListEmptyComponent={<Text style={{ color: colors.muted, textAlign: 'center', marginTop: 40 }}>No courts match these filters.</Text>}
    />
  );
}

const s = StyleSheet.create({
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.lg, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, marginRight: 8 },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
});
