import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, FlatList, Keyboard, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, useWindowDimensions, View,
} from 'react-native';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Text, TextInput } from '@/components/AppText';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import MapView, { Marker } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { photoUrl, supabase } from '@/lib/supabase';
import { colors, fonts, radius, themed, useTheme } from '@/lib/theme';
import { cairoDate, egp } from '@/lib/format';
import {
  businessToday, cardLength, distanceKm, formatDistance, freeStartsOn, nextFreeDay, searchMatches, spreadStarts, startLabel,
  type Busy, type Coords, type Rule,
} from '@/lib/courtTimes';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Logo } from '@/components/Logo';
import { Icon } from '@/components/Icon';
import { GradientFill, GradientText, Note, PressableScale, EmptyState, Skeleton } from '@/components/ui';
import type { Sport } from '@/lib/types';
import { readArea, readFavourites, saveArea, toggleFavourite } from '@/lib/bookPrefs';

// The Book screen, like zafplay.com/book: search, sport, area, day, indoor / outdoor, near me, list or map,
// and every court with its free times for the chosen day (cheapest first, or nearest with Near me).

const NEAR_ME_KM = 15; // same as the website
const DAYS = 14;
const CAL_DAYS = 60; // how far the calendar button reaches
const RECENT_KEY = 'zaf-recent-searches';

// one row per court and sport (a court with two sports shows twice, each with its own price)
type BookCourt = {
  key: string; id: string; sport: string; name: string; isIndoor: boolean; price: number; cover: string | null;
  branchId: string; branchName: string; area: string; lat: number | null; lng: number | null;
  rating: { avg: number; n: number } | null; minMinutes: number; rules: Rule[]; km?: number | null;
};

const CATALOGUE = `price_per_hour, sport:sports!inner(slug),
  court:courts!inner(id, name, is_indoor, is_active, is_approved, bookable_until, min_booking_minutes,
    availability_rules(day_of_week, open_time, close_time, is_closed), court_photos(path, status, sort_order),
    facility:facilities!inner(id, name, city, latitude, longitude, is_approved, is_active))`;

// ---- busy times of a court, read once per court and shared by its cards; refreshed on pull-down or a live change ----
const busyCache = new Map<string, Promise<Busy[]>>();
let busyVersion = 0;
const busyListeners = new Set<() => void>();
function forgetBusy() {
  busyCache.clear();
  busyVersion++;
  busyListeners.forEach((f) => f());
}
function useBusy(courtId: string) {
  const [busy, setBusy] = useState<Busy[] | null>(null);
  const [v, setV] = useState(busyVersion);
  useEffect(() => {
    const f = () => setV(busyVersion);
    busyListeners.add(f);
    return () => { busyListeners.delete(f); };
  }, []);
  useEffect(() => {
    let gone = false;
    if (!busyCache.has(courtId)) {
      busyCache.set(courtId, Promise.resolve(supabase.rpc('court_busy_slots', { p_court_id: courtId })).then(({ data }) => (data ?? []) as Busy[]));
    }
    busyCache.get(courtId)!.then((d) => !gone && setBusy(d)).catch(() => !gone && setBusy([]));
    return () => { gone = true; };
  }, [courtId, v]);
  return busy;
}

function readRecent(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; }
}
function saveRecent(list: string[]) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch {}
}

function dayWord(date: string) {
  if (date === cairoDate()) return 'Today';
  if (date === cairoDate(1)) return 'Tomorrow';
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', timeZone: 'UTC' });
}

// A sport's picture (icon_url, served by the website) when it has one, otherwise its emoji.
function SportIcon({ sport, size }: { sport: Sport; size: number }) {
  const uri = photoUrl(sport.icon_url);
  if (uri) return <Image source={{ uri }} style={{ width: size, height: size }} contentFit="contain" />;
  return <Text style={{ fontSize: size * 0.85, lineHeight: size * 1.1 }}>{sport.emoji || '🏅'}</Text>;
}

