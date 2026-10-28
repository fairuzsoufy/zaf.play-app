import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { branchScope } from '@/lib/access';
import { addDays, cairoDate, cairoToDate, timeLabel } from '@/lib/format';
import { useT } from '@/lib/ownerLang';
import { colors, radius } from '@/lib/theme';
import { Chip, Chips, fmtEGP, frozenOf, Muted, Sheet, useOwner } from '@/components/owner';
import { Button, Field, Note } from '@/components/ui';

const SLOT = 30;
const ROW = 30;
const COL = 120;

type Court = {
  id: string;
  name: string;
  facility: { id: string; name: string } | null;
  court_sports: { sport_id: string; price_per_hour: number; sport: { name: string } | null }[];
  availability_rules: { day_of_week: number; open_time: string; close_time: string; is_closed: boolean }[];
};
type Row = {
  id: string; court_id: string; start_time: string; end_time: string; status: string; payment_status: string; booking_source: string;
  hold_expires_at: string | null; total_price: number; player_name: string | null; player_phone: string | null;
  walk_in_name: string | null; walk_in_phone: string | null; walk_in_paid: boolean; walk_in_note: string | null;
  sport_id: string | null; sport: { name: string } | null;
};
type Draft = {
  id?: string; block?: boolean; courtId: string; start: number; length: number; sportId: string;
  name: string; phone: string; price: string; priceTouched: boolean; paid: boolean; note: string;
};

