import { useCallback, useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, View } from 'react-native';
import { Text } from '@/components/AppText';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import MapView, { Marker } from 'react-native-maps';
import { photoUrl, supabase, uploadPhoto } from '@/lib/supabase';
import { hm12 } from '@/lib/format';
import { isValidCoords, isValidGoogleMapsUrl, MAPS_URL_HELP, coordsFromMapsUrl } from '@/lib/maps';
import { capitalizeWords, cleanExtraName, ENGLISH_HELP, extraProblem, isEgyptMobile, isEnglishText, onlyDigits } from '@/lib/validate';
import { courtPlanSummary, effectiveEnd, loadPlans, periodState, PLAN_NAMES, planDate, STATE_LABEL, type Period, type Plan, type PlanRequest } from '@/lib/plans';
import { useRequestId } from '@/lib/requestId';
import { useT } from '@/lib/ownerLang';
import { colors, radius } from '@/lib/theme';
import { Badge, Box, Chip, Chips, fmtEGP, LinkButton, Muted } from './owner';
import { Button, Field, Note } from './ui';

// The court pieces of the owner screens, ported from the website's CourtForm, HoursEditor, CourtExtrasManager,
// CourtPhotosManager, OwnerSubscriptions and BranchLocation.

export function Check({ on, onPress, title, help }: { on: boolean; onPress: () => void; title: string; help?: string }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="checkbox" accessibilityState={{ checked: on }} style={{ flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 6 }}>
      <Text style={{ color: on ? colors.success : colors.muted, fontSize: 20, marginEnd: 10 }}>{on ? '☑' : '☐'}</Text>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text, fontWeight: '600' }}>{title}</Text>
        {!!help && <Muted style={{ fontSize: 12 }}>{help}</Muted>}
      </View>
    </Pressable>
  );
}

// ---------- working hours ----------
export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((label, value) => ({ value, label }));
const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
type DayHours = { open_time: string; close_time: string; is_closed: boolean };
export type WeekHours = Record<number, DayHours>;
const HALF_HOURS = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);

export function defaultHours(): WeekHours {
  const h: WeekHours = {};
  for (const d of DAYS) h[d.value] = { open_time: '09:00', close_time: '23:00', is_closed: false };
  return h;
}

// an error message, or '' when the hours are fine
export function checkHours(h: WeekHours) {
  const open = DAYS.filter((d) => !h[d.value]?.is_closed);
  if (open.length === 0) return 'The court must be open at least one day a week.';
  const minutes = (x: string) => Number(x.slice(0, 2)) * 60 + Number(x.slice(3, 5));
  for (const d of open) {
    const r = h[d.value];
    if (!r.open_time || !r.close_time || r.close_time === r.open_time) return `${d.label}: the opening and closing times can't be the same.`;
    if ((minutes(r.close_time) - minutes(r.open_time) + 1440) % 1440 < 60) return `${d.label}: the court must be open at least 1 hour.`;
  }
  return '';
}

export const hoursRows = (courtId: string, h: WeekHours) =>
  DAYS.map((d) => ({ court_id: courtId, day_of_week: d.value, open_time: h[d.value].open_time, close_time: h[d.value].close_time, is_closed: h[d.value].is_closed }));

