import { useCallback, useEffect, useMemo, useState } from 'react';
import { Image, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { supabase } from '@/lib/supabase';
import { hm12 } from '@/lib/format';
import { useT } from '@/lib/ownerLang';
import { colors, radius } from '@/lib/theme';
import { Box, Chip, Chips, fmtEGP, H2, LinkButton, Loading, Muted, Pager, PAGE_SIZE, useOwner } from '@/components/owner';

type View_ = 'overview' | 'demand' | 'transfers';
type Group = 'day' | 'week' | 'month';

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };
const egp0 = (n: number | string) => `${Number(n).toLocaleString('en-EG', { maximumFractionDigits: 0 })} EGP`;

// the website's quick date ranges (DateRangePicker)
const RANGES: { label: string; get: () => [string, string] }[] = [
  { label: 'Today', get: () => [ymd(new Date()), ymd(new Date())] },
  { label: 'Yesterday', get: () => [ymd(daysAgo(1)), ymd(daysAgo(1))] },
  { label: 'Last 7 days', get: () => [ymd(daysAgo(6)), ymd(new Date())] },
  { label: 'Last 30 days', get: () => [ymd(daysAgo(29)), ymd(new Date())] },
  { label: 'This month', get: () => { const t = new Date(); return [ymd(new Date(t.getFullYear(), t.getMonth(), 1)), ymd(new Date(t.getFullYear(), t.getMonth() + 1, 0))]; } },
  { label: 'Last month', get: () => { const t = new Date(); return [ymd(new Date(t.getFullYear(), t.getMonth() - 1, 1)), ymd(new Date(t.getFullYear(), t.getMonth(), 0))]; } },
  { label: 'Last 3 months', get: () => [ymd(daysAgo(89)), ymd(new Date())] },
  { label: 'This year', get: () => { const t = new Date(); return [ymd(new Date(t.getFullYear(), 0, 1)), ymd(new Date(t.getFullYear(), 11, 31))]; } },
];

function defaultGroup(from: string, to: string): Group {
  const days = (new Date(to).getTime() - new Date(from).getTime()) / 86400000;
  return days > 180 ? 'month' : days > 45 ? 'week' : 'day';
}
const hourText = (h: number) => (h === 24 ? 'Midnight' : hm12(`${String(h % 24).padStart(2, '0')}:00`));

// Owner → Money, like the website: bookings and money (Overview), busy hours (Demand) and what Zaf Play sent
// (Transfers). One date range on top sets Overview and Demand; Demand also takes a time of day.
export default function OwnerMoney() {
  const { access } = useOwner();
  const { t, tm } = useT();
  const finances = !!access.view_finances;
  const bookings = !!access.view_bookings;
  const views: { id: View_; label: string }[] = [
    ...(finances ? [{ id: 'overview' as View_, label: 'Overview' }] : []),
    ...(bookings ? [{ id: 'demand' as View_, label: 'Demand' }] : []),
    ...(finances ? [{ id: 'transfers' as View_, label: 'Transfers' }] : []),
  ];
  const [view, setView] = useState<View_>(views[0]?.id || 'demand');
  const [rangeLabel, setRangeLabel] = useState('Last 30 days');
  const [[from, to], setRange] = useState<[string, string]>(() => RANGES[3].get());
  const [fromHour, setFromHour] = useState(0);
  const [toHour, setToHour] = useState(24);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
      <Chips>{views.map((v) => <Chip key={v.id} label={t(v.label)} on={view === v.id} onPress={() => setView(v.id)} />)}</Chips>
      {view !== 'transfers' && (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }}>
            {RANGES.map((r) => <Chip key={r.label} label={t(r.label)} on={rangeLabel === r.label} onPress={() => { setRangeLabel(r.label); setRange(r.get()); }} />)}
          </ScrollView>
          <Muted style={{ marginBottom: 10 }}>{from} → {to}</Muted>
          {view === 'demand' && (
            <>
              <Muted>{t('From')}</Muted>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {Array.from({ length: 24 }, (_, h) => h).map((h) => <Chip key={h} label={tm(hourText(h))} on={fromHour === h} onPress={() => setFromHour(h)} />)}
              </ScrollView>
              <Muted>{t('To')}</Muted>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
                {Array.from({ length: 24 }, (_, i) => i + 1).map((h) => <Chip key={h} label={tm(hourText(h))} on={toHour === h} onPress={() => setToHour(h)} />)}
              </ScrollView>
            </>
          )}
        </>
      )}
      {view === 'overview' && finances && <Revenue from={from} to={to} />}
      {view === 'demand' && bookings && <Demand from={from} to={to} fromHour={fromHour} toHour={toHour} />}
      {view === 'transfers' && finances && <Earnings showTransfers={!!access.see_transfers} />}
    </ScrollView>
  );
}