const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
};
const hmText = (m: number) => {
  const h = Math.floor(m / 60) % 24;
  return `${h % 12 || 12}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

// The owner's day, like the website's dashboard Calendar: every court side by side, half hour by half hour,
// with player bookings, walk-ins and blocks. Tap a free time to add a walk-in or phone booking (no Zaf Play
// commission) or to block it; tap a walk-in to change or cancel it.
export default function OwnerCalendar() {
  const { access } = useOwner();
  const { t, tm, locale } = useT();
  const canManage = !!access.manage_bookings && !frozenOf(access);
  const scope = branchScope(access);
  const [date, setDate] = useState(cairoDate());
  const [courts, setCourts] = useState<Court[]>([]);
  const [branch, setBranch] = useState('');
  const [court, setCourt] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [info, setInfo] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [now, setNow] = useState(Date.now());
  const hm = (m: number) => tm(hmText(m));
  const len = (m: number) => (m < 60 ? t('{n} min', { n: m }) : t('{n} h', { n: String(m / 60).replace('.5', '½') }));

  useEffect(() => {
    supabase
      .from('courts')
      .select('id, name, facility:facilities!inner ( id, name, owner_id ), court_sports ( sport_id, price_per_hour, sport:sports ( name ) ), availability_rules ( day_of_week, open_time, close_time, is_closed )')
      .eq('is_active', true)
      .eq('facility.owner_id', access.owner_id || '')
      .order('name')
      .then(({ data }) => setCourts(((data as unknown as Court[]) || []).filter((c) => !scope || scope.includes(c.facility?.id || ''))));
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);

  const branches = useMemo(() => {
    const m = new Map<string, string>();
    courts.forEach((c) => c.facility && m.set(c.facility.id, c.facility.name));
    return [...m.entries()];
  }, [courts]);
  const shown = courts.filter((c) => (!branch || c.facility?.id === branch) && (!court || c.id === court));

  const load = useCallback(async () => {
    if (courts.length === 0) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data } = await supabase
      .from('bookings')
      .select('id, court_id, start_time, end_time, status, payment_status, booking_source, hold_expires_at, total_price, player_name, player_phone, walk_in_name, walk_in_phone, walk_in_paid, walk_in_note, sport_id, sport:sports ( name )')
      .in('court_id', courts.map((c) => c.id))
      .in('status', ['pending', 'confirmed', 'completed'])
      .lt('start_time', cairoToDate(date, 24 * 60).toISOString())
      .gt('end_time', cairoToDate(date, 0).toISOString())
      .order('start_time');
    const nowMs = Date.now();
    setRows(((data as unknown as Row[]) || []).filter(
      (r) => !(r.status === 'pending' && r.payment_status === 'unpaid' && r.hold_expires_at && new Date(r.hold_expires_at).getTime() < nowMs)
    ));
    setLoading(false);
  }, [courts, date]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // the hours shown: from the earliest opening to the latest closing of the shown courts (8 AM–midnight if none set)
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
  const [dayStart, dayEnd] = useMemo(() => {
    let lo = 24 * 60;
    let hi = 0;
    shown.forEach((c) => c.availability_rules.filter((r) => r.day_of_week === dow && !r.is_closed).forEach((r) => {
      const o = toMin(r.open_time);
      const cl = toMin(r.close_time);
      lo = Math.min(lo, o);
      hi = Math.max(hi, cl <= o ? 24 * 60 : cl);
    }));
    if (hi <= lo) return [8 * 60, 24 * 60];
    return [Math.floor(lo / 60) * 60, Math.ceil(hi / 60) * 60];
  }, [shown, dow]);
  const slots = Array.from({ length: (dayEnd - dayStart) / SLOT }, (_, i) => dayStart + i * SLOT);

  const midnight = cairoToDate(date, 0).getTime();
  const minOf = (iso: string) => (new Date(iso).getTime() - midnight) / 60000;
  const rowsOf = (courtId: string) => rows.filter((r) => r.court_id === courtId);
  const busyAt = (courtId: string, m: number) => rowsOf(courtId).find((r) => minOf(r.start_time) < m + SLOT && minOf(r.end_time) > m);
  const today = cairoDate();
  const nowMin = date === today ? (now - midnight) / 60000 : date < today ? 24 * 60 : -1;

  function priceFor(courtId: string, sportId: string, length: number) {
    const cs = courts.find((c) => c.id === courtId)?.court_sports.find((s) => s.sport_id === sportId);
    return cs ? String(Math.round((Number(cs.price_per_hour) * length) / 60)) : '';
  }

  // the longest free length from a start (up to 4 hours), so the length chips never cross another booking
  function freeLength(courtId: string, start: number, skipId?: string) {
    let l = 0;
    while (l < 240 && start + l < dayEnd) {
      const b = busyAt(courtId, start + l);
      if (b && b.id !== skipId) break;
      l += SLOT;
    }
    return l;
  }

  function openNew(courtId: string, start: number) {
    if (!canManage) return;
    const sportId = courts.find((x) => x.id === courtId)?.court_sports[0]?.sport_id || '';
    const length = Math.min(60, freeLength(courtId, start)) || SLOT;
    setError('');
    setMessage('');
    setDraft({ block: false, courtId, start, length, sportId, name: '', phone: '', price: priceFor(courtId, sportId, length), priceTouched: false, paid: false, note: '' });
  }

  function openRow(r: Row) {
    setError('');
    setMessage('');
    if (r.booking_source === 'walk_in' && canManage) {
      const start = minOf(r.start_time);
      setDraft({
        id: r.id, courtId: r.court_id, start, length: minOf(r.end_time) - start, sportId: r.sport_id || '',
        name: r.walk_in_name || r.player_name || '', phone: r.walk_in_phone || '', price: String(Number(r.total_price)),
        priceTouched: true, paid: r.walk_in_paid, note: r.walk_in_note || '',
      });
    } else setInfo(r);
  }

  async function save() {
    if (!draft) return;
    setError('');
    if (!draft.name.trim()) return setError(t('Please add the customer’s name.'));
    const phone = draft.phone.replace(/\D/g, '');
    if (phone && !/^01\d{9}$/.test(phone)) return setError(t('The phone must be an 11-digit mobile number (01xxxxxxxxx).'));
    setBusy(true);
    const start = cairoToDate(date, draft.start).toISOString();
    const end = cairoToDate(date, draft.start + draft.length).toISOString();
    const price = draft.price.trim() === '' ? null : Number(draft.price);
    const { error: err } = draft.id
      ? await supabase.rpc('owner_update_walk_in', {
          p_id: draft.id, p_start: start, p_end: end, p_name: draft.name.trim(), p_phone: phone, p_price: price, p_paid: draft.paid, p_note: draft.note,
        })
      : await supabase.rpc('owner_add_walk_in', {
          p_court_id: draft.courtId, p_start: start, p_end: end, p_name: draft.name.trim(), p_phone: phone || null, p_price: price,
          p_paid: draft.paid, p_sport_id: draft.sportId || null, p_note: draft.note || null,
        });
    setBusy(false);
    if (err) return setError(err.message);
    setMessage(draft.id ? `✅ ${t('Walk-in updated.')}` : `✅ ${t('{name} is booked {from}–{to}.', { name: draft.name.trim(), from: hm(draft.start), to: hm(draft.start + draft.length) })}`);
    setDraft(null);
    load();
  }

  // close the time for players: one block row per half hour, like Block times, so each can be opened again alone
  async function blockTime() {
    if (!draft) return;
    setError('');
    setBusy(true);
    const { data: s } = await supabase.auth.getSession();
    const blocks = [];
    for (let m = draft.start; m < draft.start + draft.length; m += SLOT) {
      blocks.push({
        user_id: s.session?.user.id, court_id: draft.courtId,
        start_time: cairoToDate(date, m).toISOString(), end_time: cairoToDate(date, m + SLOT).toISOString(),
        total_price: 0, commission_rate_applied: 0, commission_amount: 0, owner_net_amount: 0,
        status: 'confirmed', payment_status: 'paid', booking_source: 'owner_block',
      });
    }
    const { error: err } = await supabase.from('bookings').insert(blocks);
    setBusy(false);
    if (err) {
      load();
      return setError(err.message.includes('no_overlap') || err.message.includes('exclu') ? t('This time was just booked. Please pick again.') : err.message);
    }
    setMessage(`✅ ${t('Blocked {from}–{to}.', { from: hm(draft.start), to: hm(draft.start + draft.length) })}`);
    setDraft(null);
    load();
  }

  async function unblock(r: Row) {
    setBusy(true);
    const { error: err } = await supabase.from('bookings').delete().eq('id', r.id).eq('booking_source', 'owner_block');
    setBusy(false);
    if (err) return setError(err.message);
    setMessage(`✅ ${t('{time} is open for players again.', { time: hm(minOf(r.start_time)) })}`);
    setInfo(null);
    load();
  }

  async function cancelWalkIn() {
    if (!draft?.id) return;
    setBusy(true);
    const { error: err } = await supabase.rpc('owner_update_walk_in', { p_id: draft.id, p_cancel: true });
    setBusy(false);
    if (err) return setError(err.message);
    setMessage(`✅ ${t('Walk-in cancelled. The time is free again.')}`);
    setDraft(null);
    load();
  }

  const walkIns = rows.filter((r) => r.booking_source === 'walk_in' && shown.some((c) => c.id === r.court_id));
  const online = rows.filter((r) => r.booking_source === 'player' && shown.some((c) => c.id === r.court_id));
  const walkInMoney = walkIns.reduce((a, r) => a + Number(r.total_price || 0), 0);
  const dayLabel = new Date(`${date}T12:00:00Z`).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const KIND_COLOR = { block: colors.muted, walk: colors.brandPink, hold: colors.warning, zaf: colors.brandBlue };

  return (
    <View style={{ flex: 1 }}>
      <View style={{ padding: 16, paddingBottom: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <DayButton label="‹" onPress={() => setDate(addDays(date, -1))} />
          <Pressable onPress={() => setDate(today)} style={{ flex: 1, alignItems: 'center', padding: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card }}>
            <Text style={{ color: colors.text, fontWeight: '800' }}>📅 {dayLabel}</Text>
            {date !== today && <Text style={{ color: colors.primaryAlt, fontSize: 11 }}>{t('Today')}</Text>}
          </Pressable>
          <DayButton label="›" onPress={() => setDate(addDays(date, 1))} />
        </View>
        {branches.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <Chip label={t('All branches')} on={!branch} onPress={() => { setBranch(''); setCourt(''); }} />
            {branches.map(([id, name]) => <Chip key={id} label={name} on={branch === id} onPress={() => { setBranch(id); setCourt(''); }} />)}
          </ScrollView>
        )}
        {courts.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <Chip label={t('All courts')} on={!court} onPress={() => setCourt('')} />
            {courts.filter((c) => !branch || c.facility?.id === branch).map((c) => <Chip key={c.id} label={c.name} on={court === c.id} onPress={() => setCourt(c.id)} />)}
          </ScrollView>
        )}
        <Muted>
          {t('{n} Zaf Play booking(s)', { n: online.length })} · {t('{n} walk-in(s)', { n: walkIns.length })}
          {walkIns.length > 0 ? ` (${t('{amount}, all yours', { amount: fmtEGP(walkInMoney) })})` : ''}
          {canManage ? ` · ${t('Tap a free time to add a walk-in or block it.')}` : ''}
        </Muted>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 6 }}>
          {([['zaf', 'Zaf Play'], ['walk', t('Walk-in')], ['hold', t('Paying now')], ['block', t('Blocked')]] as const).map(([k, label]) => (
            <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: KIND_COLOR[k] }} />
              <Text style={{ color: colors.muted, fontSize: 11 }}>{label}</Text>
            </View>
          ))}
        </View>
        {!!message && <Text style={{ color: colors.success, marginTop: 8 }}>{message}</Text>}
      </View>

      {shown.length === 0 ? (
        <Muted style={{ padding: 16 }}>{loading ? t('Loading…') : t('No courts yet.')}</Muted>
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 40 }}>
          <View style={{ flexDirection: 'row' }}>
            <View style={{ width: 62, paddingTop: 36 }}>
              {slots.map((m) => (
                <Text key={m} style={{ height: ROW, color: colors.muted, fontSize: 10, textAlign: 'right', paddingRight: 6 }}>{m % 60 === 0 ? hm(m) : ''}</Text>
              ))}
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {shown.map((c) => (
                <View key={c.id} style={{ width: shown.length === 1 ? 280 : COL, borderLeftWidth: 1, borderColor: colors.border }}>
                  <View style={{ height: 36, justifyContent: 'center', paddingHorizontal: 4 }}>
                    <Text numberOfLines={1} style={{ color: colors.text, fontWeight: '800', textAlign: 'center', fontSize: 13 }}>{c.name}</Text>
                    {branches.length > 1 && !branch && <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 10, textAlign: 'center' }}>{c.facility?.name}</Text>}
                  </View>
                  <View style={{ height: slots.length * ROW }}>
                    {slots.map((m, i) => {
                      const taken = busyAt(c.id, m);
                      const past = m + SLOT <= nowMin;
                      return (
                        <Pressable key={m} disabled={!!taken || past || !canManage} onPress={() => openNew(c.id, m)}
                          accessibilityLabel={`${c.name} ${hm(m)} ${t('free')}`}
                          style={({ pressed }) => ({ position: 'absolute', left: 0, right: 0, top: i * ROW, height: ROW,
                            borderTopWidth: m % 60 === 0 ? 1 : 0.5, borderColor: colors.border, borderStyle: m % 60 === 0 ? 'solid' : 'dashed',
                            backgroundColor: past ? colors.past : pressed ? colors.soft : 'transparent' })} />
                      );
                    })}
                    {rowsOf(c.id).map((r) => {
                      const s = Math.max(minOf(r.start_time), dayStart);
                      const e = Math.min(minOf(r.end_time), dayEnd);
                      if (e <= s) return null;
                      const kind = r.booking_source === 'owner_block' ? 'block' : r.booking_source === 'walk_in' ? 'walk' : r.payment_status === 'unpaid' ? 'hold' : 'zaf';
                      const who = kind === 'block' ? t('Blocked') : kind === 'walk' ? r.walk_in_name || r.player_name : r.player_name || t('Player');
                      return (
                        <Pressable key={r.id} onPress={() => openRow(r)} accessibilityRole="button"
                          style={{ position: 'absolute', left: 3, right: 3, top: ((s - dayStart) / SLOT) * ROW + 1, height: ((e - s) / SLOT) * ROW - 2,
                            backgroundColor: KIND_COLOR[kind], borderRadius: 8, paddingHorizontal: 5, paddingVertical: 2, overflow: 'hidden' }}>
                          <Text numberOfLines={1} style={{ color: '#fff', fontWeight: '800', fontSize: 11 }}>{who}</Text>
                          {e - s > SLOT && <Text numberOfLines={1} style={{ color: '#fff', fontSize: 10, opacity: 0.9 }}>{hm(minOf(r.start_time))}–{hm(minOf(r.end_time))}</Text>}
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ))}
            </ScrollView>
          </View>
        </ScrollView>
      )}

      {info && (
        <Sheet onClose={() => setInfo(null)} title={info.booking_source === 'owner_block' ? t('Blocked time') : info.player_name || t('Booking')}>
          <Text style={{ color: colors.text }}>{courts.find((c) => c.id === info.court_id)?.name} · {tm(timeLabel(info.start_time))} – {tm(timeLabel(info.end_time))}</Text>
          {info.booking_source === 'owner_block' ? (
            canManage ? (
              <View style={{ marginTop: 14 }}>
                {!!error && <Note kind="error">{error}</Note>}
                <Button title={busy ? t('Opening…') : t('Unblock (open for players)')} onPress={() => unblock(info)} loading={busy} />
              </View>
            ) : null
          ) : info.booking_source === 'walk_in' ? (
            <Muted style={{ marginTop: 8 }}>{t('Walk-in')} · {fmtEGP(info.total_price)}{info.walk_in_phone ? ` · ${info.walk_in_phone}` : ''}</Muted>
          ) : (
            <>
              <Muted style={{ marginTop: 8 }}>{t('Booked on Zaf Play')} · {info.sport?.name} · {fmtEGP(info.total_price)}{info.player_phone ? ` · ${info.player_phone}` : ''}</Muted>
              <Text style={{ color: colors.text, fontWeight: '700', marginTop: 6 }}>
                {info.payment_status === 'paid' ? t('Paid') : info.payment_status === 'pending_review' ? t('Payment being checked') : t('Paying now (held for a few minutes)')}
              </Text>
            </>
          )}
        </Sheet>
      )}

      {draft && (() => {
        const c = courts.find((x) => x.id === draft.courtId);
        const maxLen = freeLength(draft.courtId, draft.start, draft.id);
        const lengths = [30, 60, 90, 120, 180, 240].filter((l) => l <= Math.max(maxLen, draft.length));
        return (
          <Sheet onClose={() => setDraft(null)} title={draft.id ? t('Walk-in') : draft.block ? t('Block this time') : t('Add a walk-in')}>
            {!draft.id && (
              <Chips>
                <Chip label={`🙋 ${t('Walk-in')}`} on={!draft.block} onPress={() => setDraft({ ...draft, block: false })} />
                <Chip label={`🔒 ${t('Block')}`} on={!!draft.block} onPress={() => setDraft({ ...draft, block: true })} />
              </Chips>
            )}
            <Muted>{c?.name} · {dayLabel} · {hm(draft.start)}–{hm(draft.start + draft.length)}</Muted>
            <View style={{ marginTop: 10 }}>
              <Chips>
                {lengths.map((l) => (
                  <Chip key={l} label={len(l)} on={draft.length === l}
                    onPress={() => setDraft({ ...draft, length: l, price: draft.priceTouched ? draft.price : priceFor(draft.courtId, draft.sportId, l) })} />
                ))}
              </Chips>
            </View>
            {draft.block ? (
              <Muted style={{ marginBottom: 12 }}>{t("Players can't book this time on Zaf Play. Tap it later to open it again.")}</Muted>
            ) : (
              <>
                {!draft.id && (c?.court_sports.length || 0) > 1 && (
                  <Chips>
                    {c?.court_sports.map((s) => (
                      <Chip key={s.sport_id} label={s.sport?.name || ''} on={draft.sportId === s.sport_id}
                        onPress={() => setDraft({ ...draft, sportId: s.sport_id, price: draft.priceTouched ? draft.price : priceFor(draft.courtId, s.sport_id, draft.length) })} />
                    ))}
                  </Chips>
                )}
                <Field label={t('Customer name')} value={draft.name} onChangeText={(v) => setDraft({ ...draft, name: v.slice(0, 60) })} />
                <Field label={t('Mobile (optional)')} value={draft.phone} keyboardType="phone-pad"
                  onChangeText={(v) => setDraft({ ...draft, phone: v.replace(/[^\d ]/g, '').slice(0, 14) })} />
                <Field label={t('Price in EGP')} value={draft.price} keyboardType="decimal-pad"
                  onChangeText={(v) => setDraft({ ...draft, price: v.replace(/[^\d.]/g, '').slice(0, 7), priceTouched: true })} />
                <Pressable onPress={() => setDraft({ ...draft, paid: !draft.paid })} accessibilityRole="checkbox" accessibilityState={{ checked: draft.paid }}
                  style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
                  <Text style={{ color: draft.paid ? colors.success : colors.muted, fontSize: 20, marginRight: 8 }}>{draft.paid ? '☑' : '☐'}</Text>
                  <Text style={{ color: colors.text }}>{t('Already paid at the venue')}</Text>
                </Pressable>
                <Field label={t('Note (optional)')} value={draft.note} onChangeText={(v) => setDraft({ ...draft, note: v.slice(0, 200) })} />
                <Muted style={{ marginBottom: 12 }}>{t('Walk-ins are all yours: no Zaf Play commission. The time is closed for players on Zaf Play.')}</Muted>
              </>
            )}
            {!!error && <Note kind="error">{error}</Note>}
            <Button
              title={busy ? t('Saving…') : draft.id ? t('Save changes') : draft.block ? t('Block {length}', { length: len(draft.length) }) : t('Add walk-in')}
              onPress={draft.block ? blockTime : save} loading={busy} />
            {!!draft.id && <View style={{ marginTop: 8 }}><Button variant="ghost" title={t('Cancel this walk-in')} onPress={cancelWalkIn} disabled={busy} /></View>}
          </Sheet>
        );
      })()}
    </View>
  );
}

function DayButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={6} accessibilityRole="button"
      style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card }}>
      <Text style={{ color: colors.text, fontSize: 22, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}
