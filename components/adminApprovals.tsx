import { useCallback, useEffect, useState } from 'react';
import { Alert, Image, Linking, Pressable, View } from 'react-native';
import { Text } from '@/components/AppText';
import { photoUrl, SITE_URL, supabase } from '@/lib/supabase';
import { egp } from '@/lib/format';
import { searchMatches } from '@/lib/courtTimes';
import { colors } from '@/lib/theme';
import { Card, Line } from './admin';
import { Check } from './ownerCourts';
import { Badge, H2, LinkButton, Muted, Pager, PAGE_SIZE, Sheet } from './owner';
import { Button, Field, Note } from './ui';

// The pieces of Admin → Courts & Owners, ported from the website's AdminOwners, AdminOwnershipTransfers,
// TransferOwnershipDialog, AdminPhotos, AdminExtras and AdminChanges.

const when = (d: string) => new Date(d).toLocaleString('en-GB', { timeZone: 'Africa/Cairo', dateStyle: 'medium', timeStyle: 'short' });
type Msg = { ok: boolean; text: string } | null;
const Notice = ({ msg }: { msg: Msg }) => (msg ? <Note kind={msg.ok ? 'ok' : 'error'}>{msg.text}</Note> : null);

// ---------- new owners ----------
type Owner = {
  id: string; full_name: string; email: string; phone: string | null; owner_status: 'pending' | 'approved' | 'rejected' | 'frozen'; email_confirmed: boolean;
  created_at: string; owner_reviewed_at: string | null; owner_reject_reason: string | null; business_name?: string | null; co_owner?: string | null;
  branches: { name: string; city: string; address: string; instapay_link: string | null; is_approved: boolean }[];
};
type Review = { owner_id: string; kind: string; note: string | null; created_at: string };
const REVIEW_LABEL: Record<string, string> = {
  signed_up: 'Signed up', approved: 'Approved', rejected: 'Not approved', resubmitted: 'Asked for another review', approval_removed: 'Approval taken back',
  frozen: 'Frozen', unfrozen: 'Unfrozen', appealed: 'Appealed the freeze', appeal_declined: 'Appeal declined',
};
const waitingDays = (o: Owner) => Math.floor((Date.now() - new Date(o.owner_reviewed_at || o.created_at).getTime()) / 86_400_000);

function ReviewHistory({ items }: { items: Review[] }) {
  if (!items.length) return <Muted style={{ fontSize: 12 }}>No history yet.</Muted>;
  return <View style={{ borderLeftWidth: 2, borderColor: colors.border, paddingLeft: 8, marginTop: 4 }}>{items.map((r, i) => <Line key={i} size={12}><Text style={{ fontWeight: '700' }}>{REVIEW_LABEL[r.kind] || r.kind}</Text> · {when(r.created_at)}{r.note ? ` — ${r.note}` : ''}</Line>)}</View>;
}

// asks for a short text (the website's window.prompt)
function Ask({ title, label, onCancel, onDone, busy }: { title: string; label: string; onCancel: () => void; onDone: (v: string) => void; busy: boolean }) {
  const [v, setV] = useState('');
  return (
    <Sheet title={title} onClose={onCancel}>
      <Field label={label} value={v} onChangeText={setV} />
      <Button title={busy ? 'Saving…' : 'Confirm'} onPress={() => onDone(v)} loading={busy} />
    </Sheet>
  );
}

