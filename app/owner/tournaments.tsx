import { useCallback, useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Text } from '@/components/AppText';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { dateTimeText, teamSizeText } from '@/lib/format';
import { searchMatches } from '@/lib/courtTimes';
import { useT } from '@/lib/ownerLang';
import { colors, radius } from '@/lib/theme';
import { Badge, Box, Chip, Chips, fmtEGP, LinkButton, Loading, Muted, Pager, PAGE_SIZE, useOwner } from '@/components/owner';
import { DateTimeField } from '@/components/DateTimeField';
import { Button, Field, Note } from '@/components/ui';

const STATUS: Record<string, { text: string; tone: 'warn' | 'bad' | 'ok' | 'info' | 'neutral' }> = {
  pending: { text: 'Waiting for Zaf Play approval', tone: 'warn' },
  rejected: { text: 'Not approved', tone: 'bad' },
  approved: { text: 'Registration', tone: 'ok' },
  closed: { text: 'Registration closed — make the schedule', tone: 'info' },
  scheduled: { text: 'Scheduled', tone: 'info' },
  finished: { text: 'Finished', tone: 'neutral' },
  cancelled: { text: 'Cancelled', tone: 'neutral' },
};

type Form = {
  id: string; court_id: string; sport_id: string; title: string; description: string; team_size: string; max_teams: string; entry_fee: string;
  format: string; match_minutes: string; reg_opens_at: Date; reg_closes_at: Date; starts_at: Date; ends_at: Date;
};

function blank(): Form {
  const open = new Date(Date.now() + 60 * 60000);
  open.setMinutes(0, 0, 0);
  const close = new Date(open.getTime() + 6 * 86400000);
  const start = new Date(close.getTime() + 86400000);
  start.setHours(16, 0, 0, 0);
  const end = new Date(start.getTime() + 5 * 3600000);
  return {
    id: '', court_id: '', sport_id: '', title: '', description: '', team_size: '2', max_teams: '8', entry_fee: '',
    format: 'knockout', match_minutes: '30', reg_opens_at: open, reg_closes_at: close, starts_at: start, ends_at: end,
  };
}

