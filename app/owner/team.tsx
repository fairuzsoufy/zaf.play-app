import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SITE_URL, supabase } from '@/lib/supabase';
import { PERMISSIONS, type PermissionKey } from '@/lib/access';
import { capitalizeWords, isEgyptMobile, onlyDigits, PHONE_HELP } from '@/lib/validate';
import { searchMatches } from '@/lib/courtTimes';
import { useT } from '@/lib/ownerLang';
import { colors } from '@/lib/theme';
import { Badge, Box, Chip, Chips, H2, LinkButton, Loading, Muted, Pager, PAGE_SIZE, useOwner } from '@/components/owner';
import { Button, Field, Note } from '@/components/ui';

type Perms = Record<PermissionKey, boolean>;
const NO_PERMS: Perms = { view_bookings: false, manage_bookings: false, view_finances: false, manage_branches: false, view_tournaments: false, manage_tournaments: false };

const PRESETS: { label: string; perms: Perms; title: string }[] = [
  { label: 'Reservations', title: 'Reservations', perms: { ...NO_PERMS, view_bookings: true, manage_bookings: true } },
  { label: 'Finance', title: 'Finance', perms: { ...NO_PERMS, view_finances: true } },
  { label: 'Manager (everything)', title: 'Manager', perms: { view_bookings: true, manage_bookings: true, view_finances: true, manage_branches: true, view_tournaments: true, manage_tournaments: true } },
  { label: 'Tournaments', title: 'Tournaments', perms: { ...NO_PERMS, view_tournaments: true, manage_tournaments: true } },
];

type FormState = { full_name: string; email: string; phone: string; job_title: string; perms: Perms; all_branches: boolean; branch_ids: string[] };
const emptyForm: FormState = { full_name: '', email: '', phone: '', job_title: '', perms: NO_PERMS, all_branches: true, branch_ids: [] };
const REDIRECT = `${SITE_URL}/accept-invite`;

// the function answers a "no" (email taken, phone used...) as { error } with status 200
async function functionError(error: any, data?: any): Promise<string> {
  if (!error) return data?.error || '';
  try {
    const body = await error?.context?.json();
    if (body?.error) return body.error;
  } catch {}
  return error?.message || 'Something went wrong.';
}

async function emailProblem(email: string): Promise<string> {
  try {
    const { data, error } = await supabase.functions.invoke('check-email', { body: { email: email.trim() } });
    if (error || !data) return '';
    return data.ok ? '' : data.reason || 'Please check your email address.';
  } catch {
    return '';
  }
}

function Check({ on, onPress, title, help }: { on: boolean; onPress: () => void; title: string; help?: string }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="checkbox" accessibilityState={{ checked: on }} style={{ flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 8 }}>
      <Text style={{ color: on ? colors.success : colors.muted, fontSize: 20, marginRight: 10 }}>{on ? '☑' : '☐'}</Text>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text, fontWeight: '600' }}>{title}</Text>
        {!!help && <Muted style={{ fontSize: 12 }}>{help}</Muted>}
      </View>
    </Pressable>
  );
}