// a half-hour picked from a row of chips
export function HalfHourPicker({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const { tm } = useT();
  return (
    <View style={{ marginBottom: 6 }}>
      <Muted style={{ fontSize: 12 }}>{label}</Muted>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {HALF_HOURS.map((x) => <Chip key={x} label={tm(hm12(x))} on={value === x} onPress={() => onChange(x)} />)}
      </ScrollView>
    </View>
  );
}

function TimeRange({ r, onChange }: { r: DayHours; onChange: (field: 'open_time' | 'close_time', v: string) => void }) {
  const { t, tm } = useT();
  return (
    <View>
      <HalfHourPicker label={t('Opens')} value={r.open_time} onChange={(v) => onChange('open_time', v)} />
      <HalfHourPicker label={t('Closes')} value={r.close_time} onChange={(v) => onChange('close_time', v)} />
      <Muted style={{ fontSize: 12 }}>{tm(hm12(r.open_time))} → {tm(hm12(r.close_time))}{r.close_time <= r.open_time ? ` (${t('next day')} 🌙)` : ''}</Muted>
    </View>
  );
}

export function HoursEditor({ value, onChange }: { value: WeekHours; onChange: (v: WeekHours) => void }) {
  const { t } = useT();
  const openDays = DAYS.filter((d) => !value[d.value]?.is_closed);
  const allSame = openDays.every((d) => value[d.value].open_time === value[openDays[0]?.value]?.open_time && value[d.value].close_time === value[openDays[0]?.value]?.close_time);
  const [mode, setMode] = useState<'same' | 'each'>(allSame ? 'same' : 'each');
  const base = value[openDays[0]?.value ?? 0] || { open_time: '09:00', close_time: '23:00', is_closed: false };

  const set = (day: number, patch: Partial<DayHours>) => onChange({ ...value, [day]: { ...value[day], ...patch } });
  function setAll(field: 'open_time' | 'close_time', v: string) {
    const next: WeekHours = {};
    for (const d of DAYS) next[d.value] = { ...value[d.value], open_time: base.open_time, close_time: base.close_time, [field]: v };
    onChange(next);
  }
  function chooseSame() {
    const next: WeekHours = {};
    for (const d of DAYS) next[d.value] = { ...value[d.value], open_time: base.open_time, close_time: base.close_time };
    onChange(next);
    setMode('same');
  }

  return (
    <Box>
      <Chips>
        <Chip label={t('Same hours every day')} on={mode === 'same'} onPress={chooseSame} />
        <Chip label={t('Different hours per day')} on={mode === 'each'} onPress={() => setMode('each')} />
      </Chips>
      {mode === 'same' ? (
        <>
          <Text style={{ color: colors.text, fontWeight: '700', marginBottom: 6 }}>{t('Open on')}</Text>
          <Chips>{DAYS.map((d) => <Chip key={d.value} label={t(SHORT[d.value])} on={!value[d.value].is_closed} onPress={() => onChange({ ...value, [d.value]: { ...base, is_closed: !value[d.value].is_closed } })} />)}</Chips>
          <Muted style={{ fontSize: 12, marginBottom: 8 }}>{t('Tap a day to close it.')}</Muted>
          <TimeRange r={base} onChange={setAll} />
        </>
      ) : DAYS.map((d) => {
        const r = value[d.value];
        return (
          <View key={d.value} style={{ borderTopWidth: 1, borderColor: colors.border, paddingVertical: 8 }}>
            <Check on={!r.is_closed} onPress={() => set(d.value, { is_closed: !r.is_closed })} title={`${t(d.label)} · ${r.is_closed ? t('Closed') : t('Open (day)')}`} />
            {!r.is_closed && <TimeRange r={r} onChange={(f, v) => set(d.value, { [f]: v })} />}
          </View>
        );
      })}
    </Box>
  );
}

// ---------- court details ----------
export type SportOption = { id: string; name: string; outdoor_only: boolean; indoor_only?: boolean };
export type CourtFormValues = { name: string; is_indoor: boolean; surface_type: string; maps_url: string; late_fee_percent: string; phone: string; prices: Record<string, string> };
export type DraftExtra = { name: string; price: string; max_qty: string; is_required: boolean; sport_id: string };
export const emptyCourt: CourtFormValues = { name: '', is_indoor: false, surface_type: '', maps_url: '', late_fee_percent: '50', phone: '', prices: {} };
export type PickedPhoto = { uri: string; mimeType: string };

// "New court" and "Edit court". A new court needs a photo and its working hours, saved right after the court.
// Court details are in English only. The late change / cancellation fee is set by Zaf Play, not here.
export function CourtForm({ initial, sports, submitLabel, onSubmit, onCancel, askPhotos = false, askHours = false, askExtras = false }: {
  initial: CourtFormValues; sports: SportOption[]; submitLabel: string;
  onSubmit: (values: CourtFormValues, photos: PickedPhoto[], hours: WeekHours | null, extras: DraftExtra[]) => Promise<string | null>;
  onCancel?: () => void; askPhotos?: boolean; askHours?: boolean; askExtras?: boolean;
}) {
  const { t } = useT();
  const [values, setValues] = useState<CourtFormValues>(initial);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [hours, setHours] = useState<WeekHours>(defaultHours());
  const [extras, setExtras] = useState<DraftExtra[]>([]);

  const selectedIds = Object.keys(values.prices);
  const outdoorPicked = sports.filter((s) => s.outdoor_only && selectedIds.includes(s.id));
  const indoorPicked = sports.filter((s) => s.indoor_only && selectedIds.includes(s.id));
  const outdoorNames = outdoorPicked.map((s) => s.name).join(', ');
  const indoorNames = indoorPicked.map((s) => s.name).join(', ');

  function toggleSport(sport: SportOption) {
    const prices = { ...values.prices };
    if (sport.id in prices) delete prices[sport.id];
    else prices[sport.id] = '';
    // outdoor-only sports force outdoor; indoor-only sports force indoor
    const forcedOutdoor = sports.some((s) => s.outdoor_only && s.id in prices);
    const forcedIndoor = sports.some((s) => s.indoor_only && s.id in prices);
    const is_indoor = forcedOutdoor && !forcedIndoor ? false : forcedIndoor && !forcedOutdoor ? true : values.is_indoor;
    setValues({ ...values, prices, is_indoor });
  }

  async function addPhotos() {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 10, quality: 0.7 });
    if (r.canceled) return;
    setPhotos((p) => [...p, ...r.assets.map((a) => ({ uri: a.uri, mimeType: a.mimeType || 'image/jpeg' }))].slice(0, 10));
  }

  async function submit() {
    setErrorMsg('');
    if (!values.name.trim()) return setErrorMsg(t('Please enter the court name.'));
    if (!isEnglishText(values.name) || !isEnglishText(values.surface_type)) return setErrorMsg(`${t('Court name and surface:')} ${t(ENGLISH_HELP)}`);
    if (selectedIds.length === 0) return setErrorMsg(t('Choose at least one sport for this court.'));
    const missing = sports.find((s) => selectedIds.includes(s.id) && !(Number(values.prices[s.id]) > 0));
    if (missing) return setErrorMsg(t('Please enter a price per hour for {sport}.', { sport: missing.name }));
    if (outdoorPicked.length && indoorPicked.length) return setErrorMsg(t("{a} (outdoor only) and {b} (indoor only) can't be on the same court.", { a: outdoorNames, b: indoorNames }));
    if (indoorPicked.length && !values.is_indoor) return setErrorMsg(t('{a} courts must be indoor.', { a: indoorNames }));
    if (outdoorPicked.length && values.is_indoor) return setErrorMsg(t('{a} courts must be outdoor.', { a: outdoorNames }));
    if (!isValidGoogleMapsUrl(values.maps_url)) return setErrorMsg(t('Please paste a valid Google Maps link for this court.'));
    if (!isEgyptMobile(values.phone)) return setErrorMsg(t('Please enter the court phone number: 11 digits, e.g. 01012345678.'));
    if (askHours) {
      const problem = checkHours(hours);
      if (problem) return setErrorMsg(`${t('Working hours')} — ${t(problem)}`);
    }
    if (askPhotos && photos.length === 0) return setErrorMsg(t('Please add at least one photo of the court. Players book more when they can see it.'));
    if (askExtras) for (const x of extras) {
      const problem = extraProblem(x.name, x.price);
      if (problem) return setErrorMsg(t(problem));
    }
    setSaving(true);
    const error = await onSubmit(
      { ...values, name: capitalizeWords(values.name), surface_type: capitalizeWords(values.surface_type), maps_url: values.maps_url.trim() },
      photos, askHours ? hours : null,
      askExtras ? extras.map((x) => ({ ...x, name: capitalizeWords(cleanExtraName(x.name)) })) : [],
    );
    // on success the screen moves on, so the button stays locked (pressing it again would add the court twice)
    if (error) {
      setSaving(false);
      setErrorMsg(error);
    }
  }

  const locked = outdoorPicked.length > 0 || indoorPicked.length > 0;
  return (
    <View>
      <Field label={t('Court Name')} value={values.name} onChangeText={(v) => setValues({ ...values, name: v })} placeholder={t('e.g. Court 2 (in English)')} />
      <Text style={{ color: colors.text, fontWeight: '700' }}>{t('Sports on this court & price per hour')}</Text>
      <Muted style={{ fontSize: 12, marginBottom: 6 }}>{t('Tick every sport players can book here. Each sport has its own price.')}</Muted>
      <Box>
        {sports.map((sport) => {
          const checked = sport.id in values.prices;
          return (
            <View key={sport.id} style={{ borderBottomWidth: 1, borderColor: colors.border, paddingVertical: 4 }}>
              <Check on={checked} onPress={() => toggleSport(sport)}
                title={`${sport.name}${sport.outdoor_only ? ` (${t('outdoor only')})` : ''}${sport.indoor_only ? ` (${t('indoor only')})` : ''}`} />
              {checked && (
                <Field label={t('EGP/hour')} value={values.prices[sport.id]} keyboardType="number-pad" placeholder="200"
                  onChangeText={(v) => setValues({ ...values, prices: { ...values.prices, [sport.id]: v.replace(/\D/g, '') } })} />
              )}
            </View>
          );
        })}
      </Box>
      <Text style={{ color: colors.text, fontWeight: '700', marginBottom: 6 }}>{t('Indoor or Outdoor')}</Text>
      {locked ? (
        <>
          <Muted>🔒 {outdoorPicked.length && indoorPicked.length ? '—' : values.is_indoor ? `🏠 ${t('Indoor')}` : `☀️ ${t('Outdoor')}`} · {t('Set by the sport')}</Muted>
          <Text style={{ color: outdoorPicked.length && indoorPicked.length ? colors.danger : colors.muted, fontSize: 12, marginBottom: 10 }}>
            {outdoorPicked.length && indoorPicked.length
              ? t('{a} is outdoor only and {b} is indoor only — untick one of them.', { a: outdoorNames, b: indoorNames })
              : outdoorPicked.length ? t("{a} is always outdoor, so this can't be changed.", { a: outdoorNames }) : t("{a} is always indoor, so this can't be changed.", { a: indoorNames })}
          </Text>
        </>
      ) : (
        <Chips>
          <Chip label={`☀️ ${t('Outdoor')}`} on={!values.is_indoor} onPress={() => setValues({ ...values, is_indoor: false })} />
          <Chip label={`🏠 ${t('Indoor')}`} on={values.is_indoor} onPress={() => setValues({ ...values, is_indoor: true })} />
        </Chips>
      )}
      <Field label={t('Surface Type (optional)')} value={values.surface_type} onChangeText={(v) => setValues({ ...values, surface_type: v })} placeholder={t('e.g. sand, wood, synthetic')} />
      <Field label={t('Court phone number')} value={values.phone} keyboardType="number-pad" maxLength={11} placeholder="01xxxxxxxxx" onChangeText={(v) => setValues({ ...values, phone: onlyDigits(v) })} />
      <Muted style={{ fontSize: 12, marginTop: -8, marginBottom: 12 }}>{t('Players with a paid booking see this number only from 30 minutes before their game until 30 minutes after, in case they need help on court.')}</Muted>
      <Field label={t('Google Maps Location Link')} value={values.maps_url} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="https://maps.app.goo.gl/..."
        onChangeText={(v) => setValues({ ...values, maps_url: v })} />
      <Muted style={{ fontSize: 12, marginTop: -8, marginBottom: 12 }}>{t(MAPS_URL_HELP)}</Muted>

      {askPhotos && (
        <View style={{ marginBottom: 12 }}>
          <Text style={{ color: colors.text, fontWeight: '700' }}>{t('Court photos (at least 1)')}</Text>
          <Muted style={{ fontSize: 12, marginBottom: 8 }}>{t('Clear, bright photos of the court. Tap “Make cover” on the one players should see first. Zaf Play checks them before they go live.')}</Muted>
          <Button small variant="ghost" title={`📷 ${photos.length ? t('Add more photos') : t('Choose photos')}`} onPress={addPhotos} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
            {photos.map((p, i) => (
              <View key={`${p.uri}-${i}`} style={{ width: 96 }}>
                <Image source={{ uri: p.uri }} style={{ width: 96, height: 72, borderRadius: 8 }} />
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  {i === 0 ? <Text style={{ color: colors.text, fontSize: 12 }}>★ {t('Cover')}</Text>
                    : <Text style={{ color: colors.primaryAlt, fontSize: 12 }} onPress={() => setPhotos((x) => [x[i], ...x.filter((_, j) => j !== i)])}>{t('Make cover')}</Text>}
                  <Text style={{ color: colors.danger, fontSize: 12 }} onPress={() => setPhotos((x) => x.filter((_, j) => j !== i))}>✕</Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      )}

      {askHours && (
        <View>
          <Text style={{ color: colors.text, fontWeight: '700' }}>{t('Working hours')}</Text>
          <Muted style={{ fontSize: 12, marginBottom: 6 }}>{t('When players can book this court. You can change them any time.')}</Muted>
          <HoursEditor value={hours} onChange={setHours} />
        </View>
      )}

      {askExtras && (
        <View style={{ marginBottom: 12 }}>
          <Text style={{ color: colors.text, fontWeight: '700' }}>{t('Extras (optional)')}</Text>
          <Muted style={{ fontSize: 12, marginBottom: 6 }}>{t('Things players can add to a booking (rackets, balls…) or a fixed fee on every booking. You can change them later.')}</Muted>
          {extras.map((x, i) => {
            const upd = (patch: Partial<DraftExtra>) => setExtras((l) => l.map((e, j) => (j === i ? { ...e, ...patch } : e)));
            return (
              <Box key={i}>
                <Field label={t('Name (English), e.g. Paddle')} value={x.name} onChangeText={(v) => upd({ name: v })} />
                <Field label={t('Price in EGP, e.g. 50')} value={x.price} keyboardType="decimal-pad" onChangeText={(v) => upd({ price: v.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1') })} />
                <Check on={x.is_required} onPress={() => upd({ is_required: !x.is_required })} title={t('Fixed fee on every booking')} />
                {!x.is_required && <QtyPicker value={x.max_qty} onChange={(v) => upd({ max_qty: v })} />}
                <LinkButton danger title={t('Remove')} onPress={() => setExtras((l) => l.filter((_, j) => j !== i))} />
              </Box>
            );
          })}
          <Button small variant="ghost" title={t('+ Add extra')} onPress={() => setExtras((l) => [...l, { name: '', price: '', max_qty: '2', is_required: false, sport_id: '' }])} />
        </View>
      )}

      {!!errorMsg && <Note kind="error">{errorMsg}</Note>}
      <Button title={saving ? t('Saving...') : submitLabel} onPress={submit} loading={saving} />
      {onCancel && <View style={{ marginTop: 8 }}><Button variant="ghost" title={t('Cancel')} onPress={onCancel} /></View>}
    </View>
  );
}

function QtyPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useT();
  return (
    <View>
      <Muted style={{ fontSize: 12 }}>{t('Players can choose up to')}</Muted>
      <Chips>{Array.from({ length: 10 }, (_, n) => String(n + 1)).map((n) => <Chip key={n} label={n} on={value === n} onPress={() => onChange(n)} />)}</Chips>
    </View>
  );
}

// ---------- extras ----------
type Extra = { id: string; name: string; price: number; max_qty: number; is_required: boolean; sport_id: string | null; status: 'pending' | 'approved' | 'rejected'; reject_reason: string | null };
const EMPTY_EXTRA = { id: '', name: '', price: '', max_qty: '2', is_required: false, sport_id: '' };

// extras players can add to a booking (rackets, balls...) or a fee on every booking; each is approved by Zaf Play
export function ExtrasManager({ courtId, sports }: { courtId: string; sports: { id: string; name: string }[] }) {
  const { t } = useT();
  const [extras, setExtras] = useState<Extra[]>([]);
  const [form, setForm] = useState<typeof EMPTY_EXTRA | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    const { data } = await supabase.from('court_extras').select('id, name, price, max_qty, is_required, sport_id, status, reject_reason')
      .eq('court_id', courtId).eq('is_active', true).order('name');
    setExtras(((data as any[]) || []).map((e) => ({ ...e, price: Number(e.price) })));
  }, [courtId]);
  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!form) return;
    const problem = extraProblem(form.name, form.price);
    if (problem) return setMsg(`❌ ${problem.replace(/^Extras: /, '')}`);
    setBusy(true);
    setMsg('');
    const { error } = await supabase.rpc('owner_save_extra', {
      p_id: form.id || null, p_court_id: courtId, p_sport_id: form.sport_id || null, p_name: capitalizeWords(cleanExtraName(form.name)),
      p_price: Number(form.price), p_max_qty: Number(form.max_qty), p_is_required: form.is_required,
    });
    setBusy(false);
    if (error) return setMsg(`❌ ${error.message}`);
    setForm(null);
    setMsg(`✅ ${t('Saved — Zaf Play will approve it shortly. Players see it after approval.')}`);
    load();
  }

  async function remove(id: string) {
    setBusy(true);
    const { error } = await supabase.rpc('owner_remove_extra', { p_id: id });
    setBusy(false);
    setMsg(error ? `❌ ${error.message}` : t('Removed.'));
    load();
  }

  const sportName = (id: string | null) => (id ? sports.find((s) => s.id === id)?.name : t('All sports'));
  return (
    <View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ color: colors.text, fontWeight: '800' }}>{t('Extras')}</Text>
        {!form && <LinkButton title={t('+ Add extra')} onPress={() => setForm({ ...EMPTY_EXTRA })} />}
      </View>
      <Muted style={{ fontSize: 12, marginBottom: 6 }}>{t('Rackets, balls, paddles… or a fixed fee added to every booking. Prices are in EGP.')}</Muted>
      {extras.length === 0 && !form && <Muted style={{ fontSize: 12 }}>{t('No extras yet.')}</Muted>}
      {extras.map((e) => (
        <View key={e.id} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 8, marginBottom: 6 }}>
          <Text style={{ color: colors.text, fontSize: 13 }}>
            <Text style={{ fontWeight: '800' }}>{e.name}</Text> · {fmtEGP(e.price)} · {e.is_required ? t('added to every booking') : t('up to {n}', { n: e.max_qty })} · <Text style={{ color: colors.muted }}>{sportName(e.sport_id)}</Text>
          </Text>
          {e.status === 'pending' && <Badge tone="warn" text={t('Waiting for approval')} />}
          {e.status === 'rejected' && <Badge tone="bad" text={`${t('Not approved')}${e.reject_reason ? `: ${e.reject_reason}` : ''}`} />}
          <View style={{ flexDirection: 'row' }}>
            <LinkButton title={t('Edit')} onPress={() => setForm({ id: e.id, name: e.name, price: String(e.price), max_qty: String(e.max_qty), is_required: e.is_required, sport_id: e.sport_id || '' })} />
            <LinkButton danger title={t('Remove')} onPress={() => remove(e.id)} disabled={busy} />
          </View>
        </View>
      ))}
      {form && (
        <Box>
          <Field label={t('Name (English), e.g. Racket')} value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} />
          <Field label={t('Price in EGP, e.g. 100')} value={form.price} keyboardType="decimal-pad" onChangeText={(v) => setForm({ ...form, price: v.replace(/[^\d.]/g, '') })} />
          <Chips>
            <Chip label={t('For all sports on this court')} on={!form.sport_id} onPress={() => setForm({ ...form, sport_id: '' })} />
            {sports.map((s) => <Chip key={s.id} label={t('Only for {sport}', { sport: s.name })} on={form.sport_id === s.id} onPress={() => setForm({ ...form, sport_id: s.id })} />)}
          </Chips>
          <Check on={form.is_required} onPress={() => setForm({ ...form, is_required: !form.is_required })} title={t('Fixed fee on every booking')} />
          {!form.is_required && <QtyPicker value={form.max_qty} onChange={(v) => setForm({ ...form, max_qty: v })} />}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}><Button small title={t('Save extra')} onPress={save} loading={busy} /></View>
            <View style={{ flex: 1 }}><Button small variant="ghost" title={t('Cancel')} onPress={() => setForm(null)} /></View>
          </View>
        </Box>
      )}
      {!!msg && <Text style={{ color: colors.text, fontSize: 12, marginTop: 6 }}>{msg}</Text>}
    </View>
  );
}