// Owner → Tournaments, like the website: create a tournament on one of your courts (Zaf Play approves it),
// change its time, and run it from its own screen (close registration, make the schedule, enter scores).
export default function OwnerTournaments() {
  const router = useRouter();
  const { access } = useOwner();
  const { t, tm } = useT();
  const canCreate = !!access.manage_branches || !!access.manage_tournaments;
  const [list, setList] = useState<any[] | null>(null);
  const [courts, setCourts] = useState<any[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [moving, setMoving] = useState<{ id: string; starts_at: Date; ends_at: Date; reason: string } | null>(null);
  const [moveErr, setMoveErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [share, setShare] = useState(20);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('owner_tournaments');
    setList((data as any[]) || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('facilities')
        .select('id, name, courts ( id, name, is_approved, is_active, court_sports ( sport:sports ( id, name ) ) )')
        .eq('owner_id', access.owner_id || '')
        .order('name');
      const out: any[] = [];
      ((data as any[]) || []).forEach((f) => {
        if (!access.is_owner && !access.all_branches && !(access.branch_ids || []).includes(f.id)) return;
        (f.courts || []).filter((c: any) => c.is_approved && c.is_active).forEach((c: any) =>
          out.push({ id: c.id, label: `${c.name} (${f.name})`, sports: (c.court_sports || []).map((cs: any) => cs.sport).sort((x: any, y: any) => x.name.localeCompare(y.name)) }));
      });
      setCourts(out.sort((x, y) => x.label.localeCompare(y.label)));
      const { data: st } = await supabase.from('app_settings').select('tournament_zaf_share').maybeSingle();
      if (st) setShare(Number((st as any).tournament_zaf_share));
    })();
  }, []);

  async function move() {
    if (!moving) return;
    setMoveErr('');
    setBusy(true);
    const { error } = await supabase.rpc('change_tournament_time', {
      p_id: moving.id, p_starts_at: moving.starts_at.toISOString(), p_ends_at: moving.ends_at.toISOString(), p_reason: moving.reason,
    });
    setBusy(false);
    if (error) return setMoveErr(error.message);
    setMoving(null);
    setMsg(`✅ ${t('Time changed. Paid teams were emailed: they keep their place at the new time or withdraw with a full refund.')}`);
    load();
  }

  async function save() {
    if (!form) return;
    setBusy(true);
    setMsg('');
    const { error } = await supabase.rpc('save_tournament', {
      p_id: form.id || null, p_court_id: form.court_id || null, p_sport_id: form.sport_id || null,
      p_title: form.title, p_description: form.description, p_team_size: Number(form.team_size), p_max_teams: Number(form.max_teams),
      p_entry_fee: Number(form.entry_fee || 0), p_format: form.format, p_match_minutes: Number(form.match_minutes),
      p_reg_opens_at: form.reg_opens_at.toISOString(), p_reg_closes_at: form.reg_closes_at.toISOString(),
      p_starts_at: form.starts_at.toISOString(), p_ends_at: form.ends_at.toISOString(),
    });
    setBusy(false);
    if (error) return setMsg(`❌ ${error.message}`);
    setForm(null);
    setMsg(`✅ ${t('Sent to Zaf Play for approval. Once approved, players can register and the court is blocked for the tournament time.')}`);
    load();
  }

  if (list === null) return <Loading />;
  const now = new Date();
  const coming = (x: any) => ['approved', 'closed', 'scheduled'].includes(x.status) && new Date(x.ends_at) > now;
  const shown = list.filter((x) => !search.trim() || searchMatches(search, [x.title, x.sport, x.court, x.branch, x.status].join(' ')));
  const court = courts.find((c) => c.id === form?.court_id);
  const fee = Number(form?.entry_fee || 0);
  const maxTeams = Number(form?.max_teams || 0);

  if (form) {
    const set = (patch: Partial<Form>) => setForm({ ...form, ...patch });
    return (
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        <Field label={t('Name (English)')} value={form.title} maxLength={60} onChangeText={(v) => set({ title: v })} placeholder={t('e.g. Smash Arena Summer Cup')} />
        <Muted>{t('Court')}</Muted>
        <Chips>{courts.map((c) => <Chip key={c.id} label={c.label} on={form.court_id === c.id} onPress={() => set({ court_id: c.id, sport_id: '' })} />)}</Chips>
        {!!court && (
          <>
            <Muted>{t('Sport')}</Muted>
            <Chips>{court.sports.map((s: any) => <Chip key={s.id} label={s.name} on={form.sport_id === s.id} onPress={() => set({ sport_id: s.id })} />)}</Chips>
          </>
        )}
        <Muted>{t('Players per team')}</Muted>
        <Chips>
          {[['1', t('1 — singles')], ['2', '2 — 2v2'], ['3', '3 — 3v3']].map(([v, l]) => <Chip key={v} label={l} on={form.team_size === v} onPress={() => set({ team_size: v })} />)}
        </Chips>
        <Field label={t('Maximum teams')} value={form.max_teams} keyboardType="number-pad" onChangeText={(v) => set({ max_teams: v.replace(/\D/g, '') })} />
        <Field label={t('Entry fee per team (EGP, 0 = free)')} value={form.entry_fee} keyboardType="decimal-pad" placeholder={t('e.g. 400')} onChangeText={(v) => set({ entry_fee: v.replace(/[^\d.]/g, '') })} />
        <Muted>{t('Format')}</Muted>
        <Chips>
          <Chip label={t("Knockout (lose once and you're out)")} on={form.format === 'knockout'} onPress={() => set({ format: 'knockout' })} />
          <Chip label={t('Groups of 4, then knockout (6+ teams)')} on={form.format === 'groups'} onPress={() => set({ format: 'groups' })} />
        </Chips>
        <Field label={t('Minutes per match')} value={form.match_minutes} keyboardType="number-pad" onChangeText={(v) => set({ match_minutes: v.replace(/\D/g, '') })} />
        <DateTimeField label={t('Registration opens')} value={form.reg_opens_at} onChange={(d) => set({ reg_opens_at: d })} />
        <DateTimeField label={t('Registration closes')} value={form.reg_closes_at} onChange={(d) => set({ reg_closes_at: d })} />
        <DateTimeField label={t('Tournament starts')} value={form.starts_at} onChange={(d) => set({ starts_at: d })} />
        <DateTimeField label={t('Tournament ends')} value={form.ends_at} onChange={(d) => set({ ends_at: d })} />
        <Field label={t('Details for players (optional)')} value={form.description} maxLength={600} multiline style={{ minHeight: 80, textAlignVertical: 'top' }}
          placeholder={t('Prizes, rules, what to bring...')} onChangeText={(v) => set({ description: v })} />
        {fee > 0 && maxTeams > 0 && (
          <Muted style={{ marginBottom: 6 }}>{t('If all {n} teams join: {total} in entry fees → your share {share}.', { n: maxTeams, total: fmtEGP(fee * maxTeams), share: fmtEGP((fee * maxTeams * (100 - share)) / 100) })}</Muted>
        )}
        <Muted style={{ marginBottom: 12 }}>{t('The court is blocked for players between the start and end time once Zaf Play approves.')}</Muted>
        {!!msg && <Note kind="error">{msg.replace(/^❌ /, '')}</Note>}
        <Button title={busy ? t('Sending...') : t('Send for approval')} onPress={save} loading={busy} />
        <View style={{ marginTop: 8 }}><Button variant="ghost" title={t('Cancel')} onPress={() => { setForm(null); setMsg(''); }} /></View>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
      {canCreate && <View style={{ marginBottom: 10 }}><Button title={t('+ New tournament')} onPress={() => { setMsg(''); setForm(blank()); }} /></View>}
      <Muted style={{ marginBottom: 10 }}>
        {t('Entry fees are paid to Zaf Play and split {a}% to you / {b}% to Zaf Play. Your share is added to your next transfer after the tournament day.', { a: 100 - share, b: share })}
      </Muted>
      {!!msg && <Text style={{ color: colors.text, marginBottom: 10 }}>{msg}</Text>}

      {list.length === 0 ? <Muted>{t('No tournaments yet.')}</Muted> : (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4, marginBottom: 8 }}>
            {[
              { label: t('Played'), n: list.filter((x) => x.status === 'finished' || (['closed', 'scheduled'].includes(x.status) && new Date(x.ends_at) <= now)).length },
              { label: t('Coming up'), n: list.filter(coming).length },
              { label: t('Waiting for approval'), n: list.filter((x) => x.status === 'pending').length },
              { label: t('Created in total'), n: list.length },
            ].map((b) => (
              <View key={b.label} style={{ width: '50%', padding: 4 }}>
                <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: 10, backgroundColor: colors.card }}>
                  <Text style={{ color: colors.text, fontSize: 22, fontWeight: '800' }}>{b.n}</Text>
                  <Muted style={{ fontSize: 12 }}>{b.label}</Muted>
                </View>
              </View>
            ))}
          </View>
          <Muted style={{ marginBottom: 10 }}>{t('Teams paid in coming tournaments:')} {list.filter(coming).reduce((n, x) => n + Number(x.confirmed || 0), 0)}</Muted>
          <Field label={t('Search')} value={search} onChangeText={(v) => { setSearch(v); setPage(1); }} placeholder={t('Search by title, sport, court or status')} />
          {shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((x) => {
            const st = STATUS[x.status] || { text: x.status, tone: 'neutral' as const };
            return (
              <Box key={x.id}>
                <Text style={{ color: colors.text, fontWeight: '800', marginBottom: 4 }}>{x.title}</Text>
                <Badge tone={st.tone} text={t(st.text)} />
                <Text style={{ color: colors.text, fontSize: 13, marginTop: 6 }}>{x.sport} · {t(teamSizeText(x.team_size))} · {x.court} ({x.branch})</Text>
                <Muted style={{ fontSize: 12 }}>
                  {tm(dateTimeText(x.starts_at))} · {t('{a}/{b} teams', { a: x.confirmed, b: x.max_teams })} · {Number(x.entry_fee) > 0 ? `${fmtEGP(x.entry_fee)} / ${t('team')}` : t('free (no fee)')}
                </Muted>
                {!!x.reject_reason && <Text style={{ color: colors.danger, fontSize: 13 }}>{t('Reason:')} {x.reject_reason}</Text>}
                <Teams id={x.id} confirmed={Number(x.confirmed)} max={x.max_teams} />
                <History id={x.id} />
                {moving && moving.id === x.id && (
                  <View style={{ marginTop: 8, borderTopWidth: 1, borderColor: colors.border, paddingTop: 8 }}>
                    <Text style={{ color: colors.text, fontWeight: '800', marginBottom: 8 }}>{t('Change the time')}</Text>
                    <DateTimeField label={t('New start')} value={moving.starts_at} onChange={(d) => setMoving({ ...moving, starts_at: d })} />
                    <DateTimeField label={t('New end')} value={moving.ends_at} onChange={(d) => setMoving({ ...moving, ends_at: d })} />
                    <Field label={t('Why (the teams see this)')} value={moving.reason} maxLength={200} onChangeText={(v) => setMoving({ ...moving, reason: v })} />
                    <Muted style={{ marginBottom: 10 }}>{t('The court must be free at the new time. Paid teams are emailed and can keep their place or withdraw with a full refund.')}</Muted>
                    {!!moveErr && <Note kind="error">{moveErr}</Note>}
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <View style={{ flex: 1 }}><Button small title={busy ? t('Saving...') : t('Change time')} onPress={move} loading={busy} /></View>
                      <View style={{ flex: 1 }}><Button small variant="ghost" title={t('Cancel')} onPress={() => setMoving(null)} /></View>
                    </View>
                  </View>
                )}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 }}>
                  {canCreate && ['pending', 'rejected'].includes(x.status) && (
                    <LinkButton title={t('Edit')} onPress={() => { setMsg(''); setForm({
                      id: x.id, court_id: x.court_id, sport_id: x.sport_id, title: x.title, description: x.description || '',
                      team_size: String(x.team_size), max_teams: String(x.max_teams), entry_fee: String(Number(x.entry_fee)),
                      format: x.format, match_minutes: String(x.match_minutes),
                      reg_opens_at: new Date(x.reg_opens_at), reg_closes_at: new Date(x.reg_closes_at), starts_at: new Date(x.starts_at), ends_at: new Date(x.ends_at),
                    }); }} />
                  )}
                  {canCreate && ['approved', 'closed', 'scheduled'].includes(x.status) && new Date(x.starts_at) > now && moving?.id !== x.id && (
                    <LinkButton title={t('Change time')} onPress={() => { setMoveErr(''); setMoving({ id: x.id, starts_at: new Date(x.starts_at), ends_at: new Date(x.ends_at), reason: '' }); }} />
                  )}
                  <LinkButton title={`${t('Open')} →`} onPress={() => router.push({ pathname: '/tournament/[code]', params: { code: x.code } })} />
                </View>
              </Box>
            );
          })}
          <Pager page={page} total={shown.length} onChange={setPage} />
        </>
      )}
    </ScrollView>
  );
}