export function AdminOwners({ onChanged }: { onChanged?: () => void }) {
  const [owners, setOwners] = useState<Owner[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [rejecting, setRejecting] = useState<{ id: string; reason: string } | null>(null);
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [showRecent, setShowRecent] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [asking, setAsking] = useState<{ o: Owner; kind: 'freeze' | 'decline' } | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_pending_owners');
    if (error) return setMsg({ ok: false, text: `Could not load owners: ${error.message}` });
    const list = (data as Owner[]) || [];
    setOwners(list);
    if (list.length) {
      const { data: r } = await supabase.from('owner_reviews').select('owner_id, kind, note, created_at').in('owner_id', list.map((o) => o.id)).order('created_at', { ascending: true });
      setReviews((r as Review[]) || []);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const historyOf = (id: string) => reviews.filter((r) => r.owner_id === id);
  const askedAgain = (id: string) => { const h = historyOf(id); const last = h[h.length - 1]; return last?.kind === 'resubmitted' ? last : null; };
  const openAppeal = (id: string) => { const last = historyOf(id).filter((r) => ['frozen', 'appealed', 'appeal_declined'].includes(r.kind)).pop(); return last?.kind === 'appealed' ? last : null; };

  // emails the co-owner the owner entered at sign-up (only once the owner is approved)
  async function sendCoOwnerInvite(ownerId: string) {
    const { data, error } = await supabase.functions.invoke('staff-invite', { body: { action: 'admin_co_owner', owner_id: ownerId, redirect_to: `${SITE_URL}/accept-invite` } });
    if (error || data?.error) {
      let text = data?.error || 'Something went wrong.';
      try { const b = error && (await (error as any).context?.json()); if (b?.error) text = b.error; } catch {}
      return ` ⚠️ Co-owner invite not sent: ${text}`;
    }
    return data?.email ? ` 📧 Invite sent to the co-owner (${data.email}).` : '';
  }

  async function review(o: Owner, approve: boolean, reason?: string) {
    setBusy(o.id);
    setMsg(null);
    const { error } = await supabase.rpc('admin_review_owner', { p_user_id: o.id, p_approve: approve, p_reason: reason || null });
    setBusy(null);
    if (error) return setMsg({ ok: false, text: error.message });
    const co = approve && o.co_owner ? await sendCoOwnerInvite(o.id) : '';
    setRejecting(null);
    setMsg({ ok: true, text: approve
      ? o.branches.some((b) => !b.is_approved)
        ? `✅ ${o.full_name} can now use the owner dashboard. Their branch is still waiting below — approve it when you're happy with it.${co}`
        : `✅ ${o.full_name} can now use the owner dashboard. Their branches will show up here when they add them.${co}`
      : `${o.full_name} was not approved. They'll see this when they log in.` });
    await load();
    onChanged?.();
  }

  async function freeze(o: Owner, reason: string) {
    setBusy(o.id);
    const { error } = await supabase.rpc('admin_freeze_owner', { p_user_id: o.id, p_reason: reason || null });
    setBusy(null);
    setAsking(null);
    if (error) return setMsg({ ok: false, text: error.message });
    setMsg({ ok: true, text: `❄️ ${o.full_name} is frozen. We emailed them.` });
    load(); onChanged?.();
  }
  function unfreeze(o: Owner) {
    Alert.alert(`Unfreeze ${o.full_name}?`, 'Their branches go back in front of players.', [{ text: 'Cancel', style: 'cancel' }, {
      text: 'Unfreeze', onPress: async () => {
        setBusy(o.id);
        const { error } = await supabase.rpc('admin_unfreeze_owner', { p_user_id: o.id });
        setBusy(null);
        if (error) return setMsg({ ok: false, text: error.message });
        setMsg({ ok: true, text: `✅ ${o.full_name} is active again and their branches are back. We emailed them.` });
        load(); onChanged?.();
      },
    }]);
  }
  async function declineAppeal(o: Owner, note: string) {
    setBusy(o.id);
    const { error } = await supabase.rpc('admin_decline_owner_appeal', { p_user_id: o.id, p_note: note || null });
    setBusy(null);
    setAsking(null);
    if (error) return setMsg({ ok: false, text: error.message });
    setMsg({ ok: true, text: `${o.full_name}'s appeal was declined. We emailed them.` });
    load();
  }

  const found = owners.filter((o) => searchMatches(search, [o.full_name, o.email, o.phone, o.business_name].join(' ')));
  const waiting = found.filter((o) => o.owner_status === 'pending' && o.email_confirmed);
  const unconfirmed = found.filter((o) => o.owner_status === 'pending' && !o.email_confirmed);
  const recent = found.filter((o) => o.owner_status !== 'pending');
  const appeals = found.filter((o) => o.owner_status === 'frozen' && openAppeal(o.id));
  const recentOpen = showRecent || search.trim() !== '';

  return (
    <View style={{ marginBottom: 20 }}>
      <H2>New owners {waiting.length + appeals.length > 0 ? `(${waiting.length + appeals.length})` : ''}</H2>
      <Notice msg={msg} />
      {owners.length > 0 && <Field label="Search owners by name, email or phone" value={search} onChangeText={(v) => { setSearch(v); setPage(1); }} />}
      {appeals.map((o) => {
        const a = openAppeal(o.id)!;
        return (
          <Card key={o.id} tone="warn">
            <Line bold>❄️ {o.full_name} · {o.email} · {o.phone}</Line>
            {o.owner_reject_reason && <Line muted>Frozen for: {o.owner_reject_reason}</Line>}
            <Line><Text style={{ fontWeight: '700' }}>Appeal ({when(a.created_at)}):</Text> {a.note}</Line>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
              <View style={{ flex: 1 }}><Button small title="Accept and unfreeze" onPress={() => unfreeze(o)} loading={busy === o.id} /></View>
              <View style={{ flex: 1 }}><Button small variant="ghost" title="Decline appeal" onPress={() => setAsking({ o, kind: 'decline' })} /></View>
            </View>
          </Card>
        );
      })}
      {waiting.length === 0 ? <Muted style={{ marginBottom: 6 }}>{search.trim() ? 'No waiting owners match your search.' : 'No owners waiting. 🎉'}</Muted>
        : waiting.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((o) => (
          <Card key={o.id} tone="warn">
            <Line bold size={16}>{o.full_name || '—'}</Line>
            <Line muted>{o.email} · {o.phone || 'no phone'} · ✉️ email confirmed</Line>
            <Line muted size={12}>Signed up {when(o.created_at)}{waitingDays(o) >= 1 ? ` · waiting ${waitingDays(o)} day${waitingDays(o) === 1 ? '' : 's'}` : ''}</Line>
            {askedAgain(o.id) && <Line>🔁 <Text style={{ fontWeight: '700' }}>Asked again</Text> {when(askedAgain(o.id)!.created_at)}: {askedAgain(o.id)!.note}</Line>}
            {o.business_name && <Line bold>{o.business_name}</Line>}
            {o.co_owner && <Line muted>Co-owner: {o.co_owner}</Line>}
            {o.branches.map((b, i) => <Line key={i}><Text style={{ fontWeight: '700' }}>{b.name}</Text> — {b.address}, {b.city}{b.instapay_link ? ` · InstaPay: ${b.instapay_link}` : ''}</Line>)}
            <LinkButton title={historyFor === o.id ? 'Hide history' : 'History'} onPress={() => setHistoryFor(historyFor === o.id ? null : o.id)} />
            {historyFor === o.id && <ReviewHistory items={historyOf(o.id)} />}
            {rejecting?.id === o.id ? (
              <View style={{ marginTop: 6 }}>
                <Field label="Reason (the owner will see it) — optional" value={rejecting.reason} onChangeText={(v) => setRejecting({ id: o.id, reason: v })} />
                <Button small title="Confirm: don't approve" onPress={() => review(o, false, rejecting.reason)} loading={busy === o.id} />
                <LinkButton title="Cancel" onPress={() => setRejecting(null)} />
              </View>
            ) : (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                <View style={{ flex: 1 }}><Button small title="Approve owner" onPress={() => review(o, true)} loading={busy === o.id} /></View>
                <View style={{ flex: 1 }}><Button small variant="ghost" title="Don't approve" onPress={() => setRejecting({ id: o.id, reason: '' })} /></View>
              </View>
            )}
          </Card>
        ))}
      <Pager page={page} total={waiting.length} onChange={setPage} />
      {unconfirmed.length > 0 && <Muted style={{ fontSize: 12 }}>⏳ Email not confirmed yet: {unconfirmed.map((o) => `${o.full_name || o.email} (${o.email})`).join(', ')}</Muted>}
      {recent.length > 0 && <LinkButton title={`${recentOpen ? 'Hide' : 'Show'} owners reviewed in the last 7 days / not approved (${recent.length})`} onPress={() => setShowRecent(!recentOpen)} />}
      {recentOpen && recent.map((o) => (
        <Card key={o.id}>
          <Line bold>{o.full_name} · {o.email}</Line>
          <Badge tone={o.owner_status === 'approved' ? 'ok' : o.owner_status === 'frozen' ? 'info' : 'bad'}
            text={o.owner_status === 'approved' ? 'Approved' : `${o.owner_status === 'frozen' ? 'Frozen' : 'Not approved'}${o.owner_reject_reason ? `: ${o.owner_reject_reason}` : ''}`} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {o.owner_status === 'rejected' ? <LinkButton title="Approve after all" onPress={() => review(o, true)} disabled={busy === o.id} />
              : o.owner_status === 'frozen' ? <LinkButton title="Unfreeze" onPress={() => unfreeze(o)} disabled={busy === o.id} />
              : <>
                {o.co_owner && <LinkButton title="Send co-owner invite" onPress={async () => { setBusy(o.id); const n = await sendCoOwnerInvite(o.id); setBusy(null); setMsg({ ok: !n.includes('⚠️'), text: n.trim() }); load(); }} disabled={busy === o.id} />}
                <LinkButton danger title="Take back approval (freeze)" onPress={() => setAsking({ o, kind: 'freeze' })} disabled={busy === o.id} />
              </>}
            <LinkButton title={historyFor === o.id ? 'Hide history' : 'History'} onPress={() => setHistoryFor(historyFor === o.id ? null : o.id)} />
          </View>
          {historyFor === o.id && <ReviewHistory items={historyOf(o.id)} />}
        </Card>
      ))}
      {asking && (
        <Ask busy={busy === asking.o.id} onCancel={() => setAsking(null)}
          title={asking.kind === 'freeze' ? `Freeze ${asking.o.full_name}?` : `Decline ${asking.o.full_name}'s appeal?`}
          label={asking.kind === 'freeze'
            ? "Their branches are hidden and they can't change anything, but they still see their dashboard. Bookings already made stay. Reason (shown to the owner, optional)"
            : 'Their account stays frozen. Note for the owner (emailed, optional)'}
          onDone={(v) => (asking.kind === 'freeze' ? freeze(asking.o, v) : declineAppeal(asking.o, v))} />
      )}
    </View>
  );
}

// ---------- ownership transfers ----------
type CoOwner = { staff_id: string; full_name: string; email: string; ready: boolean; status: string };
type Preview = { branches: number; courts: number; upcoming_bookings: number; pending_payouts: number; team: number; co_owners: CoOwner[] };

// the admin hands an owner's whole business to one of their co-owners (the owner left)
export function TransferOwnership({ owner, preferredStaffId, onClose, onDone }: {
  owner: { id: string; full_name: string | null; email: string | null }; preferredStaffId?: string | null; onClose: () => void; onDone: (msg: string) => void;
}) {
  const [p, setP] = useState<Preview | null>(null);
  const [staffId, setStaffId] = useState(preferredStaffId || '');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ownerName = owner.full_name || owner.email || 'this owner';
  useEffect(() => {
    supabase.rpc('admin_ownership_preview', { p_owner: owner.id }).then(({ data, error: e }) => {
      if (e) return setError(e.message);
      const d = data as Preview;
      setP(d);
      if (!preferredStaffId) { const ready = d.co_owners.filter((c) => c.ready); if (ready.length === 1) setStaffId(ready[0].staff_id); }
    });
  }, [owner.id, preferredStaffId]);
  async function transfer() {
    setBusy(true);
    setError('');
    const { data, error: e } = await supabase.rpc('admin_transfer_ownership', { p_owner: owner.id, p_staff_id: staffId });
    setBusy(false);
    if (e) return setError(e.message);
    const d = (data || {}) as { new_owner?: string; branches?: number };
    onDone(`${d.new_owner || 'The co-owner'} is now the owner of ${d.branches ?? 0} branch${d.branches === 1 ? '' : 'es'}. ${ownerName} is a player now.`);
  }
  const picked = p?.co_owners.find((c) => c.staff_id === staffId);
  return (
    <Sheet title={`Transfer ownership from ${ownerName}`} onClose={() => !busy && onClose()}>
      {!p && !error && <Muted>Loading...</Muted>}
      {p && (
        <>
          <Line>• {p.branches} branch{p.branches === 1 ? '' : 'es'} and {p.courts} court{p.courts === 1 ? '' : 's'} move to the new owner</Line>
          <Line>• {p.upcoming_bookings} upcoming booking{p.upcoming_bookings === 1 ? '' : 's'} stay booked</Line>
          <Line>• {p.team} sub-user{p.team === 1 ? '' : 's'} move to the new owner's team</Line>
          {p.pending_payouts > 0 && <Text style={{ color: colors.warning, fontWeight: '700' }}>• {p.pending_payouts} transfer(s) still pending. Settle them in Owner Settlements first.</Text>}
          {p.co_owners.length === 0 ? <Muted>This owner has no co-owner. The owner must invite one from their Team tab first.</Muted> : (
            <View style={{ marginTop: 8 }}>
              <Line bold>New owner</Line>
              {p.co_owners.map((c) => <Check key={c.staff_id} on={staffId === c.staff_id} onPress={() => c.ready && setStaffId(c.staff_id)} title={`${c.full_name} · ${c.email}`} help={c.ready ? undefined : "Hasn't accepted the invite yet, so they can't take over."} />)}
            </View>
          )}
          {picked && (
            <>
              <Note kind="error">{picked.full_name} becomes the owner and receives Zaf Play transfers from now on. {ownerName} loses access and keeps a player account. Both get an email.</Note>
              <Field label="Type TRANSFER to confirm" value={confirm} onChangeText={setConfirm} autoCapitalize="characters" autoCorrect={false} />
            </>
          )}
        </>
      )}
      {!!error && <Note kind="error">{error}</Note>}
      <Button title={busy ? 'Transferring...' : 'Transfer ownership'} onPress={transfer} loading={busy} disabled={!picked || confirm.trim().toUpperCase() !== 'TRANSFER'} />
    </Sheet>
  );
}

export function AdminOwnershipTransfers({ onChanged }: { onChanged?: () => void }) {
  const [rows, setRows] = useState<any[]>([]);
  const [open, setOpen] = useState<any | null>(null);
  const [declining, setDeclining] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const { data } = await supabase.from('ownership_transfers')
      .select('id, owner_id, staff_id, new_owner_name, note, created_at, owner:users!ownership_transfers_owner_id_fkey ( full_name, email ), requester:users!ownership_transfers_requested_by_fkey ( full_name )')
      .eq('status', 'pending').order('created_at', { ascending: true });
    setRows((data as any[]) || []);
  }, []);
  useEffect(() => { load(); }, [load]);
  async function decline(id: string) {
    setBusy(true);
    const { error } = await supabase.rpc('admin_decline_ownership_transfer', { p_id: id, p_reason: reason });
    setBusy(false);
    if (error) return setMessage(`❌ ${error.message}`);
    setDeclining(null); setReason('');
    setMessage('Request declined. They got an email with your reason.');
    load();
  }
  if (rows.length === 0 && !message) return null;
  return (
    <View style={{ marginBottom: 20 }}>
      <H2>Ownership transfers {rows.length ? `(${rows.length})` : ''}</H2>
      {!!message && <Line>{message}</Line>}
      {rows.map((r) => (
        <Card key={r.id}>
          <Line bold>{r.owner?.full_name || r.owner?.email} → {r.new_owner_name || 'co-owner'}</Line>
          <Line muted size={12}>Asked by {r.requester?.full_name || '—'} · {when(r.created_at)}</Line>
          {r.note && <Line>Note: “{r.note}”</Line>}
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
            <View style={{ flex: 1 }}><Button small title="Review & transfer" onPress={() => setOpen(r)} /></View>
            <View style={{ flex: 1 }}><Button small variant="ghost" title="Decline" onPress={() => { setDeclining(declining === r.id ? null : r.id); setReason(''); }} /></View>
          </View>
          {declining === r.id && (
            <View style={{ marginTop: 8 }}>
              <Field label="Reason they will see" value={reason} onChangeText={setReason} />
              <Button small title="Decline request" onPress={() => decline(r.id)} loading={busy} disabled={!reason.trim()} />
            </View>
          )}
        </Card>
      ))}
      {open && <TransferOwnership owner={{ id: open.owner_id, full_name: open.owner?.full_name || null, email: open.owner?.email || null }} preferredStaffId={open.staff_id}
        onClose={() => setOpen(null)} onDone={(m) => { setOpen(null); setMessage(`✅ ${m}`); load(); onChanged?.(); }} />}
    </View>
  );
}