// ---------- photos ----------
const MAX_COURT_PHOTOS = 10;

// upload a court's photos, see which are live / waiting / declined, pick the cover, delete. New photos wait for Zaf Play.
export async function uploadCourtPhotos(courtId: string, files: PickedPhoto[]) {
  let added = 0;
  let error = '';
  for (const f of files) {
    const ext = f.mimeType === 'image/png' ? 'png' : f.mimeType === 'image/webp' ? 'webp' : 'jpg';
    const path = `${courtId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const upErr = await uploadPhoto('court-images', path, f.uri, f.mimeType);
    if (upErr) { error = upErr; continue; }
    const { error: rpcErr } = await supabase.rpc('add_court_photo', { p_court_id: courtId, p_path: path });
    if (rpcErr) {
      await supabase.storage.from('court-images').remove([path]);
      error = rpcErr.message;
      continue;
    }
    added++;
  }
  return { added, error };
}

export function PhotosManager({ courtId }: { courtId: string }) {
  const { t } = useT();
  const [photos, setPhotos] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    const { data } = await supabase.from('court_photos').select('id, path, status, reject_reason, sort_order, created_at')
      .eq('court_id', courtId).order('sort_order', { ascending: true }).order('created_at', { ascending: true });
    setPhotos((data as any[]) || []);
  }, [courtId]);
  useEffect(() => { load(); }, [load]);

  const active = photos.filter((p) => p.status !== 'rejected');
  const room = MAX_COURT_PHOTOS - active.length;
  const coverId = photos.find((p) => p.status === 'approved')?.id;

  async function add() {
    setMessage('');
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: room, quality: 0.7 });
    if (r.canceled) return;
    const files = r.assets.slice(0, room).map((a) => ({ uri: a.uri, mimeType: a.mimeType || 'image/jpeg' }));
    if (r.assets.length > room) setMessage(t('You can add {n} more photo(s) to this court (up to {max}).', { n: room, max: MAX_COURT_PHOTOS }));
    setUploading(true);
    const { added, error } = await uploadCourtPhotos(courtId, files);
    setUploading(false);
    if (error) setMessage(`❌ ${error}`);
    if (added > 0) setMessage(`📨 ${t('{n} photo(s) sent to Zaf Play for approval.', { n: added })}`);
    load();
  }

  async function remove(p: any) {
    setBusyId(p.id);
    setMessage('');
    const { data: path, error } = await supabase.rpc('delete_court_photo', { p_photo_id: p.id });
    if (!error && path && !String(path).startsWith('/')) await supabase.storage.from('court-images').remove([path as string]);
    setBusyId(null);
    if (error) setMessage(`❌ ${error.message}`);
    load();
  }

  async function makeCover(p: any) {
    setBusyId(p.id);
    setMessage('');
    const { error } = await supabase.rpc('set_court_photo_cover', { p_photo_id: p.id });
    setBusyId(null);
    if (error) setMessage(`❌ ${error.message}`);
    load();
  }

  return (
    <View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ color: colors.text, fontWeight: '800' }}>{t('Photos')} <Text style={{ color: colors.muted, fontWeight: '400' }}>({active.length}/{MAX_COURT_PHOTOS})</Text></Text>
        {room > 0 && <LinkButton title={uploading ? t('Uploading...') : t('+ Add photos')} onPress={add} disabled={uploading} />}
      </View>
      {photos.length === 0 ? <Muted style={{ fontSize: 12 }}>{t('No photos yet. Players book more when they can see the court.')}</Muted> : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
          {photos.map((p) => (
            <View key={p.id} style={{ width: 100 }}>
              <Image source={{ uri: photoUrl(p.path) || undefined }} style={{ width: 100, height: 75, borderRadius: 8, opacity: p.status === 'rejected' ? 0.4 : 1 }} />
              <Text style={{ fontSize: 12, fontWeight: '700', color: p.status === 'approved' ? colors.success : p.status === 'pending' ? colors.warning : colors.danger }}>
                {p.status === 'approved' ? (p.id === coverId ? `${t('Cover')} · ${t('Live')}` : t('Live')) : p.status === 'pending' ? t('Waiting') : t('Declined')}
              </Text>
              {p.status === 'rejected' && !!p.reject_reason && <Text style={{ fontSize: 12, color: colors.danger }}>{p.reject_reason}</Text>}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                {p.status !== 'rejected' && p.id !== coverId && <Text style={{ color: colors.primaryAlt, fontSize: 12 }} onPress={() => busyId !== p.id && makeCover(p)}>{t('Cover')}</Text>}
                <Text style={{ color: colors.danger, fontSize: 12 }} onPress={() => busyId !== p.id && remove(p)}>{t('Delete')}</Text>
              </View>
            </View>
          ))}
        </View>
      )}
      {!!message && <Text style={{ color: colors.text, fontSize: 12, marginTop: 6 }}>{message}</Text>}
    </View>
  );
}

// ---------- plans ----------
// the plan of every court (Trial period / Official partner), its dates, earlier periods, and requests to renew or stop
export function PlanBox({ facilityIds, courtId }: { facilityIds: string[]; courtId?: string }) {
  const { t } = useT();
  const req = useRequestId();
  const [loaded, setLoaded] = useState(false);
  const [plans, setPlans] = useState<Record<string, Plan>>({});
  const [courts, setCourts] = useState<any[]>([]);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [requests, setRequests] = useState<PlanRequest[]>([]);
  const [openHistory, setOpenHistory] = useState<Record<string, boolean>>({});
  const [asking, setAsking] = useState<{ courtId: string; kind: 'renew' | 'stop' } | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const days = (n: number) => (n === 1 ? t('1 day') : t('{n} days', { n }));
  const planName = (p: string) => t(PLAN_NAMES[p] || p);
  const idsKey = facilityIds.join(',');

  const load = useCallback(async () => {
    setPlans(await loadPlans());
    if (!idsKey) { setCourts([]); return setLoaded(true); }
    const { data } = await supabase.from('courts').select('id, name, is_approved, is_active, facility:facilities ( id, name, city )')
      .in('facility_id', idsKey.split(',')).eq(courtId ? 'id' : 'is_active', courtId ?? true).order('created_at', { ascending: true });
    const list = (data as any[]) || [];
    setCourts(list);
    const ids = list.map((c) => c.id);
    if (ids.length) {
      const [p, r] = await Promise.all([
        supabase.from('court_subscriptions').select('*').in('court_id', ids).order('starts_at', { ascending: false }),
        supabase.from('court_plan_requests').select('*').in('court_id', ids).order('created_at', { ascending: false }),
      ]);
      setPeriods((p.data as Period[]) || []);
      setRequests((r.data as PlanRequest[]) || []);
    }
    setLoaded(true);
  }, [idsKey, courtId]);
  useEffect(() => { load(); }, [load]);

  async function send() {
    if (!asking) return;
    setBusy(true);
    setMessage('');
    const { error } = await supabase.rpc('request_court_plan', { p_request_id: req.get(), p_court_id: asking.courtId, p_kind: asking.kind, p_note: note });
    setBusy(false);
    if (error) return setMessage(`❌ ${error.message}`);
    req.done();
    setMessage(asking.kind === 'renew' ? `📨 ${t('Renewal request sent. Zaf Play will review it soon.')}` : `📨 ${t('Request to stop sent. The court keeps taking bookings until Zaf Play approves it.')}`);
    setAsking(null);
    setNote('');
    load();
  }

  async function withdraw(id: string) {
    setBusy(true);
    setMessage('');
    const { error } = await supabase.rpc('withdraw_court_plan_request', { p_request_id: id });
    setBusy(false);
    if (error) return setMessage(`❌ ${error.message}`);
    setMessage(t('Request withdrawn.'));
    load();
  }

  if (!loaded) return <Muted>{t('Loading the plan…')}</Muted>;
  const trial = plans.trial;
  const partner = plans.partner;

  return (
    <View>
      {!courtId && (
        <Box>
          <Text style={{ color: colors.text, fontWeight: '800', marginBottom: 4 }}>{t('How court plans work')}</Text>
          {trial && <Text style={{ color: colors.text, fontSize: 13 }}>• <Text style={{ fontWeight: '800' }}>{t(trial.name)}</Text>: {t('Zaf Play keeps {p}% of each booking for {m} months. It starts automatically when a court is approved.', { p: trial.commission_percent, m: trial.months })}</Text>}
          {partner && <Text style={{ color: colors.text, fontSize: 13 }}>• <Text style={{ fontWeight: '800' }}>{t(partner.name)}</Text>: {t('{p}% of each booking, {m} months at a time. Send a renewal request before the current period ends.', { p: partner.commission_percent, m: partner.months })}</Text>}
          <Text style={{ color: colors.text, fontSize: 13 }}>• {t("When a court's plan ends (or you stop it), players can't book it any more. Bookings already made stay booked.")}</Text>
          <Text style={{ color: colors.text, fontSize: 13 }}>• {t('Each court has its own plan, so you can keep some courts and stop others.')}</Text>
        </Box>
      )}
      {!!message && <Text style={{ color: colors.text, marginBottom: 8 }}>{message}</Text>}
      {!courtId && courts.length === 0 && <Muted>{t('No courts yet.')}</Muted>}
      {courts.map((c) => {
        const mine = periods.filter((p) => p.court_id === c.id);
        const reqs = requests.filter((r) => r.court_id === c.id);
        const s = courtPlanSummary(mine);
        const pending = reqs.find((r) => r.status === 'pending');
        const lastReviewed = reqs.find((r) => r.status !== 'pending');
        const declined = lastReviewed?.status === 'rejected' && !mine.some((p) => new Date(p.created_at) > new Date(lastReviewed.reviewed_at || lastReviewed.created_at)) ? lastReviewed : null;
        const canRenew = c.is_approved && !pending && !s.upcoming;
        const canStop = c.is_approved && !pending && s.isLive;
        const history = [...mine].sort((a, z) => new Date(z.starts_at).getTime() - new Date(a.starts_at).getTime());
        return (
          <View key={c.id} style={courtId ? undefined : { borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: 12, marginBottom: 10 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
              <Text style={{ color: colors.text, fontWeight: '800', flex: 1 }}>{courtId ? t('Plan') : `${c.name} · ${c.facility?.name}`}</Text>
              <Badge tone={!c.is_approved ? 'warn' : s.isLive ? 'ok' : 'bad'} text={!c.is_approved ? t('Waiting for approval') : s.isLive ? t('Taking bookings') : t('Off')} />
            </View>
            {!c.is_approved ? (
              <Muted>{t('Waiting for approval — the {plan} starts when Zaf Play approves this court.', { plan: t(trial?.name || 'Trial period') })}</Muted>
            ) : s.current ? (
              <Text style={{ color: colors.text, fontSize: 13 }}>
                <Text style={{ fontWeight: '800' }}>{planName(s.current.plan)}</Text> · {Number(s.current.commission_percent)}% · {planDate(s.current.starts_at)} → {planDate(s.current.ends_at)}
                <Text style={{ color: colors.muted }}> ({t('{d} left', { d: days(Math.max(0, Math.ceil((new Date(s.current.ends_at).getTime() - Date.now()) / 86400000))) })})</Text>
              </Text>
            ) : <Text style={{ color: colors.danger, fontSize: 13 }}>{t("No running plan — players can't book this court.")}</Text>}
            {s.upcoming && (
              <Text style={{ color: colors.text, fontSize: 13 }}>{t('Next:')} <Text style={{ fontWeight: '800' }}>{planName(s.upcoming.plan)}</Text> · {Number(s.upcoming.commission_percent)}% · {planDate(s.upcoming.starts_at)} → {planDate(s.upcoming.ends_at)}</Text>
            )}
            {s.endingSoon && !pending && (
              <Box tone="warn" style={{ marginTop: 8, marginBottom: 0 }}>
                <Text style={{ color: colors.noteText, fontSize: 13 }}>{t("This court's plan ends in {d} ({date}). Send a renewal request to keep it bookable.", { d: days(s.daysLeft), date: planDate(s.until) })}</Text>
              </Box>
            )}
            {pending && (
              <View style={{ marginTop: 8 }}>
                <Text style={{ color: colors.primaryAlt, fontSize: 13 }}>
                  📨 {pending.kind === 'renew' ? t('Renewal as {plan} requested', { plan: planName(pending.plan || 'partner') }) : t('Request to stop this court sent')} {t('on {date} — waiting for Zaf Play.', { date: planDate(pending.created_at) })}
                </Text>
                <LinkButton title={t('Withdraw')} onPress={() => withdraw(pending.id)} disabled={busy} />
              </View>
            )}
            {declined && (
              <Text style={{ color: colors.danger, fontSize: 13, marginTop: 6 }}>
                {t(declined.kind === 'renew' ? 'Your request to renew this court was declined' : 'Your request to stop this court was declined')}{declined.reject_reason ? `: ${declined.reject_reason}` : '.'}
              </Text>
            )}
            {asking && asking.courtId === c.id ? (
              <View style={{ marginTop: 8 }}>
                <Text style={{ color: colors.text, fontWeight: '700', marginBottom: 4 }}>
                  {asking.kind === 'renew'
                    ? t('Renew {court} as {plan} ({p}% for {m} months)?', { court: c.name, plan: t(partner?.name || 'Official partner'), p: partner?.commission_percent ?? 15, m: partner?.months ?? 3 })
                    : t('Stop {court}?', { court: c.name })}
                </Text>
                <Muted style={{ fontSize: 12, marginBottom: 8 }}>
                  {asking.kind === 'renew'
                    ? s.isLive ? t('Once approved, it starts on {date}, right after the current period.', { date: planDate(s.until) }) : t('Once approved, it starts right away and players can book the court again.')
                    : t('Once approved, players can no longer book this court. Bookings already made stay booked.')}
                </Muted>
                <Field label={t('Note for Zaf Play (optional)')} value={note} onChangeText={setNote} />
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <View style={{ flex: 1 }}><Button small title={busy ? t('Sending...') : t('Send request')} onPress={send} loading={busy} /></View>
                  <View style={{ flex: 1 }}><Button small variant="ghost" title={t('Cancel')} onPress={() => setAsking(null)} /></View>
                </View>
              </View>
            ) : (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 }}>
                {canRenew && <LinkButton title={t(s.isLive ? 'Request renewal as {plan}' : 'Request to restart as {plan}', { plan: t(partner?.name || 'Official partner') })} onPress={() => { setAsking({ courtId: c.id, kind: 'renew' }); setNote(''); setMessage(''); }} />}
                {canStop && <LinkButton danger title={t('Stop this court')} onPress={() => { setAsking({ courtId: c.id, kind: 'stop' }); setNote(''); setMessage(''); }} />}
                {(history.length > 0 || reqs.length > 0) && <LinkButton title={openHistory[c.id] ? t('Hide history') : t('Show history')} onPress={() => setOpenHistory((h) => ({ ...h, [c.id]: !h[c.id] }))} />}
              </View>
            )}
            {openHistory[c.id] && (
              <View style={{ marginTop: 6 }}>
                {history.map((p) => {
                  const st = periodState(p);
                  return (
                    <Muted key={p.id} style={{ fontSize: 12 }}>
                      {planName(p.plan)} · {Number(p.commission_percent)}% · {planDate(p.starts_at)} → {planDate(effectiveEnd(p))} · {t(STATE_LABEL[st])}
                      {p.end_reason && (st === 'stopped' || st === 'cancelled') ? ` — ${p.end_reason}` : ''}
                    </Muted>
                  );
                })}
                {reqs.length > 0 && <Text style={{ color: colors.muted, fontWeight: '700', fontSize: 12, marginTop: 6 }}>{t('Requests')}</Text>}
                {reqs.map((r) => (
                  <Muted key={r.id} style={{ fontSize: 12 }}>
                    {planDate(r.created_at)} · {r.kind === 'renew' ? t('Renew as {plan}', { plan: planName(r.plan || 'partner') }) : t('Stop the court')} · {t(r.status === 'rejected' ? 'declined' : r.status)}{r.reject_reason ? ` — ${r.reject_reason}` : ''}
                  </Muted>
                ))}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

// shown when adding a court: every new court starts on the Trial period, then moves to Official partner
export function PlanNote() {
  const { t } = useT();
  const [plans, setPlans] = useState<Record<string, Plan> | null>(null);
  useEffect(() => { loadPlans().then(setPlans); }, []);
  const trial = plans?.trial;
  const partner = plans?.partner;
  if (!trial || !partner) return null;
  return (
    <Box>
      <Text style={{ color: colors.text, fontWeight: '800', marginBottom: 4 }}>{t('Your plan for this court')}</Text>
      <Text style={{ color: colors.text, fontSize: 13 }}>• <Text style={{ fontWeight: '800' }}>{t(trial.name)}</Text> ({t('default')}): {t('Zaf Play takes {p}% of each booking for {m} months. It starts by itself when Zaf Play approves the court.', { p: trial.commission_percent, m: trial.months })}</Text>
      <Text style={{ color: colors.text, fontSize: 13 }}>• <Text style={{ fontWeight: '800' }}>{t(partner.name)}</Text>: {t('{p}% of each booking, {m} months at a time, after the trial. Ask for it in the Plans tab of your dashboard.', { p: partner.commission_percent, m: partner.months })}</Text>
    </Box>
  );
}

// ---------- map pin ----------
const CAIRO = { lat: 30.0444, lng: 31.2357 };
const AREA_CENTERS: Record<string, { lat: number; lng: number }> = {
  Maadi: { lat: 29.9602, lng: 31.2569 }, Heliopolis: { lat: 30.0915, lng: 31.327 }, 'New Cairo': { lat: 30.0074, lng: 31.4913 },
  'Sheikh Zayed': { lat: 30.0131, lng: 30.9731 }, Smouha: { lat: 31.2156, lng: 29.9441 }, 'El Kawther': { lat: 27.264, lng: 33.812 },
};

// "Where is your branch?": the owner drops a pin so players find the branch with Near me and on the map (saved at once)
export function BranchLocation({ facilityId, area, initial }: { facilityId: string; area: string; initial: { lat: number; lng: number } | null }) {
  const [pos, setPos] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState<'' | 'saving' | 'locating'>('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [region, setRegion] = useState(() => {
    const c = initial ?? AREA_CENTERS[area] ?? CAIRO;
    return { latitude: c.lat, longitude: c.lng, latitudeDelta: initial ? 0.005 : 0.05, longitudeDelta: initial ? 0.005 : 0.05 };
  });
  const moveTo = (c: { lat: number; lng: number }) => {
    setPos(c);
    setRegion({ latitude: c.lat, longitude: c.lng, latitudeDelta: 0.004, longitudeDelta: 0.004 });
  };

  async function useHere() {
    setBusy('locating');
    setMsg(null);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') throw new Error('denied');
      const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const c = { lat: p.coords.latitude, lng: p.coords.longitude };
      if (!isValidCoords(c.lat, c.lng)) throw new Error('outside');
      moveTo(c);
      setMsg({ kind: 'ok', text: 'Pin moved to where you are. Drag it onto the entrance if needed, then save.' });
    } catch {
      setMsg({ kind: 'err', text: 'Could not read your location. Tap the map to drop the pin instead.' });
    }
    setBusy('');
  }

  function readLink() {
    const c = coordsFromMapsUrl(link);
    if (c && isValidCoords(c.lat, c.lng)) {
      moveTo(c);
      setMsg({ kind: 'ok', text: 'Pin placed from your link. Check it, then save.' });
    } else {
      setMsg({ kind: 'err', text: link.trim()
        ? 'This link does not show the position (short links hide it). Tap the map to drop the pin, or open the link, copy the long address from the browser and paste that.'
        : 'Paste a Google Maps link first.' });
    }
  }

  async function save() {
    if (!pos) return;
    setBusy('saving');
    setMsg(null);
    const { error } = await supabase.rpc('set_facility_location', { p_facility_id: facilityId, p_lat: pos.lat, p_lng: pos.lng });
    setBusy('');
    if (error) return setMsg({ kind: 'err', text: error.message });
    setSaved(pos);
    setMsg({ kind: 'ok', text: 'Saved. Players can now find this branch on the map and with Near me.' });
  }

  const changed = !!pos && (!saved || Math.abs(saved.lat - pos.lat) > 1e-6 || Math.abs(saved.lng - pos.lng) > 1e-6);
  return (
    <Box>
      <Text style={{ color: colors.text, fontWeight: '800' }}>📍 Map location</Text>
      <Muted style={{ marginBottom: 8 }}>
        {saved
          ? 'Players see this branch on the map and in Near me. Move the pin if it is not exactly on your branch.'
          : 'No pin yet — players cannot find this branch with Near me or on the map. Drop the pin on your branch.'}
      </Muted>
      <Button small variant="ghost" title={busy === 'locating' ? 'Finding you…' : "📍 I'm at the branch now"} onPress={useHere} disabled={busy !== ''} />
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end', marginTop: 10 }}>
        <View style={{ flex: 1 }}><Field label="…or paste a Google Maps link" value={link} onChangeText={setLink} autoCapitalize="none" autoCorrect={false} /></View>
        <View style={{ marginBottom: 14 }}><Button small variant="ghost" title="Use" onPress={readLink} /></View>
      </View>
      <MapView style={{ height: 260, borderRadius: radius.md }} region={region} onRegionChangeComplete={setRegion}
        onPress={(e) => { setPos({ lat: e.nativeEvent.coordinate.latitude, lng: e.nativeEvent.coordinate.longitude }); setMsg(null); }}>
        {pos && <Marker draggable coordinate={{ latitude: pos.lat, longitude: pos.lng }}
          onDragEnd={(e) => { setPos({ lat: e.nativeEvent.coordinate.latitude, lng: e.nativeEvent.coordinate.longitude }); setMsg(null); }} />}
      </MapView>
      <Muted style={{ fontSize: 12, marginTop: 6, marginBottom: 8 }}>Tap the map to drop the pin, then drag it to adjust.</Muted>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Button small title={busy === 'saving' ? 'Saving...' : 'Save location'} onPress={save} disabled={!changed || busy !== ''} />
        {pos && <Muted style={{ fontSize: 12 }}>{pos.lat.toFixed(5)}, {pos.lng.toFixed(5)}</Muted>}
      </View>
      {msg && <Text style={{ color: msg.kind === 'ok' ? colors.success : colors.danger, marginTop: 8 }}>{msg.text}</Text>}
    </Box>
  );
}

// the areas a branch can be in (managed by Zaf Play), as chips
export function AreaPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useT();
  const [areas, setAreas] = useState<string[]>([]);
  useEffect(() => {
    Promise.all([
      supabase.from('cities').select('name').eq('is_active', true),
      supabase.from('areas').select('name, city').eq('is_active', true).order('name'),
    ]).then(([c, a]) => {
      const cities = new Set(((c.data as any[]) || []).map((x) => x.name));
      setAreas(((a.data as any[]) || []).filter((x) => cities.has(x.city)).map((x) => x.name).sort());
    });
  }, []);
  const list = value && areas.length && !areas.includes(value) ? [...areas, value] : areas;
  return (
    <View style={{ marginBottom: 8 }}>
      <Muted>{t('Area')}</Muted>
      <Chips>{list.map((a) => <Chip key={a} label={a} on={value === a} onPress={() => onChange(a)} />)}</Chips>
    </View>
  );
}