const TEAM_STATUS: Record<string, string> = {
  confirmed: 'Paid ✓', review: 'Payment being checked', ready: 'Ready, not paid yet', forming: 'Waiting for teammates', withdrawn: 'Withdrew',
};

// who joined a tournament, their players and payment status
function Teams({ id, confirmed, max }: { id: string; confirmed: number; max: number }) {
  const [teams, setTeams] = useState<any[] | null>(null);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState('');
  async function toggle() {
    setOpen(!open);
    if (!open && !teams) {
      const { data, error } = await supabase.rpc('owner_tournament_teams', { p_id: id });
      if (error) return setErr(error.message);
      setTeams((data as any[]) || []);
    }
  }
  return (
    <View style={{ marginTop: 4 }}>
      <LinkButton title={open ? 'Hide teams' : `Teams (${confirmed} of ${max} paid)`} onPress={toggle} />
      {open && (err ? <Text style={{ color: colors.danger }}>{err}</Text> : !teams ? <Muted>Loading...</Muted> : teams.length === 0 ? <Muted>No teams have joined yet.</Muted> : teams.map((x, i) => (
        <Text key={x.id} style={{ color: x.status === 'withdrawn' ? colors.muted : colors.text, fontSize: 13, marginTop: 3 }}>
          <Text style={{ fontWeight: '800' }}>{i + 1}. {x.name}</Text> · {TEAM_STATUS[x.status] || x.status}
          {x.time_change_answer === 'pending' ? ' · hasn’t answered the time change yet' : ''}
          {x.players?.length ? <Text style={{ color: colors.muted }}> · {x.players.join(', ')}</Text> : null}
        </Text>
      )))}
    </View>
  );
}