function Tile({ label, value, sub, strong }: { label: string; value: string; sub?: string; strong?: boolean }) {
  return (
    <View style={{ width: '50%', padding: 4 }}>
      <View style={{ borderWidth: 1, borderColor: strong ? colors.success : colors.border, borderRadius: radius.lg, padding: 12, backgroundColor: colors.card }}>
        <Text style={{ color: strong ? colors.success : colors.muted, fontSize: 12 }}>{label}</Text>
        <Text style={{ color: colors.text, fontSize: 18, fontWeight: '800', marginTop: 2 }}>{value}</Text>
        {!!sub && <Muted style={{ fontSize: 11 }}>{sub}</Muted>}
      </View>
    </View>
  );
}

function Revenue({ from, to }: { from: string; to: string }) {
  const { t, locale } = useT();
  const group = defaultGroup(from, to);
  const unit = group;
  const [sportId, setSportId] = useState('');
  const [facilityId, setFacilityId] = useState('');
  const [courtId, setCourtId] = useState('');
  const [splitBy, setSplitBy] = useState('court');
  const [sports, setSports] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [rows, setRows] = useState<any[] | null>(null);
  const [breakdown, setBreakdown] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    supabase.from('sports').select('id, name').order('name').then(({ data }) => setSports(data || []));
    supabase.from('facilities').select('id, name, courts ( id, name )').order('name').then(({ data }) => setBranches(data || []));
  }, []);

  useEffect(() => {
    (async () => {
      const common = { p_from: from, p_to: to, p_sport_id: sportId || null, p_facility_id: facilityId || null, p_court_id: courtId || null };
      const [series, split] = await Promise.all([
        supabase.rpc('owner_revenue', { ...common, p_group: group }),
        supabase.rpc('owner_revenue_breakdown', { ...common, p_by: splitBy }),
      ]);
      if (series.error || split.error) return setError((series.error || split.error)!.message);
      setError('');
      setRows((series.data as any[]) || []);
      setBreakdown((split.data as any[]) || []);
    })();
  }, [from, to, group, sportId, facilityId, courtId, splitBy]);

  const totals = useMemo(() => {
    const x = { bookings: 0, gross: 0, zaf: 0, owner: 0 };
    for (const r of rows || []) {
      x.bookings += Number(r.bookings);
      x.gross += Number(r.gross);
      x.zaf += Number(r.commission);
      x.owner += Number(r.owner_net);
    }
    return x;
  }, [rows]);

  const courtOptions = facilityId
    ? (branches.find((b) => b.id === facilityId)?.courts || []).map((c: any) => ({ id: c.id, label: c.name }))
    : branches.flatMap((b) => (b.courts || []).map((c: any) => ({ id: c.id, label: `${c.name} · ${b.name}` })));
  const maxSplit = Math.max(...breakdown.map((b) => Number(b.gross)), 1);
  const periodLabel = (iso: string) => {
    const d = new Date(`${iso}T12:00:00`);
    if (group === 'month') return d.toLocaleDateString(locale, { month: 'short', year: 'numeric' });
    if (group === 'week') return t('Week of ') + d.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
    return d.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  };
  const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

  if (rows === null) return error ? <Muted>{error}</Muted> : <Loading />;
  return (
    <View>
      {branches.length > 1 && (
        <>
          <Muted>{t('Branch')}</Muted>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <Chip label={t('All branches')} on={!facilityId} onPress={() => { setFacilityId(''); setCourtId(''); }} />
            {branches.map((b) => <Chip key={b.id} label={b.name} on={facilityId === b.id} onPress={() => { setFacilityId(b.id); setCourtId(''); }} />)}
          </ScrollView>
        </>
      )}
      {courtOptions.length > 1 && (
        <>
          <Muted>{t('Court')}</Muted>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <Chip label={t('All courts')} on={!courtId} onPress={() => setCourtId('')} />
            {courtOptions.map((c: any) => <Chip key={c.id} label={c.label} on={courtId === c.id} onPress={() => setCourtId(c.id)} />)}
          </ScrollView>
        </>
      )}
      <Muted>{t('Sport')}</Muted>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 6 }}>
        <Chip label={t('All sports')} on={!sportId} onPress={() => setSportId('')} />
        {sports.map((s) => <Chip key={s.id} label={s.name} on={sportId === s.id} onPress={() => setSportId(s.id)} />)}
      </ScrollView>
      <Muted style={{ marginBottom: 10 }}>{t('Counts paid bookings that have been played (and fees kept from late cancellations), Cairo time. Upcoming bookings are added once played.')}</Muted>
      {!!error && <Text style={{ color: colors.danger, marginBottom: 8 }}>{error}</Text>}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4, marginBottom: 12 }}>
        <Tile label={t('Bookings through Zaf Play')} value={String(totals.bookings)} sub={t(`{n} per ${unit}`, { n: rows.length ? (totals.bookings / rows.length).toFixed(1) : 0 })} />
        <Tile label={t('Total booked')} value={egp0(totals.gross)} />
        <Tile label={t('Zaf Play commission')} value={egp0(totals.zaf)} />
        <Tile label={t('Your earnings')} value={egp0(totals.owner)} strong />
      </View>

      <Box>
        <Text style={{ color: colors.text, fontWeight: '800', marginBottom: 8 }}>{t('Split by')}</Text>
        <Chips>{['court', 'sport', 'branch'].map((b) => <Chip key={b} label={t(cap(b))} on={splitBy === b} onPress={() => setSplitBy(b)} />)}</Chips>
        {breakdown.length === 0 ? <Muted>{t('No bookings for these filters.')}</Muted> : breakdown.map((b) => (
          <View key={b.key} style={{ paddingVertical: 8, borderTopWidth: 1, borderColor: colors.border }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ color: colors.text, fontWeight: '700', flex: 1 }}>{b.label}</Text>
              <Text style={{ color: colors.text }}>{egp0(b.gross)}</Text>
            </View>
            <Muted style={{ fontSize: 12 }}>{t('Bookings')}: {b.bookings} · {t('Your earnings')}: {egp0(b.owner_net)}</Muted>
            <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.brandBlue, width: `${(Number(b.gross) / maxSplit) * 100}%`, marginTop: 4 }} />
          </View>
        ))}
      </Box>

      <LinkButton title={t(showTable ? `Hide the numbers per ${unit}` : `Show the numbers per ${unit}`)} onPress={() => setShowTable(!showTable)} />
      {showTable && [...rows].reverse().map((r) => (
        <View key={r.period} style={{ paddingVertical: 8, borderBottomWidth: 1, borderColor: colors.border }}>
          <Text style={{ color: colors.text, fontWeight: '700' }}>{periodLabel(r.period)}</Text>
          <Muted style={{ fontSize: 12 }}>
            {t('Bookings')}: {r.bookings} · {t('Money')}: {egp0(r.gross)} · {t('Commission')}: {egp0(r.commission)} · {t('Your earnings')}: {egp0(r.owner_net)}
          </Muted>
        </View>
      ))}
    </View>
  );
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const pct = (booked: number, avail: number) => (avail > 0 ? Math.round((booked / avail) * 100) : null);

