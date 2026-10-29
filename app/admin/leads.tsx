import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, View } from 'react-native';
import { Stack } from 'expo-router';
import { Text } from '@/components/AppText';
import { supabase } from '@/lib/supabase';
import { cairoDate, dateTimeText } from '@/lib/format';
import { colors } from '@/lib/theme';
import { Card, Line } from '@/components/admin';
import { DateTimeField } from '@/components/DateTimeField';
import { Badge, Box, Chip, Chips, H2, LinkButton, Loading, Muted, Pager, PAGE_SIZE } from '@/components/owner';
import { Button, Field } from '@/components/ui';

const STATUSES = [
  { v: 'new', label: 'New', tone: 'neutral' },
  { v: 'contacted', label: 'Contacted', tone: 'info' },
  { v: 'meeting_set', label: 'Meeting set', tone: 'info' },
  { v: 'met', label: 'Met', tone: 'info' },
  { v: 'negotiating', label: 'Negotiating', tone: 'warn' },
  { v: 'signed', label: 'Signed', tone: 'ok' },
  { v: 'on_hold', label: 'On hold', tone: 'neutral' },
  { v: 'not_interested', label: 'Not interested', tone: 'bad' },
] as const;
const STATUS = Object.fromEntries(STATUSES.map((s) => [s.v, s])) as Record<string, (typeof STATUSES)[number]>;
const INTEREST: Record<string, { label: string; tone: 'neutral' | 'ok' | 'warn' | 'bad'; pick: string }> = {
  unknown: { label: 'Interest ?', tone: 'neutral', pick: 'Don’t know yet' },
  hot: { label: 'Interested 🔥', tone: 'ok', pick: 'Interested' },
  warm: { label: 'Maybe', tone: 'warn', pick: 'Maybe' },
  cold: { label: 'Not interested', tone: 'bad', pick: 'Not interested' },
};
const KINDS = [
  { v: 'note', label: 'Note' }, { v: 'call', label: 'Call' }, { v: 'whatsapp', label: 'WhatsApp' },
  { v: 'visit', label: 'Visit' }, { v: 'meeting', label: 'Meeting' }, { v: 'email', label: 'Email' },
];
const CLOSED = ['signed', 'not_interested'];

type Lead = {
  id: string; business_name: string; contact_name: string | null; phone: string | null; email: string | null; instagram: string | null;
  city: string | null; area: string | null; sports: string | null; courts_count: number | null; source: string | null; status: string;
  interest: string; meeting_at: string | null; meeting_place: string | null; next_follow_up: string | null; notes: string | null;
  updated_at: string; created_at: string;
};
const EMPTY = {
  business_name: '', contact_name: '', phone: '', email: '', instagram: '', city: '', area: '', sports: '',
  courts_count: '', source: '', status: 'new', interest: 'unknown', meeting_at: '', meeting_place: '', next_follow_up: '', notes: '',
};
type Form = typeof EMPTY;

const fromLead = (l: Lead): Form => ({
  business_name: l.business_name, contact_name: l.contact_name || '', phone: l.phone || '', email: l.email || '',
  instagram: l.instagram || '', city: l.city || '', area: l.area || '', sports: l.sports || '',
  courts_count: l.courts_count == null ? '' : String(l.courts_count), source: l.source || '', status: l.status,
  interest: l.interest, meeting_at: l.meeting_at || '', meeting_place: l.meeting_place || '', next_follow_up: l.next_follow_up || '', notes: l.notes || '',
});
function toRow(f: Form) {
  const t = (v: string) => (v.trim() === '' ? null : v.trim());
  return {
    business_name: f.business_name.trim(), contact_name: t(f.contact_name), phone: t(f.phone), email: t(f.email),
    instagram: t(f.instagram), city: t(f.city), area: t(f.area), sports: t(f.sports),
    courts_count: f.courts_count === '' ? null : Number(f.courts_count), source: t(f.source), status: f.status,
    interest: f.interest, meeting_at: f.meeting_at || null, meeting_place: t(f.meeting_place), next_follow_up: f.next_follow_up || null, notes: t(f.notes),
  };
}
const cairoDay = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
const shortDay = (ymd: string) => new Date(`${ymd}T12:00:00`).toLocaleDateString('en-GB', { timeZone: 'Africa/Cairo', day: 'numeric', month: 'short' });