// ---------- new photos on live courts ----------
export function AdminPhotos() {
  const [photos, setPhotos] = useState<any[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [decliningId, setDecliningId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const load = useCallback(async () => {
    const { data } = await supabase.from('court_photos')
      .select('id, path, created_at, court:courts!inner ( id, name, is_approved, facility:facilities!inner ( name, city, is_approved, owner:users ( full_name ) ) )')
      .eq('status', 'pending').eq('court.is_approved', true).eq('court.facility.is_approved', true).order('created_at', { ascending: true });
    setPhotos((data as any[]) || []);
  }, []);
  useEffect(() => { load(); }, [load]);
  async function review(id: string, approve: boolean) {
    setBusyId(id);
    setMessage('');
    const { error } = await supabase.rpc('admin_review_court_photo', { p_photo_id: id, p_approve: approve, p_reason: approve ? null : reason });
    setBusyId(null);
    if (error) return setMessage(`❌ ${error.message}`);
    setDecliningId(null); setReason('');
    load();
  }
  async function approveAll(courtId: string) {
    for (const p of photos.filter((x) => x.court?.id === courtId)) {
      setBusyId(p.id);
      await supabase.rpc('admin_review_court_photo', { p_photo_id: p.id, p_approve: true, p_reason: null });
    }
    setBusyId(null);
    load();
  }
  const groups: { court: any; photos: any[] }[] = [];
  for (const p of photos) {
    let g = groups.find((x) => x.court?.id === p.court?.id);
    if (!g) { g = { court: p.court, photos: [] }; groups.push(g); }
    g.photos.push(p);
  }
  if (!photos.length) return null;
  return (
    <View style={{ marginBottom: 20 }}>
      <H2>New photos on live courts ({photos.length})</H2>
      {!!message && <Line>{message}</Line>}
      {groups.map((g) => (
        <Card key={g.court?.id}>
          <Line><Text style={{ fontWeight: '700' }}>{g.court?.name}</Text> · {g.court?.facility?.name}, {g.court?.facility?.city} · {g.court?.facility?.owner?.full_name}</Line>
          {g.photos.length > 1 && <LinkButton title={`Approve all ${g.photos.length}`} onPress={() => approveAll(g.court?.id)} disabled={!!busyId} />}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
            {g.photos.map((p) => (
              <View key={p.id} style={{ width: '47%' }}>
                <Pressable accessibilityRole="button" onPress={() => { const u = photoUrl(p.path); if (u) Linking.openURL(u); }}>
                  <Image source={{ uri: photoUrl(p.path) || undefined }} style={{ width: '100%', aspectRatio: 4 / 3, borderRadius: 8 }} />
                </Pressable>
                {decliningId === p.id ? (
                  <View>
                    <Field label="Reason for the owner" value={reason} onChangeText={setReason} />
                    <LinkButton danger title="Decline" onPress={() => review(p.id, false)} disabled={busyId === p.id} />
                    <LinkButton title="Back" onPress={() => setDecliningId(null)} />
                  </View>
                ) : (
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <LinkButton title="Approve" onPress={() => review(p.id, true)} disabled={busyId === p.id} />
                    <LinkButton danger title="Decline" onPress={() => { setDecliningId(p.id); setReason(''); }} />
                  </View>
                )}
              </View>
            ))}
          </View>
        </Card>
      ))}
    </View>
  );
}

// ---------- court extras ----------
export function AdminExtras() {
  const [items, setItems] = useState<any[]>([]);
  const [reason, setReason] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const load = useCallback(async () => {
    const { data } = await supabase.from('court_extras').select('id, name, price, max_qty, is_required, sport:sports ( name ), court:courts ( name, facility:facilities ( name ) )')
      .eq('status', 'pending').eq('is_active', true).order('created_at');
    setItems((data as any[]) || []);
  }, []);
  useEffect(() => { load(); }, [load]);
  async function review(id: string, approve: boolean) {
    setBusy(id);
    const { error } = await supabase.rpc('admin_review_extra', { p_id: id, p_approve: approve, p_reason: reason[id] || null });
    setBusy('');
    setMsg(error ? `❌ ${error.message}` : approve ? '✅ Extra approved.' : 'Extra rejected.');
    load();
  }
  if (!items.length) return null;
  return (
    <View style={{ marginBottom: 20 }}>
      <H2>Court extras to approve ({items.length})</H2>
      {!!msg && <Line>{msg}</Line>}
      {items.map((e) => (
        <Card key={e.id}>
          <Line bold>{e.name} · {egp(Number(e.price))} · {e.is_required ? 'added to every booking' : `up to ${e.max_qty}`}</Line>
          <Line muted size={12}>{e.court?.facility?.name} — {e.court?.name} · {e.sport?.name || 'All sports'}</Line>
          <Field label="Reason if rejecting (the owner sees it)" value={reason[e.id] || ''} onChangeText={(v) => setReason({ ...reason, [e.id]: v })} />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}><Button small title="Approve" onPress={() => review(e.id, true)} loading={busy === e.id} /></View>
            <View style={{ flex: 1 }}><Button small variant="ghost" title="Reject" onPress={() => review(e.id, false)} disabled={busy === e.id} /></View>
          </View>
        </Card>
      ))}
    </View>
  );
}

// ---------- owner edits to live branches and courts ----------
type Row = { label: string; before: string; after: string };
const sportsText = (list: { name: string; price: number | string }[]) => list.map((s) => `${s.name} ${Number(s.price)} EGP/hr`).join(', ') || '—';

export function AdminChanges({ onChanged }: { onChanged?: () => void }) {
  const [changes, setChanges] = useState<any[]>([]);
  const [rows, setRows] = useState<Record<string, Row[]>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const load = useCallback(async () => {
    const { data } = await supabase.from('change_requests')
      .select('id, entity_type, entity_id, payload, created_at, facility:facilities ( name, city, address, instapay_link ), owner:users!change_requests_owner_id_fkey ( full_name, phone )')
      .eq('status', 'pending').order('created_at', { ascending: true });
    const list = (data as any[]) || [];
    setChanges(list);
    const { data: sp } = await supabase.from('sports').select('id, name');
    const sportName: Record<string, string> = {};
    ((sp as any[]) || []).forEach((s) => (sportName[s.id] = s.name));
    const courtIds = list.filter((c) => c.entity_type === 'court').map((c) => c.entity_id);
    const cur: Record<string, any> = {};
    if (courtIds.length) {
      const { data: cs } = await supabase.from('courts').select('id, name, is_indoor, surface_type, maps_url, late_fee_percent, court_sports ( price_per_hour, sport:sports ( name ) )').in('id', courtIds);
      ((cs as any[]) || []).forEach((c) => (cur[c.id] = c));
    }
    const built: Record<string, Row[]> = {};
    for (const c of list) {
      const p = c.payload || {};
      const r: Row[] = c.entity_type === 'facility'
        ? [{ label: 'Name', before: c.facility?.name, after: p.name }, { label: 'Area', before: c.facility?.city, after: p.city }, { label: 'Address', before: c.facility?.address, after: p.address }, { label: 'InstaPay', before: c.facility?.instapay_link, after: p.instapay_link }]
        : (() => {
          const k = cur[c.entity_id] || {};
          return [
            { label: 'Name', before: k.name, after: p.name },
            { label: 'Type', before: k.is_indoor ? 'Indoor' : 'Outdoor', after: p.is_indoor ? 'Indoor' : 'Outdoor' },
            { label: 'Surface', before: k.surface_type || '—', after: p.surface_type || '—' },
            { label: 'Sports & prices', before: sportsText((k.court_sports || []).map((cs: any) => ({ name: cs.sport?.name, price: cs.price_per_hour }))), after: sportsText((p.sports || []).map((s: any) => ({ name: sportName[s.sport_id] || '?', price: s.price_per_hour }))) },
            { label: 'Google Maps', before: k.maps_url, after: p.maps_url },
          ];
        })();
      built[c.id] = r.map((x) => ({ ...x, before: String(x.before ?? '—'), after: String(x.after ?? '—') }));
    }
    setRows(built);
  }, []);
  useEffect(() => { load(); }, [load]);
  async function reviewChange(id: string, approve: boolean) {
    if (!approve && !reason.trim()) return setMessage('⚠️ Please write a short reason — the owner will see it.');
    setBusyId(id);
    setMessage('');
    const { error } = await supabase.rpc('admin_review_change', { p_request_id: id, p_approve: approve, p_reason: reason });
    setBusyId(null);
    if (error) return setMessage(`❌ ${error.message}`);
    setRejectingId(null); setReason('');
    setMessage(approve ? '✅ Change approved — it is live now.' : 'Change rejected — the owner will see your reason.');
    load(); onChanged?.();
  }
  if (!changes.length) return message ? <Line>{message}</Line> : null;
  return (
    <View style={{ marginBottom: 20 }}>
      <H2>Owner changes ({changes.length})</H2>
      {!!message && <Line>{message}</Line>}
      {changes.map((c) => (
        <Card key={c.id}>
          <Line bold>{c.entity_type === 'facility' ? 'Branch details' : 'Court details'} · {c.facility?.name}</Line>
          <Line muted size={12}>by {c.owner?.full_name} ({c.owner?.phone}) · {when(c.created_at)}</Line>
          {(rows[c.id] || []).map((r) => {
            const changed = r.before !== r.after;
            return (
              <View key={r.label} style={{ borderTopWidth: 1, borderColor: colors.border, paddingVertical: 4, backgroundColor: changed ? colors.noteBg : 'transparent' }}>
                <Line muted size={11}>{r.label}</Line>
                <Line size={12}>Now: {r.before}</Line>
                <Text style={{ color: changed ? colors.text : colors.muted, fontWeight: changed ? '700' : '400', fontSize: 12 }}>Requested: {r.after}</Text>
              </View>
            );
          })}
          {rejectingId === c.id ? (
            <View style={{ marginTop: 6 }}>
              <Field label="Reason for the owner" value={reason} onChangeText={setReason} />
              <Button small title="Reject" onPress={() => reviewChange(c.id, false)} loading={busyId === c.id} />
              <LinkButton title="Back" onPress={() => setRejectingId(null)} />
            </View>
          ) : (
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
              <View style={{ flex: 1 }}><Button small title="Approve change" onPress={() => reviewChange(c.id, true)} loading={busyId === c.id} /></View>
              <View style={{ flex: 1 }}><Button small variant="ghost" title="Reject" onPress={() => { setRejectingId(c.id); setReason(''); }} /></View>
            </View>
          )}
        </Card>
      ))}
    </View>
  );
}
