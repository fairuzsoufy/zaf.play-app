import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { Stack } from 'expo-router';
import { Text } from '@/components/AppText';
import { supabase } from '@/lib/supabase';
import { searchMatches } from '@/lib/courtTimes';
import { colors } from '@/lib/theme';
import { Card, Line } from '@/components/admin';
import { TransferOwnership } from '@/components/adminApprovals';
import { Check } from '@/components/ownerCourts';
import { Badge, Chip, Chips, LinkButton, Loading, Muted, Pager, PAGE_SIZE, Sheet } from '@/components/owner';
import { Button, Field, Note } from '@/components/ui';

type Deletion = { user_id: string; full_name: string | null; phone: string | null; email: string | null; reason: string; deleted_at: string };
type UserRow = {
  id: string; full_name: string | null; username: string | null; email: string | null; phone: string | null;
  role: 'player' | 'owner' | 'admin' | 'staff'; owner_status: string | null; is_staff: boolean; is_co_owner: boolean;
  staff_id: string | null; staff_status: 'invited' | 'active' | 'suspended' | null; team_owner_id: string | null; team_owner: string | null;
  blocked_everywhere: boolean; blocked_branches: number; branches: number; courts: number; created_at: string;
  last_sign_in_at: string | null; bookings: number; games: number;
};
type OwnerInfo = {
  id: string; business_name: string | null;
  team: { full_name: string | null; email: string; phone: string | null; job_title: string | null; is_co_owner: boolean; status: string }[];
  branches: { name: string; city: string; address: string; instapay_link: string | null; is_approved: boolean; is_active: boolean;
    courts: { name: string; is_approved: boolean; is_active: boolean; sports: string[] }[] }[];
};
type ActiveBlock = { id: string; user_id: string };
type Booking = { id: string; start_time: string; status: string; payment_status: string; total_price: number; court: string | null; branch: string | null; sport: string | null; player: string | null; own: boolean };
type Game = { start_time: string; status: string; court: string | null; sport: string | null; spots?: number; players?: number; amount?: number };
type History = {
  user: { id: string; full_name: string | null; username: string | null; email: string | null; phone: string | null; gender: string | null;
    role: string; owner_status: string | null; is_active: boolean; created_at: string; last_sign_in_at: string | null; is_admin: boolean };
  credit_balance: number;
  linked_accounts: { email: string; full_name: string | null; is_co_owner: boolean; job_title: string | null; status: string }[];
  staff_of: { owner: string; is_co_owner: boolean; job_title: string | null }[];
  branches: { name: string; city: string; is_approved: boolean; is_active: boolean; courts: { name: string }[] }[];
  courts: number; bookings: Booking[]; games_hosted: Game[]; games_joined: Game[];
  tournaments: { title: string; starts_at: string; status: string }[]; tournament_teams: number; payments: number; reviews: number;
};

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'player', label: 'Players' },
  { key: 'owner', label: 'Owners' },
  { key: 'co_owner', label: 'Co-owners' },
  { key: 'sub_user', label: 'Sub-users' },
  { key: 'blocked', label: 'Blocked' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

const when = (d: string | null) => (d ? new Date(d).toLocaleString('en-GB', { timeZone: 'Africa/Cairo', dateStyle: 'medium', timeStyle: 'short' }) : '—');
const isBlocked = (u: UserRow) => u.blocked_everywhere || u.blocked_branches > 0;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function inTab(u: UserRow, tab: TabKey) {
  if (tab === 'all') return true;
  if (tab === 'player') return u.role === 'player';
  if (tab === 'owner') return u.role === 'owner';
  if (tab === 'co_owner') return u.is_staff && u.is_co_owner;
  if (tab === 'sub_user') return u.is_staff && !u.is_co_owner;
  return isBlocked(u);
}

function RoleBadge({ u }: { u: Pick<UserRow, 'role' | 'is_staff' | 'is_co_owner'> }) {
  if (u.role === 'admin') return <Badge tone="info" text="Admin" />;
  if (u.role === 'owner') return <Badge tone="info" text="Owner" />;
  if (u.is_co_owner) return <Badge tone="info" text="Co-owner" />;
  if (u.is_staff) return <Badge tone="warn" text="Sub-user" />;
  return <Badge text="Player" />;
}

function StatusBadge({ u }: { u: UserRow }) {
  if (u.role === 'owner') {
    if (u.owner_status === 'approved') return <Badge tone="ok" text="Active" />;
    if (u.owner_status === 'rejected') return <Badge tone="bad" text="Not approved" />;
    if (u.owner_status === 'frozen') return <Badge tone="bad" text="Frozen" />;
    return <Badge tone="warn" text="Waiting for approval" />;
  }
  if (u.is_staff) {
    if (u.staff_status === 'suspended') return <Badge tone="bad" text="Suspended" />;
    if (u.staff_status === 'invited') return <Badge tone="warn" text="Invited" />;
    return <Badge tone="ok" text="Active" />;
  }
  if (u.blocked_everywhere) return <Badge tone="bad" text="Blocked" />;
  if (u.blocked_branches > 0) return <Badge tone="bad" text={`Blocked at ${plural(u.blocked_branches, 'branch', 'branches')}`} />;
  return <Badge tone="ok" text="Active" />;
}

// People, like the website's admin People page: every account by type, with its status and the actions for it
// (block / unblock players, suspend / reactivate sub-users and co-owners, transfer an owner's courts, history, delete).
export default function AdminPeople() {
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [owners, setOwners] = useState<Record<string, OwnerInfo>>({});
  const [blocks, setBlocks] = useState<ActiveBlock[]>([]);
  const [deletions, setDeletions] = useState<Record<string, Deletion>>({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<TabKey>('all');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<UserRow | null>(null);
  const [blocking, setBlocking] = useState<UserRow | null>(null);
  const [transferring, setTransferring] = useState<UserRow | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [p, o, b, d] = await Promise.all([
      supabase.rpc('admin_list_people'),
      supabase.rpc('admin_all_owners'),
      supabase.rpc('list_blocked_players', { p_include_lifted: false }),
      supabase.from('account_deletions').select('user_id, full_name, phone, email, reason, deleted_at'),
    ]);
    if (p.error) return setError(`Could not load people: ${p.error.message}`);
    setError('');
    setUsers((p.data as UserRow[]) || []);
    const map: Record<string, OwnerInfo> = {};
    ((o.data as OwnerInfo[]) || []).forEach((x) => (map[x.id] = x));
    setOwners(map);
    setBlocks((b.data as ActiveBlock[]) || []);
    const gone: Record<string, Deletion> = {};
    ((d.data as Deletion[]) || []).forEach((x) => (gone[x.user_id] = x));
    setDeletions(gone);
  }, []);
  useEffect(() => { load(); }, [load]);

  const all = users || [];
  const found = all.filter((u) => {
    if (!inTab(u, tab)) return false;
    const info = owners[u.id];
    const was = deletions[u.id];
    const words = [u.full_name, u.username, u.email, u.phone, u.team_owner, info?.business_name,
      ...(info?.branches || []).flatMap((b) => [b.name, ...b.courts.map((c) => c.name)]), was?.full_name, was?.phone, was?.email];
    return !search.trim() || searchMatches(search, words.filter(Boolean).join(' '));
  });
  const paged = found.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  async function unblockAll(u: UserRow) {
    setBusyId(u.id);
    setNotice('');
    for (const b of blocks.filter((x) => x.user_id === u.id)) {
      const { error: e } = await supabase.rpc('unblock_player', { p_block_id: b.id });
      if (e) { setBusyId(null); return setError(e.message); }
    }
    setBusyId(null);
    setConfirmId(null);
    setNotice(`${u.full_name || u.email} is active again and can book everywhere.`);
    load();
  }

  async function setSuspended(u: UserRow, suspend: boolean) {
    if (!u.staff_id) return;
    setBusyId(u.id);
    setNotice('');
    const { error: e } = await supabase.rpc('admin_set_staff_suspended', { p_staff_id: u.staff_id, p_suspend: suspend });
    setBusyId(null);
    setConfirmId(null);
    if (e) return setError(e.message);
    setNotice(suspend ? `${u.full_name || u.email} is suspended and can't open the dashboard.` : `${u.full_name || u.email} is active again.`);
    load();
  }

  const done = (msg: string) => { setSelected(null); setBlocking(null); setTransferring(null); setNotice(msg); load(); };

  return (
    <>
      <Stack.Screen options={{ title: 'People' }} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
        {!!error && <Note kind="error">{error}</Note>}
        {!!notice && <Note kind="ok">{notice}</Note>}
        <Chips>
          {TABS.map((t) => <Chip key={t.key} label={`${t.label} (${all.filter((u) => inTab(u, t.key)).length})`} on={tab === t.key} onPress={() => { setTab(t.key); setPage(1); setConfirmId(null); }} />)}
        </Chips>
        <Field label="Search" value={search} onChangeText={(v) => { setSearch(v); setPage(1); }} autoCapitalize="none"
          placeholder={tab === 'owner' ? 'Search by owner, business, branch or court' : 'Search by name, username, email or phone'} />
        {users === null ? <Loading /> : found.length === 0 ? <Muted>No people match.</Muted> : paged.map((u) => {
          const info = owners[u.id];
          const isOpen = expanded === u.id;
          const confirming = confirmId === u.id;
          const was = deletions[u.id];
          return (
            <Card key={u.id}>
              <Text style={{ color: colors.text, fontWeight: '800' }}>{u.full_name || '—'} {u.username ? <Text style={{ color: colors.muted, fontWeight: '400' }}>@{u.username}</Text> : null}</Text>
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}><RoleBadge u={u} /><StatusBadge u={u} /></View>
              <Line muted>{u.email || 'no email'} · {u.phone || 'no phone'}</Line>
              {was && <Line muted>Was {was.full_name || '—'} · {was.phone || 'no phone'} · {was.email} · deleted {new Date(was.deleted_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}{'\n'}Reason: {was.reason}</Line>}
              {u.is_staff && !!u.team_owner && <Line>{u.is_co_owner ? 'Co-owner with' : 'Sub-user of'} {u.team_owner}</Line>}
              {u.role === 'owner' && <Line>{info?.business_name ? `${info.business_name} · ` : ''}{plural(u.branches, 'branch', 'branches')} · {plural(u.courts, 'court')}</Line>}
              <Line muted size={12}>Joined {when(u.created_at)} · last signed in {when(u.last_sign_in_at)} · {plural(u.bookings, 'booking')} · {plural(u.games, 'game')}</Line>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 }}>
                {u.role === 'owner' && <LinkButton title={isOpen ? 'Hide courts' : 'Branches & courts'} onPress={() => setExpanded(isOpen ? null : u.id)} />}
                {u.role === 'owner' && !!info?.team.some((t) => t.is_co_owner) && <LinkButton title="Transfer ownership" onPress={() => setTransferring(u)} />}
                {u.role === 'player' && (isBlocked(u) ? (confirming ? (
                  <>
                    <LinkButton title="Yes, unblock" onPress={() => unblockAll(u)} disabled={busyId === u.id} />
                    <LinkButton title="No" onPress={() => setConfirmId(null)} />
                  </>
                ) : <LinkButton title="Unblock" onPress={() => setConfirmId(u.id)} />) : <LinkButton title="Block" onPress={() => setBlocking(u)} />)}
                {u.is_staff && (u.staff_status === 'suspended' ? <LinkButton title="Reactivate" onPress={() => setSuspended(u, false)} disabled={busyId === u.id} />
                  : confirming ? (
                    <>
                      <LinkButton title="Yes, suspend" onPress={() => setSuspended(u, true)} disabled={busyId === u.id} />
                      <LinkButton title="No" onPress={() => setConfirmId(null)} />
                    </>
                  ) : <LinkButton title="Suspend" onPress={() => setConfirmId(u.id)} />)}
                <LinkButton title="History & delete" onPress={() => { setNotice(''); setSelected(u); }} />
              </View>
              {isOpen && info && <OwnerCourts info={info} />}
            </Card>
          );
        })}
        <Pager page={page} total={found.length} onChange={setPage} />
      </ScrollView>
      {selected && <UserHistory user={selected} onClose={() => setSelected(null)} onDeleted={done} />}
      {blocking && <BlockPlayer player={blocking} onClose={() => setBlocking(null)} onDone={done} />}
      {transferring && <TransferOwnership owner={transferring} onClose={() => setTransferring(null)} onDone={done} />}
    </>
  );
}