// which hours are busiest and quietest, how full the courts are, and what people were waiting for
function Demand({ from, to, fromHour, toHour }: { from: string; to: string; fromHour: number; toHour: number }) {
  const { t, tm, lang } = useT();
  const [report, setReport] = useState<any>(null);
  const [error, setError] = useState('');
  const hour = (h: number) => tm(hm12(`${String(h % 24).padStart(2, '0')}:00`));

  useEffect(() => {
    supabase.rpc('owner_demand_range', { p_from: from, p_to: to, p_from_hour: fromHour, p_to_hour: toHour }).then(({ data, error: e }) => {
      if (e) setError(e.message);
      else { setError(''); setReport(data); }
    });
  }, [from, to, fromHour, toHour]);

  if (!report) return error ? <Muted>{error}</Muted> : <Loading />;
  const sep = lang === 'ar' ? '، ' : ', ';
  const hours = (report.by_hour || []).filter((h: any) => h.avail_hours > 0);
  const occupancy = pct(Number(report.totals.booked_hours), Number(report.totals.avail_hours));
  const ranked = [...hours].map((h: any) => ({ ...h, occ: pct(Number(h.booked_hours), Number(h.avail_hours)) ?? 0 })).sort((a, b) => b.occ - a.occ || b.bookings - a.bookings);
  const busiest = ranked.filter((h) => h.bookings > 0).slice(0, 3);
  const quietest = [...ranked].reverse().filter((h) => !busiest.some((b) => b.hour === h.hour)).slice(0, 3);
  const topWait = [...(report.by_hour || [])].filter((h: any) => h.waitlist > 0).sort((a: any, b: any) => b.waitlist - a.waitlist)[0];
  const topDay = [...(report.by_weekday || [])].sort((a: any, b: any) => b.bookings - a.bookings)[0];
  const slowDay = [...(report.by_weekday || [])].sort((a: any, b: any) => a.bookings - b.bookings)[0];
  const line = { color: colors.text, fontSize: 13, lineHeight: 19, marginBottom: 6 };

  return (
    <View>
      {!!error && <Text style={{ color: colors.danger }}>{error}</Text>}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4, marginBottom: 12 }}>
        <Tile label={t('Bookings played')} value={String(report.totals.bookings)} />
        <Tile label={t('Hours booked')} value={String(Number(report.totals.booked_hours))} />
        <Tile label={t('How full your courts were')} value={occupancy === null ? '—' : `${occupancy}%`} sub={t('of {n} opening hours', { n: Number(report.totals.avail_hours) })} />
        <Tile label={t('Asked to be told when a full time frees up')} value={String(report.totals.waitlist)} />
      </View>
      {report.totals.bookings === 0 && report.totals.waitlist === 0 ? (
        <Muted>{t('No bookings in this period yet. Pick a longer period or check back soon.')}</Muted>
      ) : (
        <>
          <Box>
            <Text style={{ color: colors.text, fontWeight: '800', marginBottom: 8 }}>{t('What stands out')}</Text>
            {busiest.length > 0 && <Text style={line}>🔥 <Text style={{ fontWeight: '800' }}>{t('Busiest hours:')}</Text> {busiest.map((h) => `${hour(h.hour)} (${t('{n}% full', { n: h.occ })})`).join(sep)}</Text>}
            {quietest.length > 0 && (
              <Text style={line}>🌙 <Text style={{ fontWeight: '800' }}>{t('Quietest hours:')}</Text> {quietest.map((h) => `${hour(h.hour)} (${t('{n}% full', { n: h.occ })})`).join(sep)}
                <Text style={{ color: colors.muted }}> — {t('free space you could fill with a promotion or a tournament.')}</Text>
              </Text>
            )}
            {topWait && (
              <Text style={line}>🔔 <Text style={{ fontWeight: '800' }}>{t('In demand:')}</Text>{' '}
                {t(topWait.waitlist === 1 ? '{n} request to be told when {time} frees up.' : '{n} requests to be told when {time} frees up.', { n: topWait.waitlist, time: hour(topWait.hour) })}{' '}
                {t('People wanted these times and they were full.')}
              </Text>
            )}
            {topDay && topDay.bookings > 0 && (
              <Text style={line}>📅 <Text style={{ fontWeight: '800' }}>{t('Best day:')}</Text> {t(WEEKDAYS[topDay.dow])} ({t('{n} bookings', { n: topDay.bookings })})
                {slowDay && slowDay.dow !== topDay.dow ? <Text style={{ color: colors.muted }}> · {t('slowest:')} {t(WEEKDAYS[slowDay.dow])} ({slowDay.bookings})</Text> : null}
              </Text>
            )}
          </Box>
          <Box>
            <Text style={{ color: colors.text, fontWeight: '800' }}>{t('Hour by hour')}</Text>
            <Muted style={{ marginBottom: 8 }}>{t('How much of each opening hour was booked. A 🔔 means people were waiting for that hour.')}</Muted>
            {hours.map((h: any) => {
              const p = pct(Number(h.booked_hours), Number(h.avail_hours)) ?? 0;
              return (
                <View key={h.hour} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                  <Text style={{ width: 66, color: colors.muted, fontSize: 12 }}>{hour(h.hour)}</Text>
                  <View style={{ flex: 1, height: 12, borderRadius: 4, backgroundColor: colors.cardAlt, overflow: 'hidden' }}>
                    <View style={{ height: '100%', width: `${Math.min(p, 100)}%`, backgroundColor: colors.brandPurple }} />
                  </View>
                  <Text style={{ width: 80, color: colors.text, fontSize: 12, textAlign: 'right' }}>{p}% · {h.bookings}{h.waitlist > 0 ? ` 🔔${h.waitlist}` : ''}</Text>
                </View>
              );
            })}
          </Box>
          {(report.by_court || []).map((c: any) => {
            const p = pct(Number(c.booked_hours), Number(c.avail_hours));
            return (
              <Box key={c.court_id}>
                <Text style={{ color: colors.text, fontWeight: '800' }}>{c.name}</Text>
                <Muted>{c.facility}</Muted>
                <Text style={{ color: colors.text, fontSize: 13, marginTop: 4 }}>
                  {t('Bookings')}: {c.bookings} · {t('Hours booked')}: {Number(c.booked_hours)} · {t('Full')}: {p === null ? '—' : `${p}%`} · {t('Waiting')} 🔔 {c.waitlist}
                </Text>
              </Box>
            );
          })}
        </>
      )}
    </View>
  );
}