function Chip({ label, on, onPress, dim, icon }: { label: string; on: boolean; onPress: () => void; dim?: boolean; icon?: React.ReactNode }) {
  const s = useS();
  return (
    <Pressable onPress={onPress} style={[s.chip, on && s.chipOn, dim && { opacity: 0.45 }]} accessibilityRole="button" accessibilityState={{ selected: on }}>
      {on && <GradientFill />}
      {icon}
      <Text style={{ color: on ? '#fff' : colors.muted, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

// the green free times on a court card for the chosen day, or "Full" with the next free time
function CardTimes({ c, date: dateIn, onTime }: { c: BookCourt; date: string; onTime: (date: string, start?: number, dur?: number) => void }) {
  const s = useS();
  const busy = useBusy(c.id);
  if (busy === null) return <View style={{ height: 40 }} />;
  const nowMs = Date.now();
  const dur = cardLength(c.minMinutes);
  // "today" for a court open past midnight is still yesterday's evening until it closes
  const date = dateIn === cairoDate() ? businessToday(c.rules, nowMs) : dateIn;
  const starts = freeStartsOn({ rules: c.rules, busy, date, nowMs, length: dur, step: 30 });
  if (starts.length === 0) {
    const next = nextFreeDay({ rules: c.rules, busy, from: date, nowMs, length: dur, days: 14 });
    return (
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
        <View style={[s.time, { borderColor: colors.border }]}><Text style={{ color: colors.muted, fontSize: 13 }}>{dateIn !== cairoDate() ? 'Full this day' : date !== dateIn ? 'Full tonight' : 'Full today'}</Text></View>
        {next && (
          <Pressable accessibilityRole="button" onPress={() => onTime(next.date, next.start, dur)} style={s.time}>
            <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>Next: {dayWord(next.date)} {startLabel(next.start)}</Text>
          </Pressable>
        )}
      </View>
    );
  }
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
      {spreadStarts(starts, 3).map((m) => (
        <Pressable accessibilityRole="button" key={m} onPress={() => onTime(date, m, dur)} style={[s.time, s.timeFree]}>
          <Text style={{ color: colors.success, fontSize: 13, fontWeight: '700' }}>{startLabel(m)}</Text>
        </Pressable>
      ))}
      <Pressable accessibilityRole="button" onPress={() => onTime(date)} style={s.time}><Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>More</Text></Pressable>
    </View>
  );
}

// a search result's next free time (today, or the next day with room)
function NextFree({ c }: { c: BookCourt }) {
  const busy = useBusy(c.id);
  if (busy === null) return null;
  const next = nextFreeDay({ rules: c.rules, busy, from: cairoDate(), nowMs: Date.now(), length: cardLength(c.minMinutes), days: 14 });
  if (!next) return <Text style={{ color: colors.muted, fontSize: 12 }}>No free times</Text>;
  return <Text style={{ color: colors.success, fontWeight: '700', fontSize: 13 }}>{next.date === cairoDate() ? '' : `${dayWord(next.date)} `}{startLabel(next.start)} free</Text>;
}

function CourtCardRow({ c, sport, date, onOpen, onTime, fav, onFav }: {
  c: BookCourt; sport?: Sport; date: string; onOpen: () => void; onTime: (date: string, start?: number, dur?: number) => void;
  fav: boolean; onFav: () => void;
}) {
  const s = useS();
  return (
    <PressableScale onPress={onOpen} style={s.card} scaleTo={0.98} accessibilityRole="button" accessibilityLabel={`${c.branchName} ${c.name}`}>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={s.thumb}>
          {c.cover
            ? <Image source={{ uri: c.cover }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
            : <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>{sport && <SportIcon sport={sport} size={30} />}</View>}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }} numberOfLines={1}>{c.branchName} · {c.name}</Text>
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
            {sport?.name || c.sport} · {c.isIndoor ? 'Indoor' : 'Outdoor'} · {c.area}{c.km != null ? ` · ${formatDistance(c.km)}` : ''}
          </Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
            <Text style={{ color: colors.text, fontWeight: '700' }}>{egp(c.price)}<Text style={{ color: colors.muted, fontWeight: '400' }}> / hour</Text></Text>
            {c.rating && c.rating.n > 0 && <Text style={{ color: colors.warning, fontSize: 12 }}>★ {c.rating.avg.toFixed(1)} ({c.rating.n})</Text>}
          </View>
        </View>
        {/* the heart saves the court on this phone: favourites come first and under the Favourites chip */}
        <Pressable onPress={onFav} hitSlop={10} accessibilityRole="button" accessibilityState={{ selected: fav }}
          accessibilityLabel={fav ? `Remove ${c.name} from favourites` : `Add ${c.name} to favourites`}>
          <Text style={{ fontSize: 20, color: fav ? colors.brandPinkBright : colors.muted }}>{fav ? '♥' : '♡'}</Text>
        </Pressable>
      </View>
      <CardTimes c={c} date={date} onTime={onTime} />
    </PressableScale>
  );
}

export default function Book() {
  const s = useS();
  const { scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [courts, setCourts] = useState<BookCourt[]>([]);
  const [sports, setSports] = useState<Sport[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sport, setSport] = useState(''); // '' = all sports
  const [area, setArea] = useState('');
  const [club, setClub] = useState(''); // a branch picked from the search
  const [place, setPlace] = useState<'' | 'indoor' | 'outdoor'>('');
  const [date, setDate] = useState(cairoDate());
  const [loc, setLoc] = useState<Coords | null>(null);
  const [locBusy, setLocBusy] = useState(false);
  const [locMsg, setLocMsg] = useState('');
  const [view, setView] = useState<'list' | 'map'>('list');
  const [selected, setSelected] = useState<string | null>(null); // branch picked on the map
  const [query, setQuery] = useState('');
  const [q, setQ] = useState('');
  const [focus, setFocus] = useState(false);
  const [recent, setRecent] = useState<string[]>(readRecent);
  const [favs, setFavs] = useState<string[]>(readFavourites); // courts with the heart on (this phone only)
  const [favOnly, setFavOnly] = useState(false);
  const areaRestored = useRef(false);
  const searchRef = useRef<TextInput>(null);

  const load = useCallback(async () => {
    setErr(null);
    const [sp, rows] = await Promise.all([
      supabase.from('sports').select('id,name,slug,emoji,icon_url').eq('is_active', true).order('name'),
      supabase.from('court_sports').select(CATALOGUE)
        .eq('court.is_active', true).eq('court.is_approved', true).eq('court.facility.is_approved', true).eq('court.facility.is_active', true),
    ]);
    if (sp.error || rows.error) { setErr('Could not load the courts. Pull down to try again.'); setLoading(false); setRefreshing(false); return; }
    const nowMs = Date.now();
    const live = ((rows.data ?? []) as any[]).filter((r) => r.court?.facility && r.court.bookable_until && new Date(r.court.bookable_until).getTime() > nowMs);
    const ids = [...new Set(live.map((r) => r.court.id))];
    const { data: rt } = ids.length ? await supabase.rpc('court_ratings', { p_court_ids: ids }) : { data: [] };
    const ratings = new Map(((rt as any[]) ?? []).map((x) => [x.court_id, { avg: Number(x.total) / Math.max(1, Number(x.n)), n: Number(x.n) }]));
    setCourts(live.map((r) => {
      const c = r.court;
      const cover = [...(c.court_photos || [])].filter((p: any) => p.status === 'approved').sort((a: any, b: any) => a.sort_order - b.sort_order)[0];
      return {
        key: `${c.id}-${r.sport.slug}`, id: c.id, sport: r.sport.slug, name: c.name, isIndoor: !!c.is_indoor, price: Number(r.price_per_hour),
        cover: photoUrl(cover?.path), branchId: c.facility.id, branchName: c.facility.name, area: c.facility.city,
        lat: c.facility.latitude, lng: c.facility.longitude, rating: ratings.get(c.id) ?? null,
        minMinutes: Number(c.min_booking_minutes || 0), rules: c.availability_rules || [],
      };
    }));
    setSports((sp.data ?? []) as Sport[]);
    forgetBusy();
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  // the area picked last time comes back, when it still has courts
  useEffect(() => {
    if (areaRestored.current || !courts.length) return;
    areaRestored.current = true;
    const a = readArea();
    if (a && courts.some((c) => c.area === a)) setArea(a);
  }, [courts]);
  // a booking, hold or block anywhere: read the free times again
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const ch = supabase.channel(`book-${Date.now()}`)
      .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'bookings' }, () => { clearTimeout(t); t = setTimeout(forgetBusy, 1500); })
      .subscribe();
    return () => { clearTimeout(t); supabase.removeChannel(ch); };
  }, []);
  useEffect(() => { const t = setTimeout(() => setQ(query.trim()), 200); return () => clearTimeout(t); }, [query]);

  const sportOf = (slug: string) => sports.find((x) => x.slug === slug);
  const countBySport = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const c of courts) m.set(c.sport, (m.get(c.sport) ?? new Set()).add(c.id));
    return m;
  }, [courts]);
  const placeOk = (c: BookCourt, p: typeof place) => !p || (p === 'indoor') === c.isIndoor;
  const areas = useMemo(() => [...new Set(courts.filter((c) => (!sport || c.sport === sport) && placeOk(c, place)).map((c) => c.area))].sort(),
    [courts, sport, place]); // eslint-disable-line react-hooks/exhaustive-deps
  const places = useMemo(() => {
    const here = courts.filter((c) => (!sport || c.sport === sport) && (!area || c.area === area));
    return (['indoor', 'outdoor'] as const).filter((p) => here.some((c) => placeOk(c, p)));
  }, [courts, sport, area]); // eslint-disable-line react-hooks/exhaustive-deps

  function pickSport(slug: string) {
    setSport(slug);
    setClub('');
    setSelected(null);
    // an area or indoor / outdoor with no court for this sport is dropped
    setArea((a) => (a && courts.some((c) => (!slug || c.sport === slug) && c.area === a) ? a : ''));
    setPlace((p) => (p && courts.some((c) => (!slug || c.sport === slug) && placeOk(c, p)) ? p : ''));
  }
  function pickArea(a: string) { setArea(a); setClub(''); setSelected(null); saveArea(a); }
  function flipFav(id: string) {
    const next = toggleFavourite(id);
    setFavs(next);
    if (!next.length) setFavOnly(false);
  }
  function pickPlace(p: typeof place) {
    setPlace(p);
    setClub('');
    setSelected(null);
    setArea((a) => (a && courts.some((c) => (!sport || c.sport === sport) && c.area === a && placeOk(c, p)) ? a : ''));
  }

  async function nearMe() {
    if (loc) { setLoc(null); return; }
    setLocBusy(true);
    setLocMsg('');
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') setLocMsg('Location is off for Zaf Play. Allow it in your phone settings, or pick an area.');
      else {
        const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setLoc({ lat: p.coords.latitude, lng: p.coords.longitude });
      }
    } catch {
      setLocMsg('Could not find your position. Pick an area instead.');
    }
    setLocBusy(false);
  }

  const list = useMemo(() => {
    const rows = courts
      .filter((c) => (!sport || c.sport === sport) && (!area || c.area === area) && placeOk(c, place) && (!club || c.branchId === club))
      .filter((c) => !favOnly || favs.includes(c.id))
      .map((c) => ({ ...c, km: loc && c.lat !== null && c.lng !== null ? distanceKm(loc, { lat: c.lat, lng: c.lng }) : null }))
      .filter((c) => !loc || (c.km !== null && c.km <= NEAR_ME_KM));
    // favourites first, then nearest (Near me) or cheapest
    const fav = (c: BookCourt) => (favs.includes(c.id) ? 0 : 1);
    return loc ? rows.sort((a, b) => fav(a) - fav(b) || (a.km ?? 0) - (b.km ?? 0) || a.price - b.price) : rows.sort((a, b) => fav(a) - fav(b) || a.price - b.price);
  }, [courts, sport, area, place, club, loc, favs, favOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  const pins = useMemo(() => {
    const by = new Map<string, { id: string; lat: number; lng: number; price: number; count: number; name: string }>();
    for (const c of list) {
      if (c.lat === null || c.lng === null) continue;
      const cur = by.get(c.branchId);
      if (cur) { cur.count += 1; cur.price = Math.min(cur.price, c.price); }
      else by.set(c.branchId, { id: c.branchId, lat: c.lat, lng: c.lng, price: c.price, count: 1, name: c.branchName });
    }
    return [...by.values()];
  }, [list]);

  // ---- search, on the courts already loaded ----
  const searching = q.length >= 2;
  const results = useMemo(() => {
    if (!searching) return null;
    const pool = courts.filter((c) => !sport || c.sport === sport);
    const seen = new Set<string>();
    const courtHits = pool.filter((c) => searchMatches(q, `${c.name} ${c.branchName} ${c.area} ${sportOf(c.sport)?.name || c.sport}`))
      .filter((c) => !seen.has(c.id) && !!seen.add(c.id)).slice(0, 6);
    const clubs = new Map<string, { id: string; name: string; area: string; n: number }>();
    for (const c of pool) if (searchMatches(q, c.branchName) && !clubs.has(c.branchId)) clubs.set(c.branchId, { id: c.branchId, name: c.branchName, area: c.area, n: 0 });
    for (const x of clubs.values()) x.n = new Set(pool.filter((c) => c.branchId === x.id).map((c) => c.id)).size;
    const areaHits = [...new Set(pool.map((c) => c.area))].filter((a) => searchMatches(q, a))
      .map((a) => ({ name: a, n: new Set(pool.filter((c) => c.area === a).map((c) => c.id)).size })).slice(0, 3);
    const sportHits = sport ? [] : sports.filter((x) => searchMatches(q, x.name));
    return { courtHits, clubs: [...clubs.values()].slice(0, 3), areaHits, sportHits };
  }, [searching, q, courts, sport, sports]); // eslint-disable-line react-hooks/exhaustive-deps
  const nothing = !!results && results.courtHits.length + results.clubs.length + results.areaHits.length + results.sportHits.length === 0;

  function remember(text: string) {
    const t = text.trim();
    if (t.length < 2) return;
    const next = [t, ...recent.filter((r) => r.toLowerCase() !== t.toLowerCase())].slice(0, 5);
    setRecent(next);
    saveRecent(next);
  }
  function closeSearch() { setFocus(false); setQuery(''); setQ(''); searchRef.current?.blur(); Keyboard.dismiss(); }
  const book = (c: BookCourt, d?: string, start?: number, dur?: number) => router.push({
    pathname: '/book/[courtId]',
    params: { courtId: c.id, sport: c.sport, ...(d ? { date: d } : {}), ...(d && start !== undefined && dur ? { start: String(start), dur: String(dur) } : {}) },
  });

  const refresh = () => { setRefreshing(true); load(); };
  const dates = Array.from({ length: DAYS }, (_, i) => cairoDate(i));
  const [calOpen, setCalOpen] = useState(false);
  // the days that fit the screen width, then the calendar button last, no scrolling; a day picked further out takes the last day's place
  const { width } = useWindowDimensions();
  const fit = Math.max(3, Math.floor((width - 32 + 8) / 64) - 1);
  const shownDays = dates.slice(0, fit);
  if (!shownDays.includes(date)) shownDays[fit - 1] = date;
  const asDate = (d: string) => new Date(`${d}T12:00:00`);
  const fromPicked = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  function openCalendar() {
    if (Platform.OS !== 'android') return setCalOpen(true);
    DateTimePickerAndroid.open({
      value: asDate(date), mode: 'date', minimumDate: asDate(cairoDate()), maximumDate: asDate(cairoDate(CAL_DAYS)),
      onChange: (e, d) => { if (e.type === 'set' && d) setDate(fromPicked(d)); },
    });
  }
  const searchOpen = focus || q.length > 0;
  const clubName = club ? courts.find((c) => c.branchId === club)?.branchName : '';
  const selectedCourts = selected ? list.filter((c) => c.branchId === selected) : [];

  if (loading) return <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top + 60 }}><Skeleton rows={4} /></View>;

  const header = (
    <View>
      <View style={s.top}>
        <Logo width={96} />
        <View style={{ flex: 1, flexDirection: 'row' }}>
          <Text style={s.brandTag}>Play. Compete. </Text>
          <GradientText style={[s.brandTag, { fontFamily: fonts.display }]}>Connect.</GradientText>
        </View>
        <ThemeToggle />
      </View>

      <View style={s.searchBox}>
        <Text style={{ color: colors.muted, fontSize: 16 }}>⌕</Text>
        <TextInput ref={searchRef} value={query} onChangeText={setQuery} onFocus={() => setFocus(true)}
          placeholder="Search courts, clubs, areas" placeholderTextColor={colors.muted} keyboardAppearance={scheme}
          autoCorrect={false} returnKeyType="search" style={s.searchInput} accessibilityLabel="Search courts, clubs, areas" />
        {searchOpen && <Pressable accessibilityRole="button" onPress={closeSearch} hitSlop={10} accessibilityLabel="Close search"><Text style={{ color: colors.muted, fontSize: 18 }}>✕</Text></Pressable>}
      </View>

      {searchOpen ? (
        <View style={{ marginTop: 10 }}>
          {!searching && (
            recent.length > 0 ? (
              <View style={s.panel}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={s.panelTitle}>Recent searches</Text>
                  <Pressable accessibilityRole="button" onPress={() => { setRecent([]); saveRecent([]); }}><Text style={{ color: colors.muted, fontSize: 12, textDecorationLine: 'underline' }}>Clear</Text></Pressable>
                </View>
                {recent.map((r) => <Pressable accessibilityRole="button" key={r} onPress={() => setQuery(r)} style={s.resultRow}><Text style={{ color: colors.text }}>🕘 {r}</Text></Pressable>)}
              </View>
            ) : <Text style={{ color: colors.muted }}>Type at least 2 letters, for example a club or an area.</Text>
          )}
          {results && (
            <View style={s.panel}>
              {nothing && <Text style={{ color: colors.muted }}>Nothing found for “{q}”. Try another word.</Text>}
              {results.sportHits.map((x) => (
                <Pressable accessibilityRole="button" key={x.slug} onPress={() => { remember(query); pickSport(x.slug); closeSearch(); }} style={s.resultRow}>
                  <Text style={{ color: colors.text, fontWeight: '700' }}>{x.emoji || '🏅'} {x.name}</Text><Text style={{ color: colors.muted, fontSize: 12 }}>Sport</Text>
                </Pressable>
              ))}
              {results.areaHits.map((a) => (
                <Pressable accessibilityRole="button" key={a.name} onPress={() => { remember(query); pickArea(a.name); closeSearch(); }} style={s.resultRow}>
                  <Text style={{ color: colors.text, fontWeight: '700' }}>📍 {a.name}</Text><Text style={{ color: colors.muted, fontSize: 12 }}>{a.n} court{a.n === 1 ? '' : 's'}</Text>
                </Pressable>
              ))}
              {results.clubs.map((x) => (
                <Pressable accessibilityRole="button" key={x.id} onPress={() => { remember(query); setArea(''); setClub(x.id); closeSearch(); }} style={s.resultRow}>
                  <Text style={{ color: colors.text, fontWeight: '700', flex: 1 }} numberOfLines={1}>🏟 {x.name}</Text><Text style={{ color: colors.muted, fontSize: 12 }}>{x.area} · {x.n} court{x.n === 1 ? '' : 's'}</Text>
                </Pressable>
              ))}
              {results.courtHits.map((c) => (
                <Pressable accessibilityRole="button" key={c.key} onPress={() => { remember(query || c.name); closeSearch(); book(c); }} style={s.resultRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontWeight: '700' }} numberOfLines={1}>{c.branchName} · {c.name}</Text>
                    <Text style={{ color: colors.muted, fontSize: 12 }} numberOfLines={1}>{sportOf(c.sport)?.name || c.sport} · {c.area} · {c.price} EGP/h</Text>
                  </View>
                  <NextFree c={c} />
                </Pressable>
              ))}
            </View>
          )}
        </View>
      ) : (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.row} keyboardShouldPersistTaps="handled">
            <Chip label="All sports" on={!sport} onPress={() => pickSport('')} />
            {/* only sports with courts to book */}
            {sports.filter((x) => countBySport.get(x.slug)?.size).map((x) => (
              <Chip key={x.slug} label={x.name} on={sport === x.slug} onPress={() => pickSport(x.slug)}
                icon={<View style={{ marginRight: 6 }}><SportIcon sport={x} size={18} /></View>} />
            ))}
          </ScrollView>
          {(areas.length > 1 || favs.length > 0) && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.row}>
              {favs.length > 0 && <Chip label="♥ Favourites" on={favOnly} onPress={() => setFavOnly((f) => !f)} />}
              {areas.length > 1 && <Chip label="All areas" on={!area} onPress={() => pickArea('')} />}
              {areas.length > 1 && areas.map((a) => <Chip key={a} label={a} on={area === a} onPress={() => pickArea(area === a ? '' : a)} />)}
            </ScrollView>
          )}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 10 }}>
            <View style={s.seg}>
              {(['list', 'map'] as const).map((v) => (
                <Pressable accessibilityRole="button" key={v} onPress={() => { setView(v); setSelected(null); }} style={[s.segBtn, view === v && s.chipOn]}>
                  {view === v && <GradientFill />}
                  <Text style={{ color: view === v ? '#fff' : colors.muted, fontWeight: '600' }}>{v === 'list' ? 'List' : 'Map'}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable accessibilityRole="button" onPress={nearMe} style={[s.segBtn, s.seg, loc && s.chipOn]} disabled={locBusy}>
              {loc && <GradientFill />}
              {locBusy ? <ActivityIndicator size="small" color={colors.muted} /> : <Text style={{ color: loc ? '#fff' : colors.muted, fontWeight: '600' }}>{loc ? '📍 Near me ✕' : '📍 Near me'}</Text>}
            </Pressable>
            {/* indoor / outdoor, always shown like the website; a kind with no court here is greyed out */}
            <View style={[s.seg, { marginLeft: 'auto' }]}>
              {([['', 'All'], ['indoor', 'Indoor'], ['outdoor', 'Outdoor']] as const).map(([p, l]) => {
                const none = p !== '' && !places.includes(p);
                return (
                  <Pressable accessibilityRole="button" key={l} disabled={none} accessibilityState={{ selected: place === p, disabled: none }}
                    onPress={() => pickPlace(place === p ? '' : p)} style={[s.segBtn, place === p && s.chipOn, none && { opacity: 0.35 }]}>
                    {place === p && <GradientFill />}
                    <Text style={{ color: place === p ? '#fff' : colors.muted, fontWeight: '600' }}>{l}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          {!!locMsg && <Text style={{ color: colors.warning, marginTop: 8 }}>{locMsg}</Text>}
          {!!clubName && (
            <View style={{ marginTop: 10, alignSelf: 'flex-start' }}><Chip label={`Only ${clubName} ✕`} on onPress={() => setClub('')} /></View>
          )}
          {err && <View style={{ marginTop: 10 }}><Note kind="error">{err}</Note></View>}
          <Text style={{ color: colors.muted, marginTop: 12, marginBottom: 8 }}>
            {list.length} court{list.length === 1 ? '' : 's'}{loc ? ` within ${NEAR_ME_KM} km, nearest first` : ', cheapest first'}{view === 'list' ? ` · free times ${dayWord(date).toLowerCase() === 'today' ? 'today' : `on ${dayWord(date)}`}` : ''}
          </Text>
        </>
      )}
    </View>
  );

  if (!searchOpen && view === 'map') {
    const first = pins[0];
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 16 }}>{header}</ScrollView>
        <MapView
          style={{ flex: 1 }}
          initialRegion={{ latitude: loc?.lat ?? first?.lat ?? 30.0444, longitude: loc?.lng ?? first?.lng ?? 31.2357, latitudeDelta: 0.35, longitudeDelta: 0.35 }}
          showsUserLocation={!!loc}
          onPress={() => setSelected(null)}
        >
          {pins.map((p) => (
            <Marker key={p.id} coordinate={{ latitude: p.lat, longitude: p.lng }} onPress={(e) => { e.stopPropagation(); setSelected(p.id); }}
              title={p.name} description={`${p.count} court${p.count === 1 ? '' : 's'} · from ${egp(p.price)}/h`} pinColor={selected === p.id ? colors.brandPink : colors.accent} />
          ))}
        </MapView>
        {selected && (
          <ScrollView style={s.mapSheet} contentContainerStyle={{ padding: 12, paddingBottom: 12 + insets.bottom }}>
            {selectedCourts.map((c) => (
              <CourtCardRow key={c.key} c={c} sport={sportOf(c.sport)} date={date} onOpen={() => book(c, date)} onTime={(d, st, du) => book(c, d, st, du)} fav={favs.includes(c.id)} onFav={() => flipFav(c.id)} />
            ))}
          </ScrollView>
        )}
      </View>
    );
  }

  return (
    <FlatList
      data={searchOpen ? [] : list}
      keyExtractor={(c) => c.key}
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 24 }}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.primary} onRefresh={refresh} />}
      ListHeaderComponent={header}
      initialNumToRender={8}
      renderItem={({ item }) => <CourtCardRow c={item} sport={sportOf(item.sport)} date={date} onOpen={() => book(item, date)} onTime={(d, st, du) => book(item, d, st, du)} fav={favs.includes(item.id)} onFav={() => flipFav(item.id)} />}
      ListEmptyComponent={searchOpen ? undefined : (
        <EmptyState icon="ball" title="No courts found" text={loc ? `No courts within ${NEAR_ME_KM} km. Turn off Near me or pick an area.` : 'No courts match. Try another sport or area.'} />
      )}
    />
  );
}

