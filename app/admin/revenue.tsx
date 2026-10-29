import { useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Stack } from 'expo-router';
import { Text } from '@/components/AppText';
import { supabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';
import { defaultGroup, egp0, RANGES, Tile } from '@/components/revenue';
import { Box, Chip, Chips, LinkButton, Loading, Muted } from '@/components/owner';

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

// Zaf Play's revenue, like the website's admin Revenue: money collected, Zaf Play earnings and owners' share
// for a date range, filtered by area, sport and owner, with a split by city, sport or owner.
export default function AdminRevenue() {
  const [rangeLabel, setRangeLabel] = useState('Last 30 days');
  const [[from, to], setRange] = useState<[string, string]>(() => RANGES[3].get());
  const group = defaultGroup(from, to);
  const [city, setCity] = useState('');
  const [sportId, setSportId] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [splitBy, setSplitBy] = useState('city');
  const [areas, setAreas] = useState<string[]>([]);
  const [sports, setSports] = useState<any[]>([]);
  const [owners, setOwners] = useState<any[]>([]);
  const [rows, setRows] = useState<any[] | null>(null);
  const [breakdown, setBreakdown] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    supabase.from('sports').select('id, name').order('name').then(({ data }) => setSports(data || []));
    supabase.from('areas').select('name').order('name').then(({ data }) => setAreas((data || []).map((x: any) => x.name)));
    supabase.from('users').select('id, full_name').eq('role', 'owner').order('full_name').then(({ data }) => setOwners(data || []));
  }, []);

  useEffect(() => {
    (async () => {
      const common = { p_from: from, p_to: to, p_sport_id: sportId || null, p_city: city || null, p_owner_id: ownerId || null };
      const [series, split] = await Promise.all([
        supabase.rpc('admin_revenue', { ...common, p_group: group }),
        supabase.rpc('admin_revenue_breakdown', { ...common, p_by: splitBy }),
      ]);
      if (series.error || split.error) return setError((series.error || split.error)!.message);
      setError('');
      setRows((series.data as any[]) || []);
      setBreakdown((split.data as any[]) || []);
    })();
  }, [from, to, group, city, sportId, ownerId, splitBy]);

  const totals = useMemo(() => {
    const x = { bookings: 0, gross: 0, zaf: 0, owner: 0 };
    for (const r of rows || []) {
      x.bookings += Number(r.bookings);
      x.gross += Number(r.gross);
      x.zaf += Number(r.zaf_earnings);
      x.owner += Number(r.owner_share);
    }
    return x;
  }, [rows]);
  const maxSplit = Math.max(...breakdown.map((b) => Number(b.gross)), 1);
  const maxRow = Math.max(...(rows || []).map((r) => Number(r.zaf_earnings)), 1);
  const periodLabel = (iso: string) => {
    const d = new Date(`${iso}T12:00:00`);
    if (group === 'month') return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
    if (group === 'week') return `Week of ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Revenue' }} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }}>
          {RANGES.map((r) => <Chip key={r.label} label={r.label} on={rangeLabel === r.label} onPress={() => { setRangeLabel(r.label); setRange(r.get()); }} />)}
        </ScrollView>
        <Muted style={{ marginBottom: 10 }}>{from} → {to}</Muted>
        <Muted>Area</Muted>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <Chip label="All areas" on={!city} onPress={() => setCity('')} />
          {areas.map((a) => <Chip key={a} label={a} on={city === a} onPress={() => setCity(a)} />)}
        </ScrollView>
        <Muted>Sport</Muted>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <Chip label="All sports" on={!sportId} onPress={() => setSportId('')} />
          {sports.map((s) => <Chip key={s.id} label={s.name} on={sportId === s.id} onPress={() => setSportId(s.id)} />)}
        </ScrollView>
        <Muted>Owner</Muted>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 6 }}>
          <Chip label="All owners" on={!ownerId} onPress={() => setOwnerId('')} />
          {owners.map((o) => <Chip key={o.id} label={o.full_name || '—'} on={ownerId === o.id} onPress={() => setOwnerId(o.id)} />)}
        </ScrollView>
        <Muted style={{ marginBottom: 10 }}>Counts paid bookings (and fees kept from late cancellations) on the day of the game, Cairo time. Upcoming paid bookings are included.</Muted>
        {!!error && <Text style={{ color: colors.danger, marginBottom: 8 }}>{error}</Text>}
        {rows === null ? <Loading /> : (
          <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4, marginBottom: 12 }}>
              <Tile label="Money collected" value={egp0(totals.gross)} sub={`${totals.bookings} booking(s)`} />
              <Tile label="Zaf Play earnings" value={egp0(totals.zaf)} sub="Commission + InstaPay fees" strong />
              <Tile label="Owners' share" value={egp0(totals.owner)} />
              <Tile label={`Average per ${group}`} value={egp0(rows.length ? totals.gross / rows.length : 0)}
                sub={`${rows.length ? (totals.bookings / rows.length).toFixed(1) : 0} booking(s) per ${group}`} />
            </View>

            <Box>
              <Text style={{ color: colors.text, fontWeight: '800', marginBottom: 8 }}>Split by</Text>
              <Chips>{['city', 'sport', 'owner'].map((b) => <Chip key={b} label={cap(b)} on={splitBy === b} onPress={() => setSplitBy(b)} />)}</Chips>
              {breakdown.length === 0 ? <Muted>No bookings for these filters.</Muted> : breakdown.map((b) => (
                <View key={b.key} style={{ paddingVertical: 8, borderTopWidth: 1, borderColor: colors.border }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ color: colors.text, fontWeight: '700', flex: 1 }}>{b.label}</Text>
                    <Text style={{ color: colors.text }}>{egp0(b.gross)}</Text>
                  </View>
                  <Muted style={{ fontSize: 12 }}>Bookings: {b.bookings} · Zaf Play earnings: {egp0(b.zaf_earnings)}</Muted>
                  <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.brandBlue, width: `${(Number(b.gross) / maxSplit) * 100}%`, marginTop: 4 }} />
                </View>
              ))}
            </Box>

            <LinkButton title={showTable ? `Hide the numbers per ${group}` : `Show the numbers per ${group}`} onPress={() => setShowTable(!showTable)} />
            {showTable && [...rows].reverse().map((r) => (
              <View key={r.period} style={{ paddingVertical: 8, borderBottomWidth: 1, borderColor: colors.border }}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>{periodLabel(r.period)}</Text>
                <Muted style={{ fontSize: 12 }}>Bookings: {r.bookings} · Money: {egp0(r.gross)} · Zaf Play: {egp0(r.zaf_earnings)} · Owners: {egp0(r.owner_share)}</Muted>
                <View style={{ height: 4, borderRadius: 2, backgroundColor: colors.success, width: `${(Number(r.zaf_earnings) / maxRow) * 100}%`, marginTop: 4 }} />
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </>
  );
}
