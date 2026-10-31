import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import type { ScrollViewInstance } from 'react-native';
import { Stack } from 'expo-router';
import { Text } from '@/components/AppText';
import { SITE_URL, supabase } from '@/lib/supabase';
import { cairoDate } from '@/lib/format';
import { searchMatches } from '@/lib/courtTimes';
import { colors } from '@/lib/theme';
import { Card, Line } from '@/components/admin';
import { Tile } from '@/components/revenue';
import { Badge, Box, Chip, Chips, H2, LinkButton, Loading, Muted, Pager, PAGE_SIZE } from '@/components/owner';
import { Button, Field } from '@/components/ui';

const CATEGORIES = ['Software', 'Domain & hosting', 'Marketing', 'Design', 'Legal & fees', 'Equipment', 'Other'];
const BILLING: Record<string, string> = { once: 'One time', monthly: 'Monthly', yearly: 'Yearly' };

type Expense = {
  id: string; item: string; category: string; amount: number; currency: 'USD' | 'EGP'; usd_egp_rate: number;
  amount_usd: number; amount_egp: number; paid_on: string; billing: 'once' | 'monthly' | 'yearly'; renews_on: string | null; note: string | null;
};

const usd = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n) || 0);
const egpTxt = (n: number) => `${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0)} EGP`;
const dateTxt = (d: string | null) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { timeZone: 'Africa/Cairo', day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const isDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);