function StaffForm({ initial, branches, isNew, saving, error, onSave, onCancel }: {
  initial: FormState; branches: any[]; isNew: boolean; saving: boolean; error: string; onSave: (f: FormState) => void; onCancel: () => void;
}) {
  const { t } = useT();
  const [f, setF] = useState<FormState>(initial);

  function togglePerm(key: PermissionKey) {
    const perms = { ...f.perms, [key]: !f.perms[key] };
    // managing includes seeing
    if (key === 'manage_bookings' && perms.manage_bookings) perms.view_bookings = true;
    if (key === 'view_bookings' && !perms.view_bookings) perms.manage_bookings = false;
    if (key === 'manage_tournaments' && perms.manage_tournaments) perms.view_tournaments = true;
    if (key === 'view_tournaments' && !perms.view_tournaments) perms.manage_tournaments = false;
    setF({ ...f, perms });
  }
  const toggleBranch = (id: string) => setF({ ...f, branch_ids: f.branch_ids.includes(id) ? f.branch_ids.filter((b) => b !== id) : [...f.branch_ids, id] });

  return (
    <Box>
      <H2>{isNew ? t('Invite a sub-user') : t('Edit {name}', { name: initial.full_name })}</H2>
      <Field label={t('Full name')} value={f.full_name} onChangeText={(v) => setF({ ...f, full_name: v })} />
      <Field label={t('Job title (optional)')} value={f.job_title} onChangeText={(v) => setF({ ...f, job_title: v })} placeholder={t('e.g. Reception, Accountant')} />
      {isNew && (
        <>
          <Field label={t('Email (the invite is sent here)')} value={f.email} onChangeText={(v) => setF({ ...f, email: v })} autoCapitalize="none" keyboardType="email-address" />
          <Field label={t('Phone')} value={f.phone} onChangeText={(v) => setF({ ...f, phone: onlyDigits(v) })} keyboardType="number-pad" maxLength={11} placeholder="01XXXXXXXXX" />
        </>
      )}
      <Text style={{ color: colors.text, fontWeight: '700' }}>{t('What can they do?')}</Text>
      <Muted>{t('Quick pick:')}</Muted>
      <Chips>{PRESETS.map((p) => <Chip key={p.label} label={t(p.label)} on={false} onPress={() => setF({ ...f, perms: p.perms, job_title: f.job_title || p.title })} />)}</Chips>
      {PERMISSIONS.map((p) => <Check key={p.key} on={f.perms[p.key]} onPress={() => togglePerm(p.key)} title={t(p.label)} help={t(p.help)} />)}
      <Text style={{ color: colors.text, fontWeight: '700', marginTop: 10 }}>{t('Which branches?')}</Text>
      <Check on={f.all_branches} onPress={() => setF({ ...f, all_branches: !f.all_branches })} title={t('All branches (including new ones you add later)')} />
      {!f.all_branches && branches.map((b) => <Check key={b.id} on={f.branch_ids.includes(b.id)} onPress={() => toggleBranch(b.id)} title={`${b.name} · ${b.city}`} />)}
      {f.perms.view_finances && !f.all_branches && (
        <Muted style={{ fontSize: 12, marginTop: 4 }}>{t('They will see revenue for these branches only. Zaf Play transfers cover all your branches together, so they are shown only to finance staff with “All branches”.')}</Muted>
      )}
      {!!error && <View style={{ marginTop: 10 }}><Note kind="error">{error}</Note></View>}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
        <View style={{ flex: 1 }}><Button small title={saving ? (isNew ? t('Sending invite...') : t('Saving...')) : isNew ? t('Send invite') : t('Save changes')} onPress={() => onSave(f)} loading={saving} /></View>
        <View style={{ flex: 1 }}><Button small variant="ghost" title={t('Cancel')} onPress={onCancel} /></View>
      </View>
    </Box>
  );
}