// an owner's branches, courts, co-owners and sub-users, under their row
function OwnerCourts({ info }: { info: OwnerInfo }) {
  return (
    <View style={{ marginTop: 10, backgroundColor: colors.bg, borderRadius: 10, padding: 10 }}>
      <Line bold>Branches & courts</Line>
      {info.branches.length === 0 && <Line muted>No branches yet.</Line>}
      {info.branches.map((b, i) => (
        <View key={i} style={{ marginTop: 4 }}>
          <Line><Text style={{ fontWeight: '700' }}>{b.name}</Text>, {b.address}, {b.city} <Text style={{ color: colors.muted }}>{!b.is_active ? '(removed)' : b.is_approved ? '(approved)' : '(waiting)'}</Text></Line>
          {!!b.instapay_link && <Line muted>InstaPay: {b.instapay_link}</Line>}
          {b.courts.map((c, j) => <Line key={j}>  • {c.name} · {c.sports.join(', ') || 'no sport'} <Text style={{ color: colors.muted }}>{!c.is_active ? '(disabled)' : c.is_approved ? '(live)' : '(waiting)'}</Text></Line>)}
        </View>
      ))}
      <View style={{ marginTop: 8 }}><Line bold>Co-owners & sub-users</Line></View>
      {info.team.length === 0 ? <Line muted>Nobody yet.</Line> : info.team.map((t, i) => (
        <Line key={i}>{t.full_name || t.email} <Text style={{ color: colors.muted }}>· {t.is_co_owner ? 'Co-owner' : `Sub-user${t.job_title ? ` (${t.job_title})` : ''}`} · {t.email} · {t.status}</Text></Line>
      ))}
    </View>
  );
}