// Owner leads, like the website's admin page: potential court owners, when you meet, where the deal stands,
// and everything you did.
export default function AdminLeads() {
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [filter, setFilter] = useState('open');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [form, setForm] = useState<Form | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [statusFor, setStatusFor] = useState<string | null>(null);
  const [activities, setActivities] = useState<any[]>([]);
  const [note, setNote] = useState({ kind: 'note', body: '' });
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const scroll = useRef<ScrollView>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('owner_leads').select('*').order('updated_at', { ascending: false });
    if (error) return setMsg(error.message);
    setLeads((data as Lead[]) || []);
  }, []);
  const loadActivities = useCallback(async (id: string) => {
    const { data } = await supabase.from('owner_lead_activities').select('id, kind, body, happened_at').eq('lead_id', id).order('happened_at', { ascending: false });
    setActivities((data as any[]) || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const all = leads || [];
  const today = cairoDate();
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    all.forEach((l) => (c[l.status] = (c[l.status] || 0) + 1));
    return c;
  }, [all]);
  const due = all.filter((l) => !CLOSED.includes(l.status) && ((l.next_follow_up && l.next_follow_up <= today) || (l.meeting_at && cairoDay(l.meeting_at) === today)));
  const shown = all.filter((l) => {
    if (filter === 'open' && CLOSED.includes(l.status)) return false;
    if (filter !== 'open' && filter !== 'all' && l.status !== filter) return false;
    const q = search.trim().toLowerCase();
    return !q || [l.business_name, l.contact_name, l.phone, l.email, l.area, l.city, l.sports, l.instagram].filter(Boolean).some((x) => String(x).toLowerCase().includes(q));
  });
  const paged = shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const open = (id: string | null) => { setOpenId(id); setConfirmDelete(null); if (id) loadActivities(id); };

  async function save() {
    if (!form) return;
    if (form.business_name.trim().length < 2) return setMsg('❌ Please enter the club / court name.');
    if (form.next_follow_up && !/^\d{4}-\d{2}-\d{2}$/.test(form.next_follow_up)) return setMsg('❌ Write the follow-up date as YYYY-MM-DD.');
    setBusy(true);
    setMsg('');
    const row = toRow(form);
    const { data, error } = editingId
      ? await supabase.from('owner_leads').update(row).eq('id', editingId).select('id').single()
      : await supabase.from('owner_leads').insert(row).select('id').single();
    setBusy(false);
    if (error) return setMsg(`❌ ${error.message}`);
    setMsg(editingId ? '✅ Saved.' : '✅ Added.');
    setForm(null);
    setEditingId(null);
    await load();
    if (data?.id) open(data.id);
  }

  async function quickStatus(l: Lead, status: string) {
    setStatusFor(null);
    await supabase.from('owner_leads').update({ status }).eq('id', l.id);
    load();
    if (openId === l.id) loadActivities(l.id);
  }

  async function addNote(leadId: string) {
    if (!note.body.trim()) return;
    setBusy(true);
    const { error } = await supabase.from('owner_lead_activities').insert({ lead_id: leadId, kind: note.kind, body: note.body.trim() });
    if (!error) await supabase.from('owner_leads').update({ updated_at: new Date().toISOString() }).eq('id', leadId);
    setBusy(false);
    if (error) return setMsg(`❌ ${error.message}`);
    setNote({ kind: note.kind, body: '' });
    loadActivities(leadId);
    load();
  }

  async function remove(l: Lead) {
    await supabase.from('owner_leads').delete().eq('id', l.id);
    if (openId === l.id) setOpenId(null);
    load();
  }

  const F = (k: keyof Form, label: string, props: Record<string, unknown> = {}) => (
    <Field label={label} value={form![k]} onChangeText={(v) => setForm({ ...form!, [k]: v })} {...props} />
  );

  return (
    <>
      <Stack.Screen options={{ title: 'Owner leads' }} />
      <ScrollView ref={scroll} contentContainerStyle={{ padding: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        {!form && <Button small title="+ Add potential owner" onPress={() => { setForm({ ...EMPTY }); setEditingId(null); }} />}
        {!!msg && <Text style={{ color: colors.text, marginVertical: 8 }}>{msg}</Text>}

        {form && (
          <Box>
            <H2>{editingId ? `Edit ${form.business_name}` : 'Add potential owner'}</H2>
            {F('business_name', 'Club / court name *')}
            {F('contact_name', 'Contact person')}
            {F('phone', 'Phone / WhatsApp', { keyboardType: 'phone-pad' })}
            {F('email', 'Email', { keyboardType: 'email-address', autoCapitalize: 'none' })}
            {F('instagram', 'Instagram', { autoCapitalize: 'none' })}
            {F('city', 'City')}
            {F('area', 'Area')}
            {F('sports', 'Sports (e.g. Padel, Tennis)')}
            {F('courts_count', 'Number of courts', { keyboardType: 'number-pad' })}
            {F('source', 'How you found them (Google Maps, friend…)')}
            <Muted>Deal status</Muted>
            <Chips>{STATUSES.map((s) => <Chip key={s.v} label={s.label} on={form.status === s.v} onPress={() => setForm({ ...form, status: s.v })} />)}</Chips>
            <Muted>Are they interested?</Muted>
            <Chips>{Object.entries(INTEREST).map(([v, it]) => <Chip key={v} label={it.pick} on={form.interest === v} onPress={() => setForm({ ...form, interest: v })} />)}</Chips>
            {form.meeting_at ? (
              <>
                <DateTimeField label="Meeting (date & time)" value={new Date(form.meeting_at)} onChange={(d) => setForm({ ...form, meeting_at: d.toISOString() })} />
                <LinkButton title="No meeting" onPress={() => setForm({ ...form, meeting_at: '' })} />
              </>
            ) : <LinkButton title="+ Add a meeting" onPress={() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(12, 0, 0, 0); setForm({ ...form, meeting_at: d.toISOString() }); }} />}
            {F('meeting_place', 'Meeting place')}
            {F('next_follow_up', 'Next follow-up (YYYY-MM-DD)', { keyboardType: 'numbers-and-punctuation' })}
            {F('notes', 'Notes', { multiline: true, placeholder: 'Prices they charge, empty hours, what they worry about...' })}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}><Button small title={editingId ? 'Save' : 'Add'} onPress={save} loading={busy} /></View>
              <View style={{ flex: 1 }}><Button small variant="ghost" title="Cancel" onPress={() => { setForm(null); setEditingId(null); }} /></View>
            </View>
          </Box>
        )}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 8 }}>
          {[{ v: 'open', label: 'Open deals' }, ...STATUSES, { v: 'all', label: 'All' }].map((s) => {
            const n = s.v === 'open' ? all.filter((l) => !CLOSED.includes(l.status)).length : s.v === 'all' ? all.length : counts[s.v] || 0;
            return <Chip key={s.v} label={`${s.label} ${n}`} on={filter === s.v} onPress={() => { setFilter(s.v); setPage(1); }} />;
          })}
        </ScrollView>

        {due.length > 0 && (
          <Card tone="warn">
            <Line bold>Today</Line>
            {due.map((l) => (
              <Line key={l.id}>
                <Text style={{ textDecorationLine: 'underline', fontWeight: '700' }} onPress={() => open(l.id)}>{l.business_name}</Text>
                {l.meeting_at && cairoDay(l.meeting_at) === today ? ` — meeting ${dateTimeText(l.meeting_at)}${l.meeting_place ? ` at ${l.meeting_place}` : ''}` : ''}
                {l.next_follow_up && l.next_follow_up <= today ? ` — follow up${l.next_follow_up < today ? ' (overdue)' : ''}` : ''}
              </Line>
            ))}
          </Card>
        )}

        <Field label="Search" value={search} onChangeText={(v) => { setSearch(v); setPage(1); }} placeholder="Name, phone, area, sport..." />
        {leads === null ? <Loading /> : shown.length === 0 ? <Muted>{all.length === 0 ? 'No potential owners yet. Add the first one.' : 'Nothing here.'}</Muted> : paged.map((l) => {
          const st = STATUS[l.status];
          const it = INTEREST[l.interest] || INTEREST.unknown;
          const isOpen = openId === l.id;
          return (
            <Card key={l.id}>
              <Pressable accessibilityRole="button" onPress={() => open(isOpen ? null : l.id)}>
                <Line bold size={15}>{l.business_name}</Line>
                <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
                  {st && <Badge tone={st.tone} text={st.label} />}
                  <Badge tone={it.tone} text={it.label} />
                </View>
                <Line muted>{[l.contact_name, l.phone, [l.area, l.city].filter(Boolean).join(', '), l.sports, l.courts_count != null ? `${l.courts_count} courts` : null].filter(Boolean).join(' · ') || '—'}</Line>
                <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
                  {l.meeting_at ? `Meeting ${dateTimeText(l.meeting_at)}${l.meeting_place ? ` at ${l.meeting_place}` : ''} · ` : ''}
                  {l.next_follow_up ? <Text style={l.next_follow_up < today ? { color: colors.danger, fontWeight: '700' } : undefined}>Follow up {shortDay(l.next_follow_up)} · </Text> : null}
                  Updated {new Date(l.updated_at).toLocaleDateString('en-GB', { timeZone: 'Africa/Cairo', day: 'numeric', month: 'short' })}
                </Text>
              </Pressable>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 }}>
                {!!l.phone && <LinkButton title="WhatsApp" onPress={() => Linking.openURL(`https://wa.me/2${l.phone!.replace(/\D/g, '')}`)} />}
                <LinkButton title="Change status" onPress={() => setStatusFor(statusFor === l.id ? null : l.id)} />
                <LinkButton title="Edit" onPress={() => { setForm(fromLead(l)); setEditingId(l.id); scroll.current?.scrollTo({ y: 0, animated: true }); }} />
              </View>
              {statusFor === l.id && <Chips>{STATUSES.map((s) => <Chip key={s.v} label={s.label} on={l.status === s.v} onPress={() => quickStatus(l, s.v)} />)}</Chips>}
              {isOpen && (
                <View style={{ marginTop: 10, borderTopWidth: 1, borderColor: colors.border, paddingTop: 10 }}>
                  {!!l.email && <Line>Email: <Text style={{ textDecorationLine: 'underline' }} onPress={() => Linking.openURL(`mailto:${l.email}`)}>{l.email}</Text></Line>}
                  {!!l.instagram && <Line>Instagram: {l.instagram}</Line>}
                  {!!l.source && <Line>Found via: {l.source}</Line>}
                  {!!l.notes && <Line>{'\n'}{l.notes}</Line>}
                  <Line muted size={12}>Added {new Date(l.created_at).toLocaleDateString('en-GB', { timeZone: 'Africa/Cairo', day: 'numeric', month: 'short', year: 'numeric' })}</Line>
                  {confirmDelete === l.id ? (
                    <View style={{ flexDirection: 'row' }}>
                      <LinkButton title={`Yes, delete ${l.business_name} and its history`} onPress={() => remove(l)} />
                      <LinkButton title="No" onPress={() => setConfirmDelete(null)} />
                    </View>
                  ) : <LinkButton title="Delete" onPress={() => setConfirmDelete(l.id)} />}

                  <View style={{ marginTop: 10 }}><Line bold>What you did</Line></View>
                  <Chips>{KINDS.map((k) => <Chip key={k.v} label={k.label} on={note.kind === k.v} onPress={() => setNote({ ...note, kind: k.v })} />)}</Chips>
                  <Field label="Add to the history" value={note.body} onChangeText={(v) => setNote({ ...note, body: v })} returnKeyType="done" onSubmitEditing={() => addNote(l.id)}
                    placeholder="e.g. Sent the WhatsApp script, he asked about the 10%" />
                  <Button small title="Add" onPress={() => addNote(l.id)} disabled={busy || !note.body.trim()} />
                  {activities.length === 0 ? <Muted style={{ marginTop: 8 }}>Nothing yet.</Muted> : activities.map((a) => (
                    <View key={a.id} style={{ flexDirection: 'row', marginTop: 8 }}>
                      <Text style={{ color: colors.muted, fontSize: 12, width: 92 }}>
                        {new Date(a.happened_at).toLocaleString('en-GB', { timeZone: 'Africa/Cairo', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).replace(/am|pm/, (x) => x.toUpperCase())}
                      </Text>
                      <Text style={{ color: colors.text, flex: 1 }}><Text style={{ color: colors.muted, fontWeight: '700' }}>{a.kind[0].toUpperCase() + a.kind.slice(1)} · </Text>{a.body}</Text>
                    </View>
                  ))}
                </View>
              )}
            </Card>
          );
        })}
        <Pager page={page} total={shown.length} onChange={setPage} />
      </ScrollView>
    </>
  );
}