const PAYOUT_FIELDS =
  'id, payout_date, bookings_count, total_owed_to_owner, transfer_fee, amount_sent, instapay_link, branches, payment_method, bank_reference, admin_notes, proof_paths, paid_at, seen_by_owner_at, direction, status, deductions, reject_reason, created_at';

const WEEKLY_PAYOUT_DAY = 'Thursday';
const shortDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
function nextThursday(today: string) {
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + ((4 - d.getUTCDay() + 7) % 7));
  return d.toISOString().slice(0, 10);
}

// daily earnings and every transfer, like the website's Money → Transfers
function Earnings({ showTransfers }: { showTransfers: boolean }) {
  const { t, locale } = useT();
  const [dailyUntil, setDailyUntil] = useState<string | null | undefined>(undefined);
  const [balance, setBalance] = useState<any[]>([]);
  const [summary, setSummary] = useState<any[] | null>(null);
  const [summaryPage, setSummaryPage] = useState(1);
  const [summaryTotal, setSummaryTotal] = useState(0);
  const [totalPending, setTotalPending] = useState(0);
  const [payouts, setPayouts] = useState<any[]>([]);
  const [payoutPage, setPayoutPage] = useState(1);
  const [payoutTotal, setPayoutTotal] = useState(0);
  const day = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(locale, { timeZone: 'Africa/Cairo', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

  useEffect(() => {
    supabase.rpc('owner_payout_schedule').then(({ data, error }) => setDailyUntil(error ? null : ((data as any[] | null)?.[0]?.daily_until ?? null)));
    if (showTransfers) supabase.rpc('owner_balance').then(({ data }) => setBalance((data as any[]) || []));
  }, []);

  const loadSummary = useCallback(async () => {
    const { data } = await supabase.rpc('owner_daily_summary_page', { p_limit: PAGE_SIZE, p_offset: (summaryPage - 1) * PAGE_SIZE });
    const rows = (data as any[]) || [];
    setSummary(rows);
    if (rows.length > 0) {
      setSummaryTotal(Number(rows[0].total_days));
      // money owed back to Zaf Play is taken out of what is sent; an account in minus gets nothing sent
      let adjust = 0;
      const { data: bal } = await supabase.rpc('owner_balance');
      for (const g of (bal as any[]) || []) adjust += g.kind === 'pay_owner' ? Number(g.deductions || 0) : Number(g.earnings || 0);
      setTotalPending(Math.max(0, Number(rows[0].total_pending) - adjust));
    } else if (summaryPage === 1) {
      setSummaryTotal(0);
      setTotalPending(0);
    }
  }, [summaryPage]);
  useEffect(() => { loadSummary(); }, [loadSummary]);

  useEffect(() => {
    if (!showTransfers) return;
    const from = (payoutPage - 1) * PAGE_SIZE;
    supabase.from('payouts').select(PAYOUT_FIELDS, { count: 'exact' }).order('created_at', { ascending: false }).range(from, from + PAGE_SIZE - 1)
      .then(({ data, count }) => { setPayouts((data as any[]) || []); setPayoutTotal(count || 0); });
  }, [payoutPage, showTransfers]);

  const strong = (x: string) => <Text style={{ fontWeight: '800' }}>{x}</Text>;
  const every = t('every {day} by 11:59 PM', { day: t(WEEKLY_PAYOUT_DAY) });
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
  const minus = balance.filter((g) => Number(g.net) < 0);
  const coming = balance.filter((g) => g.kind === 'pay_owner').reduce((a, g) => a + Number(g.net), 0);

  return (
    <View>
      {dailyUntil !== undefined && (
        <Box>
          <Text style={{ color: colors.text, fontWeight: '800', marginBottom: 4 }}>{t('When you get paid')}</Text>
          <Text style={{ color: colors.text, fontSize: 13, lineHeight: 19 }}>
            {!dailyUntil ? (
              <>{t('For the first month after your first court is approved, Zaf Play pays you')} {strong(t('every day'))}. {t('After that,')} {strong(every)} {t('(Cairo time).')}</>
            ) : today < dailyUntil ? (
              <>{t('Your first month: Zaf Play pays you')} {strong(t('every day'))} {t('for the games played that day, until {day}. After that, you are paid', { day: shortDay(dailyUntil) })} {strong(every)} {t('(Cairo time).')}</>
            ) : (
              <>{t('Zaf Play pays you')} {strong(every)} {t('(Cairo time) for all played games not paid yet.')} {t('Next payout: {day}.', { day: shortDay(nextThursday(today)) })}</>
            )}
          </Text>
        </Box>
      )}

      {showTransfers && coming > 0 && (
        <Box tone="ok"><Text style={{ color: colors.text }}>{strong(fmtEGP(coming))} {t("is on its way to you (after Zaf Play's transfers for games already played).")}</Text></Box>
      )}
      {showTransfers && minus.map((g) => (
        <Box key={g.instapay_key} tone="warn">
          <Text style={{ color: colors.noteText, fontWeight: '800' }}>{t('Your balance is {amount}', { amount: fmtEGP(g.net) })}</Text>
          <Text style={{ color: colors.noteText, fontSize: 13 }}>{t('Earnings not paid out yet {a} − deductions {b}', { a: fmtEGP(g.earnings), b: fmtEGP(g.deductions) })}</Text>
          {(g.deduction_items || []).map((d: any) => (
            <Text key={d.id} style={{ color: colors.noteText, fontSize: 12 }}>
              • {day(d.day)} · {d.branch}: {d.reason} — {Number(d.amount) < 0 ? `+ ${fmtEGP(-Number(d.amount))}` : fmtEGP(d.amount)}
            </Text>
          ))}
          <Text style={{ color: colors.noteText, fontSize: 13, marginTop: 6 }}>{t("You don't need to pay anything. This is taken from your next payouts from Zaf Play automatically.")}</Text>
        </Box>
      ))}

      <H2>{t('Daily earnings')}</H2>
      {totalPending > 0 && <View style={{ marginBottom: 6 }}><Text style={{ color: colors.warning, fontWeight: '700' }}>{t('Waiting for transfer:')} {fmtEGP(totalPending)}</Text></View>}
      <Muted style={{ marginBottom: 10 }}>
        {t("Each payout is one InstaPay transfer for each InstaPay account (branches with the same InstaPay are paid together). InstaPay's transfer fee (0.1%, min 0.50 EGP, max 20 EGP per transfer) is taken from the amount —")}{' '}
        <Text style={{ fontWeight: '800' }}>{t('“You receive” is exactly what arrives in your account.')}</Text>
      </Muted>
      {summary === null ? <Loading /> : summaryTotal === 0 ? (
        <Muted style={{ marginBottom: 16 }}>{t('No paid bookings played yet. Earnings appear here after each booking is played.')}</Muted>
      ) : (
        <>
          {summary.map((d) => {
            const pending = Number(d.pending_amount);
            const settled = Number(d.settled_amount);
            return (
              <Box key={d.day}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: colors.text, fontWeight: '800' }}>{day(d.day)}</Text>
                  <Text style={{ color: pending === 0 ? colors.success : colors.warning, fontSize: 12, fontWeight: '700' }}>
                    {pending === 0 ? `✓ ${t('Settled')}` : settled > 0 ? t('Partly settled — {amount} pending', { amount: fmtEGP(pending) }) : t('Pending transfer')}
                  </Text>
                </View>
                <Muted style={{ fontSize: 12, marginTop: 4 }}>
                  {t('Bookings')}: {d.bookings_count} · {t('Total booked')}: {fmtEGP(d.total_amount)} · {t('Commission')}: {fmtEGP(d.total_commission)}
                </Muted>
                <Muted style={{ fontSize: 12 }}>
                  {t('Your earnings')}: {fmtEGP(d.total_owed)} · {t('InstaPay fee')}: − {fmtEGP(d.transfer_fee)}
                  {Number(d.transfers_count) > 1 ? ` (${t('{n} transfers', { n: d.transfers_count })})` : ''}
                </Muted>
                <Text style={{ color: colors.text, fontWeight: '800', marginTop: 4 }}>{t('You receive')}: {fmtEGP(d.to_receive)}</Text>
              </Box>
            );
          })}
          <Pager page={summaryPage} total={summaryTotal} onChange={setSummaryPage} />
        </>
      )}

      <H2>{t('Transfers (in & out)')}</H2>
      {!showTransfers ? (
        <Muted>{t('Zaf Play sends one transfer for all branches together, so transfers are only shown to the owner and to finance staff with access to all branches.')}</Muted>
      ) : payoutTotal === 0 ? <Muted>{t('No transfers yet.')}</Muted> : (
        <>
          {payouts.map((p) => (
            <Box key={p.id}>
              {p.direction === 'to_zaf' ? (
                <Text style={{ color: colors.text, fontWeight: '800' }}>
                  ⬅ {t('You paid Zaf Play {amount}', { amount: fmtEGP(p.amount_sent) })}{'  '}
                  <Text style={{ color: p.status === 'paid' ? colors.success : p.status === 'pending' ? colors.warning : colors.danger, fontSize: 12 }}>
                    {p.status === 'paid' ? t('Confirmed') : p.status === 'pending' ? t('Waiting for Zaf Play') : t('Not accepted')}
                  </Text>
                </Text>
              ) : (
                <Text style={{ color: colors.text, fontWeight: '800' }}>➡ {t('{amount} received', { amount: fmtEGP(p.amount_sent ?? p.total_owed_to_owner) })}</Text>
              )}
              {p.status === 'on_hold' && !!p.reject_reason && <Text style={{ color: colors.danger, fontSize: 12 }}>{t('Reason:')} {p.reject_reason} — {t('please send it again.')}</Text>}
              {Number(p.deductions) > 0 && <Text style={{ color: colors.danger, fontSize: 12 }}>{t('Includes deductions of {amount}', { amount: fmtEGP(p.deductions) })}</Text>}
              {p.direction !== 'to_zaf' && Number(p.transfer_fee) > 0 && (
                <Muted style={{ fontSize: 12 }}>{t('Your earnings')} {fmtEGP(p.total_owed_to_owner)} − {t('InstaPay fee')} {fmtEGP(p.transfer_fee)}</Muted>
              )}
              {!!p.instapay_link && <Muted style={{ fontSize: 12 }}>{t('To')} {p.instapay_link}</Muted>}
              {(p.branches || []).length > 0 && <Muted style={{ fontSize: 12 }}>{(p.branches || []).map((b: any) => `${b.name}: ${fmtEGP(b.owed)}`).join(' · ')}</Muted>}
              <Muted style={{ fontSize: 12 }}>
                {p.direction === 'to_zaf' ? t('Paid on') : t('For')} {day(p.payout_date)} · {t('{n} booking(s)', { n: p.bookings_count })} · {t('via')} {p.payment_method}
                {p.bank_reference ? ` · ${t('Ref')} ${p.bank_reference}` : ''}
              </Muted>
              <Muted style={{ fontSize: 12 }}>
                {t('Sent')} {new Date(p.paid_at || p.created_at).toLocaleString(locale, { timeZone: 'Africa/Cairo', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).replace(/am|pm/, (x) => x.toUpperCase())}
              </Muted>
              {!!p.admin_notes && <Text style={{ color: colors.text, fontSize: 13, marginTop: 4 }}>{t('Note from Zaf Play:')} {p.admin_notes}</Text>}
              <PayoutDetails payoutId={p.id} />
              <ProofGallery paths={p.proof_paths || []} />
            </Box>
          ))}
          <Pager page={payoutPage} total={payoutTotal} onChange={setPayoutPage} />
        </>
      )}
    </View>
  );
}

// "Show the bookings in this transfer"
function PayoutDetails({ payoutId }: { payoutId: string }) {
  const { t, locale } = useT();
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ bookings: any[]; deductions: any[] } | null>(null);
  const [error, setError] = useState('');

  async function toggle() {
    if (open) return setOpen(false);
    setOpen(true);
    if (data) return;
    const { data: d, error: e } = await supabase.rpc('payout_details', { p_payout_id: payoutId });
    if (e) setError(e.message);
    else setData({ bookings: (d as any)?.bookings || [], deductions: (d as any)?.deductions || [] });
  }

  const when = (s: string, e: string) => {
    const o = { timeZone: 'Africa/Cairo', hour: 'numeric', minute: '2-digit', hour12: true } as const;
    return `${new Date(s).toLocaleString(locale, { ...o, weekday: 'short', day: 'numeric', month: 'short' })}–${new Date(e).toLocaleTimeString(locale, o)}`.replace(/am|pm/g, (x) => x.toUpperCase());
  };
  const shown = (data?.bookings || []).slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const net = (data?.bookings || []).reduce((a, b) => a + Number(b.owner_net), 0) - (data?.deductions || []).reduce((a, d) => a + Number(d.amount), 0);

  return (
    <View style={{ marginTop: 6 }}>
      <LinkButton title={open ? t('Hide the bookings') : t('Show the bookings in this transfer')} onPress={toggle} />
      {open && (
        <View style={{ marginTop: 6 }}>
          {!!error && <Text style={{ color: colors.danger }}>{error}</Text>}
          {!data && !error && <Muted>{t('Loading...')}</Muted>}
          {data && (
            <>
              {shown.map((b) => (
                <View key={b.id} style={{ paddingVertical: 6, borderTopWidth: 1, borderColor: colors.border }}>
                  <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>{when(b.start_time, b.end_time)}</Text>
                  <Muted style={{ fontSize: 12 }}>{b.court} · {b.sport} · {b.branch}{b.player ? ` · ${b.player}` : ''}</Muted>
                  {b.status === 'cancelled' && <Text style={{ color: colors.warning, fontSize: 12 }}>{t('late cancellation fee')}</Text>}
                  <Muted style={{ fontSize: 12 }}>{t('Paid')} {fmtEGP(b.price)} · Zaf Play − {fmtEGP(b.commission)} ({Number(b.commission_rate)}%) · {t('You get')} {fmtEGP(b.owner_net)}</Muted>
                </View>
              ))}
              {data.deductions.map((d, i) => (
                <View key={`d${i}`} style={{ paddingVertical: 6, borderTopWidth: 1, borderColor: colors.border }}>
                  <Text style={{ color: Number(d.amount) < 0 ? colors.success : colors.danger, fontSize: 13, fontWeight: '700' }}>
                    {Number(d.amount) < 0 ? t('Tournament share') : t('Deduction')} · {d.branch}: {Number(d.amount) < 0 ? `+ ${fmtEGP(-Number(d.amount))}` : `− ${fmtEGP(d.amount)}`}
                  </Text>
                  <Muted style={{ fontSize: 12 }}>{d.reason}</Muted>
                </View>
              ))}
              <Text style={{ color: colors.text, fontWeight: '800', marginTop: 6 }}>
                {t('{n} booking(s)', { n: data.bookings.length })}{data.deductions.length > 0 ? ` · ${t('{n} deduction(s)', { n: data.deductions.length })}` : ''} · {fmtEGP(net)}
              </Text>
              <Pager page={page} total={data.bookings.length} onChange={setPage} />
            </>
          )}
        </View>
      )}
    </View>
  );
}