// the admin blocks a player straight from People: reason (the player sees it), where, and whether to cancel what's coming up
function BlockPlayer({ player, onClose, onDone }: { player: UserRow; onClose: () => void; onDone: (msg: string) => void }) {
  const [reasons, setReasons] = useState<{ id: string; label: string; deleted_at: string | null }[]>([]);
  const [facilities, setFacilities] = useState<{ id: string; name: string }[]>([]);
  const [reason, setReason] = useState('');
  const [scope, setScope] = useState('');
  const [cancelUpcoming, setCancelUpcoming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const name = player.full_name || player.email || 'this player';

  useEffect(() => {
    Promise.all([supabase.rpc('list_block_reasons', { p_include_deleted: false }), supabase.rpc('blockable_facilities')]).then(([r, f]) => {
      setReasons(((r.data as any[]) || []).filter((x) => !x.deleted_at));
      setFacilities((f.data as any[]) || []);
    });
  }, []);

  async function block() {
    setBusy(true);
    setError('');
    const { data, error: e } = await supabase.rpc('block_player', { p_user_id: player.id, p_reason_id: reason, p_facility_id: scope || null, p_cancel_upcoming: cancelUpcoming });
    setBusy(false);
    if (e) return setError(e.message);
    const d = (data || {}) as { upcoming?: number; cancelled?: number };
    const up = Number(d.upcoming || 0);
    const cancelled = Number(d.cancelled || 0);
    onDone(`${name} is blocked.`
      + (cancelled > 0 ? ` ${cancelled} upcoming booking${cancelled === 1 ? ' was' : 's were'} cancelled and refunded.` : '')
      + (up > 0 ? ` ${up} upcoming booking${up === 1 ? ' is' : 's are'} still active.` : ''));
  }

  return (
    <Sheet title={`Block ${name}`} onClose={() => !busy && onClose()}>
      <Muted>Reason (the player will see it)</Muted>
      <Chips>{reasons.map((r) => <Chip key={r.id} label={r.label} on={reason === r.id} onPress={() => setReason(r.id)} />)}</Chips>
      <Muted>Block from</Muted>
      <Chips>
        <Chip label="All of Zaf Play" on={!scope} onPress={() => setScope('')} />
        {facilities.map((f) => <Chip key={f.id} label={f.name} on={scope === f.id} onPress={() => setScope(f.id)} />)}
      </Chips>
      <Check on={cancelUpcoming} onPress={() => setCancelUpcoming(!cancelUpcoming)} title="Also cancel their upcoming bookings and games (refunded in full, the player is told by email)" />
      {!!error && <Note kind="error">{error}</Note>}
      <Button title={busy ? 'Blocking...' : `Block ${name}`} onPress={block} loading={busy} disabled={!reason} />
    </Sheet>
  );
}

function Count({ n, label }: { n: number; label: string }) {
  return (
    <View style={{ width: '31%', borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 8, alignItems: 'center', opacity: n > 0 ? 1 : 0.5 }}>
      <Text style={{ color: colors.text, fontSize: 18, fontWeight: '800' }}>{n}</Text>
      <Text style={{ color: colors.muted, fontSize: 11, textAlign: 'center' }}>{label}</Text>
    </View>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ marginTop: 14 }}>
      <Line bold>{title}</Line>
      <View style={{ backgroundColor: colors.card, borderRadius: 10, padding: 8, marginTop: 4 }}>{children}</View>
    </View>
  );
}