const useS = themed(() => StyleSheet.create({
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  top: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  brandTag: { color: colors.muted, fontStyle: 'italic', fontSize: 14, letterSpacing: 0.4 },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14 },
  searchInput: { flex: 1, color: colors.text, paddingVertical: 12, fontSize: 15 },
  panel: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: 12, gap: 2 },
  panelTitle: { color: colors.text, fontWeight: '700' },
  resultRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  row: { marginTop: 10, flexGrow: 0 },
  chip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.lg, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, marginRight: 8, overflow: 'hidden' },
  chipOn: { borderColor: 'transparent', overflow: 'hidden' },
  day: { width: 56, paddingVertical: 8, borderRadius: radius.md, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, marginRight: 8, alignItems: 'center', overflow: 'hidden' },
  seg: { flexDirection: 'row', borderRadius: 999, borderWidth: 1, borderColor: colors.border, padding: 2, overflow: 'hidden' },
  segBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: 12, marginBottom: 12 },
  thumb: { width: 72, height: 72, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.cardAlt },
  time: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.cardAlt },
  timeFree: { borderColor: colors.success, backgroundColor: 'rgba(46,211,160,0.08)' },
  mapSheet: { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '55%', backgroundColor: colors.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl },
  empty: { color: colors.muted, textAlign: 'center', marginTop: 40 },
}));