// the transfer receipts Zaf Play uploaded (private files, opened with a short-lived link)
function ProofGallery({ paths }: { paths: string[] }) {
  const [items, setItems] = useState<{ url: string; isPdf: boolean }[] | null>(null);
  const [error, setError] = useState('');
  if (!paths.length) return null;

  async function toggle() {
    if (items) return setItems(null);
    const { data, error: e } = await supabase.storage.from('payout-proofs').createSignedUrls(paths, 3600);
    if (e) return setError('Could not load the proof files.');
    setItems((data || []).filter((d) => d.signedUrl).map((d) => ({ url: d.signedUrl as string, isPdf: (d.path || '').toLowerCase().endsWith('.pdf') })));
  }

  return (
    <View style={{ marginTop: 4 }}>
      <LinkButton title={items ? 'Hide proof' : `View transfer proof (${paths.length})`} onPress={toggle} />
      {!!error && <Text style={{ color: colors.danger, fontSize: 12 }}>{error}</Text>}
      {items && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
          {items.map((it, i) => (
            <Pressable key={i} onPress={() => Linking.openURL(it.url)}>
              {it.isPdf
                ? <View style={{ width: 90, height: 120, borderRadius: 8, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: colors.text }}>📄 PDF {i + 1}</Text></View>
                : <Image source={{ uri: it.url }} style={{ width: 90, height: 120, borderRadius: 8 }} />}
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}