function BookingList({ list, showPlayer }: { list: Booking[]; showPlayer?: boolean }) {
  return <>{list.map((b) => (
    <Line key={b.id}>{when(b.start_time)} · {b.sport || '—'} at {b.court || '—'}{b.branch ? ` (${b.branch})` : ''}{showPlayer && b.player ? ` · ${b.player}` : ''} <Text style={{ color: colors.muted }}>· {b.total_price} EGP · {b.status} · {b.payment_status}</Text></Line>
  ))}</>;
}

// everything an account has done, plus freeze / unfreeze for owners and the permanent delete
function UserHistory({ user, onClose, onDeleted }: { user: UserRow; onClose: () => void; onDeleted: (msg: string) => void }) {
  const [h, setH] = useState<History | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState('');
  const [ownerStatus, setOwnerStatus] = useState<string | null>(user.owner_status);
  const [freezing, setFreezing] = useState<'freeze' | 'unfreeze' | null>(null);
  const [freezeReason, setFreezeReason] = useState('');
  const [freezeMsg, setFreezeMsg] = useState('');
  const confirmWord = (user.email || user.full_name || 'DELETE').trim().toLowerCase();
  const name = user.full_name || user.email;

  useEffect(() => {
    let cancelled = false;
    supabase.rpc('admin_user_history', { p_user: user.id }).then(({ data, error: e }) => {
      if (cancelled) return;
      if (e) setError(`Could not load history: ${e.message}`);
      else setH(data as History);
    });
    return () => { cancelled = true; };
  }, [user.id]);

  async function remove() {
    setBusy(true);
    setError('');
    const { data, error: e } = await supabase.rpc('admin_delete_user', { p_user: user.id });
    setBusy(false);
    if (e) return setError(`Could not delete: ${e.message}`);
    const r = (data || {}) as { deleted?: string[]; courts?: number; bookings?: number };
    onDeleted(`Deleted ${(r.deleted || []).join(', ') || 'the account'} with ${plural(r.courts || 0, 'court')} and ${plural(r.bookings || 0, 'booking')}.`);
  }

  // owners: take back the approval (freeze) or give it back
  async function setFrozen(freeze: boolean) {
    setBusy(true);
    setFreezeMsg('');
    const { error: e } = freeze
      ? await supabase.rpc('admin_freeze_owner', { p_user_id: user.id, p_reason: freezeReason.trim() || null })
      : await supabase.rpc('admin_unfreeze_owner', { p_user_id: user.id });
    setBusy(false);
    setFreezing(null);
    if (e) return setFreezeMsg(`❌ ${e.message}`);
    setOwnerStatus(freeze ? 'frozen' : 'approved');
    setFreezeMsg(freeze ? '❄️ Frozen. We emailed the owner.' : '✅ Active again, and their branches are back.');
  }

  const own = h ? h.bookings.filter((b) => b.own) : [];
  const onCourts = h ? h.bookings.filter((b) => !b.own) : [];
  const games = h ? h.games_hosted.length + h.games_joined.length : 0;

  return (
    <Sheet title={name || 'Account'} onClose={() => !busy && onClose()}>
      <RoleBadge u={user} />
      {!!error && <Note kind="error">{error}</Note>}
      {!h && !error && <Muted>Loading history...</Muted>}
      {h && (
        <>
          <Line muted>{h.user.email || 'no email'} · {h.user.phone || 'no phone'}{h.user.username ? ` · @${h.user.username}` : ''}</Line>
          <Line muted>Joined {when(h.user.created_at)} · last signed in {when(h.user.last_sign_in_at)}{h.user.gender ? ` · ${h.user.gender}` : ''}{h.user.role === 'owner' ? ` · owner status: ${ownerStatus || 'pending'}` : ''}</Line>
          {h.user.role === 'owner' && (ownerStatus === 'approved' || ownerStatus === 'frozen') && (
            freezing ? (
              <View style={{ marginTop: 8 }}>
                <Line>{freezing === 'freeze'
                  ? `Freeze ${name}? Their branches are hidden from players and they can't change anything, but they still see their dashboard. Bookings already made stay.`
                  : `Unfreeze ${name}? Their branches go back in front of players.`}</Line>
                {freezing === 'freeze' && <Field label="Reason (shown to the owner, optional)" value={freezeReason} onChangeText={setFreezeReason} />}
                <View style={{ flexDirection: 'row' }}>
                  <LinkButton title={freezing === 'freeze' ? 'Yes, freeze' : 'Yes, unfreeze'} onPress={() => setFrozen(freezing === 'freeze')} disabled={busy} />
                  <LinkButton title="No" onPress={() => setFreezing(null)} />
                </View>
              </View>
            ) : <LinkButton title={ownerStatus === 'approved' ? 'Take back approval (freeze)' : 'Unfreeze'} onPress={() => setFreezing(ownerStatus === 'approved' ? 'freeze' : 'unfreeze')} />
          )}
          {!!freezeMsg && <Line>{freezeMsg}</Line>}
          {h.credit_balance !== 0 && <Line>Wallet credit: {h.credit_balance} EGP</Line>}
          {h.staff_of.map((s, i) => <Line key={i}>{s.is_co_owner ? 'Co-owner with' : `Sub-user${s.job_title ? ` (${s.job_title})` : ''} of`} {s.owner}</Line>)}

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
            <Count n={own.length} label="Bookings made" />
            <Count n={h.games_hosted.length} label="Games hosted" />
            <Count n={h.games_joined.length} label="Games joined" />
            <Count n={h.tournaments.length + h.tournament_teams} label="Tournaments" />
            <Count n={h.payments} label="Payments" />
            <Count n={h.branches.length} label="Branches" />
            <Count n={h.courts} label="Courts" />
            <Count n={onCourts.length} label="Bookings on courts" />
            <Count n={h.linked_accounts.length} label="Co-owners & sub-users" />
            <Count n={h.reviews} label="Ratings" />
          </View>

          {h.linked_accounts.length > 0 && (
            <Section title="Co-owners & sub-users (deleted too)">
              {h.linked_accounts.map((a, i) => <Line key={i}>{a.full_name || a.email} <Text style={{ color: colors.muted }}>· {a.is_co_owner ? 'Co-owner' : `Sub-user${a.job_title ? ` (${a.job_title})` : ''}`} · {a.email}</Text></Line>)}
            </Section>
          )}
          {h.branches.length > 0 && (
            <Section title="Branches & courts">
              {h.branches.map((b, i) => <Line key={i}><Text style={{ fontWeight: '700' }}>{b.name}</Text>, {b.city} <Text style={{ color: colors.muted }}>{!b.is_active ? '(removed)' : b.is_approved ? '(approved)' : '(waiting)'}</Text>{b.courts.length ? `\n  ${b.courts.map((c) => c.name).join(', ')}` : ''}</Line>)}
            </Section>
          )}
          {own.length > 0 && <Section title={`Bookings made (${own.length})`}><BookingList list={own} /></Section>}
          {onCourts.length > 0 && <Section title={`Bookings on their courts (${onCourts.length})`}><BookingList list={onCourts} showPlayer /></Section>}
          {h.games_hosted.length > 0 && (
            <Section title={`Games hosted (${h.games_hosted.length})`}>
              {h.games_hosted.map((g, i) => <Line key={i}>{when(g.start_time)} · {g.sport || '—'} at {g.court || '—'} <Text style={{ color: colors.muted }}>· {g.players}/{g.spots} players · {g.status}</Text></Line>)}
            </Section>
          )}
          {h.games_joined.length > 0 && (
            <Section title={`Games joined (${h.games_joined.length})`}>
              {h.games_joined.map((g, i) => <Line key={i}>{when(g.start_time)} · {g.sport || '—'} at {g.court || '—'} <Text style={{ color: colors.muted }}>· {g.amount ?? 0} EGP · {g.status}</Text></Line>)}
            </Section>
          )}
          {h.tournaments.length > 0 && (
            <Section title={`Tournaments created (${h.tournaments.length})`}>
              {h.tournaments.map((t, i) => <Line key={i}>{t.title} <Text style={{ color: colors.muted }}>· {when(t.starts_at)} · {t.status}</Text></Line>)}
            </Section>
          )}

          <View style={{ marginTop: 18, borderTopWidth: 1, borderColor: colors.border, paddingTop: 14 }}>
            {h.user.is_admin ? <Muted>Admin accounts cannot be deleted.</Muted> : (
              <>
                <Note kind="error">
                  Deleting removes this account
                  {h.linked_accounts.length > 0 ? ` and its ${h.linked_accounts.length} co-owner and sub-user login${h.linked_accounts.length === 1 ? '' : 's'}` : ''}
                  {h.courts > 0 ? `, ${plural(h.branches.length, 'branch', 'branches')} and ${plural(h.courts, 'court')}` : ''}
                  , {plural(h.bookings.length, 'booking')} with their payments, and {plural(games, 'game')}. This cannot be undone.
                </Note>
                {(h.courts > 0 || h.user.role === 'player') && (
                  <Muted>{h.courts > 0
                    ? 'If the owner left and a co-owner is taking over, close this and use Transfer ownership instead, so the courts and bookings stay.'
                    : 'To stop this player booking without losing their history, close this and use Block instead.'}</Muted>
                )}
                <Field label={`Type ${confirmWord} to confirm`} value={typed} onChangeText={setTyped} autoCapitalize="none" autoCorrect={false} />
                <Button title={busy ? 'Deleting...' : 'Delete user permanently'} onPress={remove} loading={busy} disabled={typed.trim().toLowerCase() !== confirmWord} />
              </>
            )}
          </View>
        </>
      )}
    </Sheet>
  );
}