// Owner → Team, like the website: co-owners and sub-users. The owner and co-owners invite and manage sub-users;
// only the owner adds or removes co-owners.
export default function OwnerTeam() {
  const { access } = useOwner();
  const { t, locale } = useT();
  const isOwner = access.role === 'owner';
  const ownerId = (isOwner ? access.user_id : access.owner_id) || '';
  const [staff, setStaff] = useState<any[] | null>(null);
  const [branches, setBranches] = useState<any[]>([]);
  const [formFor, setFormFor] = useState<'new' | string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [coOpen, setCoOpen] = useState(false);
  const [coName, setCoName] = useState('');
  const [coEmail, setCoEmail] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    const [{ data: s }, { data: b }] = await Promise.all([
      supabase
        .from('owner_staff')
        .select('id, user_id, full_name, email, phone, job_title, status, is_co_owner, can_view_bookings, can_manage_bookings, can_view_finances, can_manage_branches, can_view_tournaments, can_manage_tournaments, all_branches, invited_at, accepted_at, owner_staff_branches ( facility_id )')
        .eq('owner_id', ownerId)
        .order('created_at', { ascending: true }),
      supabase.from('facilities').select('id, name, city').eq('owner_id', ownerId).eq('is_active', true).order('created_at', { ascending: true }),
    ]);
    setStaff((s as any[]) || []);
    setBranches((b as any[]) || []);
  }, [ownerId]);
  useEffect(() => { load(); }, [load]);

  // a co-owner can't change the owner's co-owners (or themselves)
  const canManage = (x: any) => isOwner || (!x.is_co_owner && x.user_id !== access.user_id);

  async function save(f: FormState) {
    setFormError('');
    if (!f.all_branches && f.branch_ids.length === 0) return setFormError(t('Choose at least one branch, or tick “All branches”.'));
    if (!Object.values(f.perms).some(Boolean)) return setFormError(t('Tick at least one permission.'));
    if (f.phone && !isEgyptMobile(f.phone)) return setFormError(PHONE_HELP);
    setSaving(true);
    if (formFor === 'new') {
      const bad = await emailProblem(f.email);
      if (bad) { setSaving(false); return setFormError(bad); }
      const { data, error } = await supabase.functions.invoke('staff-invite', {
        body: {
          action: 'invite', email: f.email.trim(), full_name: capitalizeWords(f.full_name), phone: f.phone.trim(), job_title: capitalizeWords(f.job_title),
          perms: f.perms, all_branches: f.all_branches, branch_ids: f.all_branches ? [] : f.branch_ids, redirect_to: REDIRECT,
        },
      });
      setSaving(false);
      const err = await functionError(error, data);
      if (err) return setFormError(err);
      setMessage(`📧 ${t('Invite sent to {email}. They set their own password from the email, then they can log in.', { email: f.email.trim() })}`);
    } else {
      const { error } = await supabase.rpc('owner_update_staff', {
        p_staff_id: formFor, p_full_name: capitalizeWords(f.full_name), p_job_title: capitalizeWords(f.job_title),
        p_perms: f.perms, p_all_branches: f.all_branches, p_branch_ids: f.all_branches ? [] : f.branch_ids,
      });
      setSaving(false);
      if (error) return setFormError(error.message);
      setMessage(`✅ ${t('Saved. The new permissions apply right away.')}`);
    }
    setFormFor(null);
    load();
  }

  async function setSuspended(s: any, suspend: boolean) {
    setBusyId(s.id);
    setMessage('');
    const { error } = await supabase.rpc('owner_set_staff_suspended', { p_staff_id: s.id, p_suspend: suspend });
    setBusyId(null);
    if (error) return setMessage(`❌ ${error.message}`);
    setMessage(suspend ? `⛔ ${t("{name} is suspended and can't see anything until they are reactivated.", { name: s.full_name })}` : `✅ ${t('{name} is active again.', { name: s.full_name })}`);
    load();
  }

  async function inviteAction(s: any, action: 'resend' | 'cancel') {
    setBusyId(s.id);
    setMessage('');
    const { data, error } = await supabase.functions.invoke('staff-invite', { body: { action, staff_id: s.id, redirect_to: REDIRECT } });
    setBusyId(null);
    const err = await functionError(error, data);
    if (err) return setMessage(`❌ ${err}`);
    setMessage(action === 'resend' ? `📧 ${t('Invite sent again to {email}.', { email: s.email })}` : t('Invite for {email} cancelled.', { email: s.email }));
    load();
  }

  async function toggleCoOwner(s: any) {
    setBusyId(s.id);
    const { error } = await supabase.rpc('owner_set_co_owner', { p_staff_id: s.id, p_co_owner: !s.is_co_owner });
    setBusyId(null);
    setMessage(error ? `❌ ${error.message}` : !s.is_co_owner
      ? `✅ ${t('{name} is now a co-owner: same access as you (bookings, money, all branches) and can manage sub-users.', { name: s.full_name })}`
      : t('{name} is now a sub-user. Edit their permissions if needed.', { name: s.full_name }));
    load();
  }

  async function inviteCoOwner() {
    setFormError('');
    setMessage('');
    if (!coName.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(coEmail.trim())) return setFormError(t("Please enter your co-owner's name and a valid email."));
    setSaving(true);
    const bad = await emailProblem(coEmail);
    if (bad) { setSaving(false); return setFormError(bad); }
    const { data, error } = await supabase.functions.invoke('staff-invite', {
      body: { action: 'invite_co_owner', email: coEmail.trim(), full_name: capitalizeWords(coName), redirect_to: REDIRECT },
    });
    setSaving(false);
    const err = await functionError(error, data);
    if (err) return setFormError(err);
    setMessage(`📧 ${t('Invite sent to {email}. They confirm from the email, then add their phone and password.', { email: coEmail.trim() })}`);
    setCoOpen(false);
    setCoName('');
    setCoEmail('');
    load();
  }

  const formFromStaff = (s: any): FormState => ({
    full_name: s.full_name, email: s.email, phone: s.phone, job_title: s.job_title || '',
    perms: {
      view_bookings: s.can_view_bookings, manage_bookings: s.can_manage_bookings, view_finances: s.can_view_finances,
      manage_branches: s.can_manage_branches, view_tournaments: s.can_view_tournaments, manage_tournaments: s.can_manage_tournaments,
    },
    all_branches: s.all_branches,
    branch_ids: (s.owner_staff_branches || []).map((x: any) => x.facility_id),
  });
  const branchName = (id: string) => branches.find((b) => b.id === id)?.name || '—';

  if (staff === null) return <Loading />;
  const shown = staff.filter((x) => !search.trim() || searchMatches(search, [x.full_name, x.email, x.phone, x.job_title, x.is_co_owner ? 'co-owner' : 'sub-user'].filter(Boolean).join(' ')));

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
      <Muted style={{ marginBottom: 12 }}>
        {t('Give your sub-users (staff) their own login. You choose what each person can see and which branches, and you can suspend anyone at any time.')}{' '}
        {isOwner ? t('You and your co-owners can add or change sub-users. Only you can add or remove a co-owner.') : t('As a co-owner you can add and change sub-users. Only the owner can add or remove a co-owner.')}
      </Muted>
      {formFor === null && !coOpen && (
        <View style={{ gap: 8, marginBottom: 12 }}>
          <Button title={t('+ Invite sub-user')} onPress={() => { setFormFor('new'); setFormError(''); setMessage(''); }} />
          {isOwner && !staff.some((x) => x.is_co_owner) && (
            <Button variant="ghost" title={`👥 ${t('Do you have a co-owner?')}`} onPress={() => { setCoOpen(true); setFormError(''); setMessage(''); }} />
          )}
        </View>
      )}
      {!!message && <Text style={{ color: colors.text, marginBottom: 12 }}>{message}</Text>}

      {coOpen && (
        <Box>
          <H2>{t('Invite your co-owner')}</H2>
          <Muted style={{ marginBottom: 10 }}>
            {t('They get the same access as you (bookings, money, all branches) and can manage sub-users. Zaf Play transfers still go to you. We email them a link to confirm and finish sign-up (phone and password).')}
          </Muted>
          <Field label={t('Name')} value={coName} onChangeText={setCoName} />
          <Field label={t('Email')} value={coEmail} onChangeText={setCoEmail} autoCapitalize="none" keyboardType="email-address" />
          {!!formError && <Note kind="error">{formError}</Note>}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}><Button small title={saving ? t('Sending invite...') : t('Send invite')} onPress={inviteCoOwner} loading={saving} /></View>
            <View style={{ flex: 1 }}><Button small variant="ghost" title={t('Cancel')} onPress={() => setCoOpen(false)} /></View>
          </View>
        </Box>
      )}

      {formFor === 'new' && <StaffForm initial={emptyForm} branches={branches} isNew saving={saving} error={formError} onSave={save} onCancel={() => setFormFor(null)} />}

      <H2>{t('Your team')}</H2>
      {staff.length === 0 && formFor !== 'new' ? <Muted>{t('No co-owners or sub-users yet.')}</Muted> : (
        <>
          {staff.length > 3 && <Field label={t('Search')} value={search} onChangeText={(v) => { setSearch(v); setPage(1); }} placeholder={t('Search by name, email, phone or job title')} />}
          {shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((s) => formFor === s.id ? (
            <StaffForm key={s.id} initial={formFromStaff(s)} branches={branches} isNew={false} saving={saving} error={formError} onSave={save} onCancel={() => setFormFor(null)} />
          ) : (
            <Box key={s.id} style={s.status === 'suspended' ? { opacity: 0.75 } : undefined}>
              <Text style={{ color: colors.text, fontWeight: '800' }}>{s.full_name}{s.job_title ? <Text style={{ color: colors.muted, fontWeight: '400' }}> · {s.job_title}</Text> : null}</Text>
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                <Badge tone={s.status === 'active' ? 'ok' : s.status === 'suspended' ? 'bad' : 'warn'} text={t(s.status === 'active' ? 'Active' : s.status === 'suspended' ? 'Suspended' : 'Invite sent')} />
                <Badge tone="info" text={s.is_co_owner ? t('Co-owner · full access') : t('Sub-user')} />
              </View>
              <Muted style={{ marginTop: 4 }}>{s.email} · {s.phone}</Muted>
              <Text style={{ color: colors.text, fontSize: 12, marginTop: 4 }}>{PERMISSIONS.filter((p) => s[`can_${p.key}`]).map((p) => t(p.label)).join(' · ')}</Text>
              <Muted style={{ fontSize: 12, marginTop: 4 }}>
                {t('Branches:')} {s.all_branches ? t('All branches') : (s.owner_staff_branches || []).map((x: any) => branchName(x.facility_id)).join(', ')}
              </Muted>
              {s.status === 'invited' && (
                <Muted style={{ fontSize: 12 }}>
                  {t('Invite sent {day} — waiting for them to set a password.', { day: new Date(s.invited_at).toLocaleDateString(locale, { timeZone: 'Africa/Cairo', day: 'numeric', month: 'short' }) })}
                </Muted>
              )}
              {canManage(s) && (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 }}>
                  <LinkButton title={`✏️ ${t('Edit')}`} onPress={() => { setFormFor(s.id); setFormError(''); setMessage(''); }} />
                  {s.status === 'invited' && (
                    <>
                      <LinkButton title={t('Resend invite')} onPress={() => inviteAction(s, 'resend')} disabled={busyId === s.id} />
                      <LinkButton title={t('Cancel invite')} onPress={() => inviteAction(s, 'cancel')} disabled={busyId === s.id} />
                    </>
                  )}
                  {isOwner && <LinkButton title={s.is_co_owner ? t('Make sub-user') : t('Make co-owner')} onPress={() => toggleCoOwner(s)} disabled={busyId === s.id} />}
                  {s.status === 'suspended'
                    ? <LinkButton title={t('Reactivate')} onPress={() => setSuspended(s, false)} disabled={busyId === s.id} />
                    : <LinkButton danger title={t('Suspend')} onPress={() => setSuspended(s, true)} disabled={busyId === s.id} />}
                </View>
              )}
            </Box>
          ))}
          <Pager page={page} total={shown.length} onChange={setPage} />
        </>
      )}

      <OwnershipTransfer coOwners={staff.filter((x) => x.is_co_owner)} />
    </ScrollView>
  );
}