function addPeriod(date: string, billing: string) {
  if (!isDate(date) || billing === 'once') return '';
  const d = new Date(`${date}T12:00:00`);
  if (billing === 'monthly') d.setMonth(d.getMonth() + 1);
  else d.setFullYear(d.getFullYear() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const daysUntil = (d: string) => Math.round((new Date(`${d}T12:00:00`).getTime() - new Date(`${cairoDate()}T12:00:00`).getTime()) / 86400000);

const EMPTY = { item: '', category: 'Software', amount: '', currency: 'USD' as 'USD' | 'EGP', rate: '', paid_on: '', billing: 'once' as 'once' | 'monthly' | 'yearly', renews_on: '', note: '' };

// Zaf Play's own costs, like the website's admin Expenses: in USD or EGP with the day's rate, renew dates
// coming up, and totals.
export default function AdminExpenses() {
  const [rows, setRows] = useState<Expense[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [todayRate, setTodayRate] = useState<number | null>(null);
  const [form, setForm] = useState({ ...EMPTY, paid_on: cairoDate() });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false); // blocks a fast double tap before the button disables
  const [msg, setMsg] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const scroll = useRef<ScrollViewInstance>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('project_expenses').select('*').order('paid_on', { ascending: false });
    if (error) {
      if (/project_expenses|does not exist|schema cache/i.test(error.message)) setMissing(true);
      else setMsg(error.message);
      return;
    }
    setRows((data as Expense[]) || []);
  }, []);
  useEffect(() => {
    load();
    fetch(`${SITE_URL}/api/usd-egp`).then((r) => r.json()).then((j) => {
      if (!j.rate) return;
      setTodayRate(Number(j.rate));
      setForm((f) => (f.rate ? f : { ...f, rate: String(j.rate) }));
    }).catch(() => {});
  }, [load]);

  function set<K extends keyof typeof EMPTY>(k: K, v: (typeof EMPTY)[K]) {
    setForm((f) => {
      const next = { ...f, [k]: v };
      if (k === 'paid_on' || k === 'billing') next.renews_on = addPeriod(next.paid_on, next.billing);
      return next;
    });
  }

  function reset() {
    setEditingId(null);
    setForm({ ...EMPTY, paid_on: cairoDate(), rate: todayRate ? String(todayRate) : '' });
  }

  async function save() {
    setMsg('');
    const amount = Number(form.amount);
    const rate = Number(form.rate);
    if (form.item.trim().length < 2 || !(amount > 0) || !(rate > 0) || !isDate(form.paid_on)) return setMsg('Fill in what it was, the amount, the date and the rate.');
    if (form.renews_on && !isDate(form.renews_on)) return setMsg('Write the renew date as YYYY-MM-DD, or leave it empty.');
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    const body = { item: form.item.trim(), category: form.category, amount, currency: form.currency, usd_egp_rate: rate, paid_on: form.paid_on,
      billing: form.billing, renews_on: form.renews_on || null, note: form.note.trim() || null };
    const { error } = editingId ? await supabase.from('project_expenses').update(body).eq('id', editingId) : await supabase.from('project_expenses').insert(body);
    savingRef.current = false;
    setSaving(false);
    if (error) return setMsg(error.message);
    setMsg(editingId ? 'Saved.' : 'Added.');
    reset();
    load();
  }

  function edit(x: Expense) {
    setEditingId(x.id);
    setConfirmId(null);
    setForm({ item: x.item, category: x.category, amount: String(x.amount), currency: x.currency, rate: String(x.usd_egp_rate),
      paid_on: x.paid_on, billing: x.billing, renews_on: x.renews_on || '', note: x.note || '' });
    setMsg('');
    scroll.current?.scrollToEnd({ animated: true });
  }

  async function remove(id: string) {
    const { error } = await supabase.from('project_expenses').delete().eq('id', id);
    setConfirmId(null);
    if (error) setMsg(error.message);
    else load();
  }

  if (missing) return <><Stack.Screen options={{ title: 'Expenses' }} /><Muted style={{ padding: 16 }}>Expenses aren&apos;t switched on in the database yet.</Muted></>;
  const all = rows || [];
  const found = all.filter((x) => !search.trim() || searchMatches(search, [x.item, x.category, x.note, x.paid_on, x.currency].filter(Boolean).join(' ')));
  const paged = found.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const totalUsd = all.reduce((a, x) => a + Number(x.amount_usd), 0);
  const totalEgp = all.reduce((a, x) => a + Number(x.amount_egp), 0);
  const month = cairoDate().slice(0, 7);
  const monthEgp = all.filter((x) => x.paid_on.startsWith(month)).reduce((a, x) => a + Number(x.amount_egp), 0);
  const upcoming = all.filter((x) => x.renews_on).map((x) => ({ x, d: daysUntil(x.renews_on as string) })).sort((a, b) => a.d - b.d);
  const fAmount = Number(form.amount) || 0;
  const fRate = Number(form.rate) || 0;
  const preview = fAmount && fRate ? (form.currency === 'USD' ? `= ${egpTxt(fAmount * fRate)}` : `= ${usd(fAmount / fRate)}`) : '';

  return (
    <>
      <Stack.Screen options={{ title: 'Expenses' }} />
      <ScrollView ref={scroll} contentContainerStyle={{ padding: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        {rows === null ? <Loading /> : (
          <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4, marginBottom: 12 }}>
              <Tile label="Total spent" value={egpTxt(totalEgp)} sub={usd(totalUsd)} strong />
              <Tile label="This month" value={egpTxt(monthEgp)} />
              <Tile label="Today's rate" value={todayRate ? `1 USD = ${todayRate.toFixed(2)}` : '—'} />
            </View>
            {upcoming.length > 0 && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                {upcoming.map(({ x, d }) => (
                  <Badge key={x.id} tone={d < 0 ? 'bad' : d <= 7 ? 'warn' : 'ok'}
                    text={`${x.item} · ${x.billing === 'monthly' ? 'renews' : 'expires'} ${d < 0 ? `${-d} days ago` : d === 0 ? 'today' : `in ${d} days`} (${dateTxt(x.renews_on)})`} />
                ))}
              </View>
            )}
            <Field label="Search" value={search} onChangeText={(v) => { setSearch(v); setPage(1); }} placeholder="Item, category, note or date" />
            {all.length === 0 ? <Muted>No expenses yet.</Muted> : paged.map((x) => (
              <Card key={x.id}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: colors.text, fontWeight: '800', flex: 1 }}>{x.item}</Text>
                  <Text style={{ color: colors.text, fontWeight: '700' }}>{egpTxt(x.amount_egp)}</Text>
                </View>
                <Line muted size={12}>{x.category} · {BILLING[x.billing]}{x.note ? ` · ${x.note}` : ''}</Line>
                <Line size={12}>Paid {dateTxt(x.paid_on)} · {usd(x.amount_usd)} · rate {Number(x.usd_egp_rate).toFixed(2)} · paid in {x.currency}</Line>
                {!!x.renews_on && <Line muted size={12}>Renews / expires {dateTxt(x.renews_on)}</Line>}
                <View style={{ flexDirection: 'row', marginTop: 4 }}>
                  {confirmId === x.id ? (
                    <>
                      <LinkButton title="Delete" onPress={() => remove(x.id)} />
                      <LinkButton title="Keep" onPress={() => setConfirmId(null)} />
                    </>
                  ) : (
                    <>
                      <LinkButton title="Edit" onPress={() => edit(x)} />
                      <LinkButton title="Remove" onPress={() => setConfirmId(x.id)} />
                    </>
                  )}
                </View>
              </Card>
            ))}
            {all.length > 0 && <Line bold>Total: {usd(totalUsd)} · {egpTxt(totalEgp)}</Line>}
            <Pager page={page} total={found.length} onChange={setPage} />
          </>
        )}

        <Box>
          <H2>{editingId ? `Edit ${form.item}` : 'Add expense'}</H2>
          <Field label="What" value={form.item} onChangeText={(v) => set('item', v)} maxLength={80} />
          <Muted>Type</Muted>
          <Chips>{CATEGORIES.map((c) => <Chip key={c} label={c} on={form.category === c} onPress={() => set('category', c)} />)}</Chips>
          <Field label="Amount paid" value={form.amount} onChangeText={(v) => set('amount', v.replace(/[^\d.]/g, ''))} keyboardType="decimal-pad" />
          <Chips>{(['USD', 'EGP'] as const).map((c) => <Chip key={c} label={c} on={form.currency === c} onPress={() => set('currency', c)} />)}</Chips>
          {!!preview && <Muted style={{ fontSize: 12, marginBottom: 8 }}>{preview}</Muted>}
          <Field label="EGP for 1 USD that day" value={form.rate} onChangeText={(v) => set('rate', v.replace(/[^\d.]/g, ''))} keyboardType="decimal-pad" />
          <Field label="Paid on (YYYY-MM-DD)" value={form.paid_on} onChangeText={(v) => set('paid_on', v)} keyboardType="numbers-and-punctuation" />
          <Muted>Billing</Muted>
          <Chips>{(['once', 'monthly', 'yearly'] as const).map((b) => <Chip key={b} label={BILLING[b]} on={form.billing === b} onPress={() => set('billing', b)} />)}</Chips>
          <Field label="Renews / expires (YYYY-MM-DD)" value={form.renews_on} onChangeText={(v) => set('renews_on', v)} keyboardType="numbers-and-punctuation" />
          <Field label="Note" value={form.note} onChangeText={(v) => set('note', v)} maxLength={200} />
          <Button title={saving ? 'Saving...' : editingId ? 'Save changes' : 'Add expense'} onPress={save} loading={saving} />
          {!!editingId && <LinkButton title="Cancel" onPress={reset} />}
          {!!msg && <Muted style={{ marginTop: 8 }}>{msg}</Muted>}
        </Box>
      </ScrollView>
    </>
  );
}