const HISTORY: Record<string, string> = {
  pending: 'Sent for approval', resent: 'Edited and sent again', approved: 'Approved', rejected: 'Rejected', closed: 'Registration closed',
  scheduled: 'Schedule made', finished: 'Finished', cancelled: 'Cancelled', time_changed: 'Time changed', team_withdrew: 'Team withdrew',
};

// every time a tournament was sent, rejected (with the reason), approved or cancelled
function History({ id }: { id: string }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [open, setOpen] = useState(false);
  async function toggle() {
    setOpen(!open);
    if (!open && !rows) {
      const { data } = await supabase.from('tournament_reviews').select('id, status, reason, created_at').eq('tournament_id', id).order('created_at');
      setRows((data as any[]) || []);
    }
  }
  const rejections = rows?.filter((r) => r.status === 'rejected').length || 0;
  return (
    <View>
      <LinkButton title={open ? 'Hide history' : 'History'} onPress={toggle} />
      {open && (!rows ? <Muted>Loading...</Muted> : rows.length === 0 ? <Muted>No history yet.</Muted> : (
        <>
          {rows.map((r) => (
            <Text key={r.id} style={{ color: r.status === 'rejected' ? colors.danger : colors.muted, fontSize: 13, marginTop: 2 }}>
              <Text style={{ fontWeight: '800' }}>{HISTORY[r.status] || r.status}</Text> · {dateTimeText(r.created_at)}{r.reason ? ` · Reason: ${r.reason}` : ''}
            </Text>
          ))}
          {rejections > 0 && <Muted style={{ fontSize: 12 }}>Rejected {rejections} time{rejections === 1 ? '' : 's'} so far.</Muted>}
        </>
      ))}
    </View>
  );
}