type Transfer = { id: string; status: string; new_owner_name: string | null; decline_reason: string | null; created_at: string };

// Owner leaving: the owner or a co-owner asks Zaf Play to hand the courts to a co-owner. Zaf Play settles the money and does it.
function OwnershipTransfer({ coOwners }: { coOwners: any[] }) {
  const { access } = useOwner();
  const isOwner = access.role === 'owner';
  const [last, setLast] = useState<Transfer | null>(null);
  const [open, setOpen] = useState(false);
  const [staffId, setStaffId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    const { data } = await supabase.from('ownership_transfers').select('id, status, new_owner_name, decline_reason, created_at').order('created_at', { ascending: false }).limit(1);
    setLast(((data as Transfer[]) || [])[0] || null);
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!isOwner && !access.co_owner) return null;
  if (isOwner && coOwners.length === 0) return null;
  const ready = coOwners.filter((c) => c.user_id && c.status !== 'invited');
  const pending = last?.status === 'pending' ? last : null;

  async function send() {
    setBusy(true);
    setMsg('');
    const { error } = await supabase.rpc('request_ownership_transfer', { p_staff_id: isOwner ? staffId : null, p_note: note });
    setBusy(false);
    if (error) return setMsg(`❌ ${error.message}`);
    setOpen(false);
    setNote('');
    setMsg('✅ Sent. Zaf Play will settle any open money with the owner, then move the courts and email you both.');
    load();
  }

  async function cancel(id: string) {
    setBusy(true);
    const { error } = await supabase.rpc('cancel_ownership_transfer', { p_id: id });
    setBusy(false);
    setMsg(error ? `❌ ${error.message}` : 'Request cancelled.');
    load();
  }

  return (
    <Box style={{ marginTop: 20 }}>
      <H2>Owner leaving?</H2>
      <Muted style={{ marginBottom: 10 }}>
        {isOwner
          ? 'If you are leaving, a co-owner can take over your branches, courts, bookings and team. Zaf Play settles your money first, then moves everything.'
          : `If ${access.owner_name || 'the owner'} is leaving, you can ask Zaf Play to make you the owner. You keep every branch, court, booking and sub-user.`}
      </Muted>
      {!!msg && <Text style={{ color: colors.text, marginBottom: 10 }}>{msg}</Text>}
      {pending ? (
        <Box tone="warn" style={{ marginBottom: 0 }}>
          <Text style={{ color: colors.noteText }}>
            Waiting for Zaf Play: hand the courts to <Text style={{ fontWeight: '800' }}>{pending.new_owner_name || 'the co-owner'}</Text> (sent{' '}
            {new Date(pending.created_at).toLocaleDateString('en-GB', { timeZone: 'Africa/Cairo', day: 'numeric', month: 'short' })}).
          </Text>
          <LinkButton title="Cancel request" onPress={() => cancel(pending.id)} disabled={busy} />
        </Box>
      ) : open ? (
        <View>
          {isOwner && (
            <>
              <Muted>Who takes over</Muted>
              <Chips>{ready.map((c) => <Chip key={c.id} label={`${c.full_name} · ${c.email}`} on={staffId === c.id} onPress={() => setStaffId(c.id)} />)}</Chips>
              {ready.length === 0 && <Muted style={{ marginBottom: 8 }}>Your co-owner must accept their invite first.</Muted>}
            </>
          )}
          <Field label="Note for Zaf Play (optional)" value={note} onChangeText={setNote} multiline maxLength={500} style={{ minHeight: 60, textAlignVertical: 'top' }} />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}><Button small title={busy ? 'Sending...' : 'Send request'} onPress={send} loading={busy} disabled={isOwner && !staffId} /></View>
            <View style={{ flex: 1 }}><Button small variant="ghost" title="Cancel" onPress={() => setOpen(false)} /></View>
          </View>
        </View>
      ) : (
        <>
          {last?.status === 'declined' && <Text style={{ color: colors.danger, marginBottom: 8 }}>Your last request was declined: {last.decline_reason}</Text>}
          <Button small variant="ghost" title="Request ownership transfer" onPress={() => setOpen(true)} />
        </>
      )}
    </Box>
  );
}
