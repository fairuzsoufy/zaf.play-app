import { useCallback, useEffect, useState } from 'react';
import { Image, Linking, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Stack, useFocusEffect } from 'expo-router';
import { Text } from '@/components/AppText';
import { photoUrl, supabase } from '@/lib/supabase';
import { searchMatches } from '@/lib/courtTimes';
import { colors } from '@/lib/theme';
import { Card, Line } from '@/components/admin';
import { AdminChanges, AdminExtras, AdminOwners, AdminOwnershipTransfers, AdminPhotos } from '@/components/adminApprovals';
import { Badge, H2, LinkButton, Loading, Muted, Pager, PAGE_SIZE } from '@/components/owner';
import { Button, Field, Note } from '@/components/ui';

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const one = (x: any) => (Array.isArray(x) ? x[0] : x);
function hoursText(rules: any[]) {
  const open = (rules || []).filter((r) => !r.is_closed);
  if (!open.length) return null;
  const from = open.map((r) => r.open_time.slice(0, 5)).sort()[0];
  const to = open.map((r) => r.close_time.slice(0, 5)).sort().reverse()[0];
  const closed = (rules || []).filter((r) => r.is_closed).map((r) => DAY_SHORT[r.day_of_week]);
  return `${from}–${to}${closed.length ? ` · closed ${closed.join(', ')}` : ' · every day'}`;
}
// what a court still needs before it can be approved
function missing(c: any) {
  const list: string[] = [];
  if (!(c.court_photos || []).some((p: any) => p.status !== 'rejected')) list.push('a photo');
  if (!one(c.court_contacts)?.phone) list.push('a court phone number');
  if (!hoursText(c.availability_rules)) list.push('working hours');
  return list;
}
const courtText = (f: any, c: any) => [f.name, f.city, f.owner?.full_name, f.owner?.email, c?.name, ...(c?.court_sports || []).map((cs: any) => cs.sport?.name)].join(' ');
const branchMatches = (q: string, f: any) => searchMatches(q, courtText(f, null)) || (f.courts || []).some((c: any) => searchMatches(q, courtText(f, c)));

// Courts & Owners, like the website's /admin/approvals: new owners, ownership transfers, then each waiting branch
// with its waiting courts. A branch is approved first; its courts (with their photos) after that.
export default function AdminApprovals() {
  const [facilities, setFacilities] = useState<any[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [othersPage, setOthersPage] = useState(1);
  const [key, setKey] = useState(0); // reloads the sections below when the screen comes back
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('facilities').select(`
      id, name, city, address, instapay_link, is_approved, is_active, created_at,
      owner:users ( full_name, email, phone, owner_status ),
      courts ( id, name, is_indoor, surface_type, maps_url, is_approved, is_active, created_at,
               court_sports ( price_per_hour, sport:sports ( name ) ),
               court_photos ( id, path, status, sort_order ),
               court_contacts ( phone ),
               availability_rules ( day_of_week, open_time, close_time, is_closed ) )`).order('created_at', { ascending: false });
    if (error) return setMessage(`Could not load branches: ${error.message}`);
    setFacilities((data as any[]) || []);
  }, []);
  useFocusEffect(useCallback(() => { load(); setKey((k) => k + 1); }, [load]));
  useEffect(() => { const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);

  async function approveBranch(f: any, withCourts: boolean) {
    setBusyId(f.id);
    setMessage('');
    const { data, error } = await supabase.rpc('admin_approve_branch', { p_facility_id: f.id, p_courts: withCourts });
    setBusyId(null);
    if (error) return setMessage(`❌ ${error.message}`);
    const d = data as any;
    const skipped = (d?.skipped || []) as { name: string; reason: string }[];
    setMessage(`✅ ${f.name} approved.${withCourts ? ` ${d?.approved_courts || 0} court(s) approved with their photos.` : ' Now approve its courts below.'}${skipped.length ? ` Not approved yet: ${skipped.map((s) => `${s.name} (${s.reason})`).join(', ')}.` : ''}`);
    load();
  }
  async function reviewCourt(c: any, approve: boolean) {
    setBusyId(c.id);
    setMessage('');
    const { error } = await supabase.rpc('admin_set_court_approval', { p_court_id: c.id, p_approve: approve });
    setBusyId(null);
    if (error) return setMessage(`❌ ${error.message}`);
    setMessage(approve ? `✅ ${c.name} and its photos approved — its Trial period starts now.` : `${c.name} rejected (disabled).`);
    load();
  }
  async function setVisible(f: any, visible: boolean) {
    setBusyId(f.id);
    const { error } = await supabase.from('facilities').update({ is_approved: visible }).eq('id', f.id);
    setBusyId(null);
    if (error) return setMessage(`❌ ${error.message}`);
    setMessage(visible ? `✅ ${f.name} is visible again.` : `${f.name} is hidden from players.`);
    load();
  }

  if (!facilities) return <Loading />;
  const waitingCourts = (f: any) => (f.courts || []).filter((c: any) => !c.is_approved && c.is_active);
  // branches of owners who aren't approved yet are shown with the owner (New owners, above)
  const waiting = facilities.filter((f) => f.is_active && !['pending', 'frozen'].includes(f.owner?.owner_status) && (!f.is_approved || waitingCourts(f).length > 0));
  const others = facilities.filter((f) => !waiting.includes(f));
  const waitingFound = waiting.filter((f) => branchMatches(search, f));
  const othersFound = others.filter((f) => branchMatches(search, f));
  const allOpen = showAll || search.trim() !== '';

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.primary} onRefresh={async () => { setRefreshing(true); await load(); setKey((k) => k + 1); setRefreshing(false); }} />}>
      <Stack.Screen options={{ title: 'Courts & Owners' }} />
      <Muted style={{ marginBottom: 12 }}>Only what is waiting for you. Every owner with their branches and courts is in People → Owners.</Muted>
      <AdminOwnershipTransfers key={`t${key}`} onChanged={load} />
      <AdminOwners key={`o${key}`} onChanged={load} />

      <H2>Branches & courts {waiting.length ? `(${waiting.length})` : ''}</H2>
      {!!message && <Note kind={message.startsWith('❌') ? 'error' : 'ok'}>{message}</Note>}
      <Field label="Search courts by name, owner or sport" value={search} onChangeText={(v) => { setSearch(v); setPage(1); setOthersPage(1); }} />
      {waitingFound.length === 0 ? <Muted style={{ marginBottom: 20 }}>{search.trim() && waiting.length ? 'No waiting branches or courts match your search.' : 'No branches or courts waiting. 🎉'}</Muted>
        : waitingFound.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((f) => {
          const courts = waitingCourts(f).filter((c: any) => searchMatches(search, courtText(f, c)));
          return (
            <Card key={f.id}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Line bold size={16}>{f.name}</Line>
                <Badge tone={f.is_approved ? 'ok' : 'warn'} text={f.is_approved ? 'Branch approved' : 'New branch'} />
              </View>
              <Line muted>{f.address}, {f.city}</Line>
              <Line muted>Owner: {f.owner?.full_name || '—'} · {f.owner?.phone || '—'} · {f.owner?.email || '—'}</Line>
              <Line muted>InstaPay: {f.instapay_link || '—'}</Line>
              {!f.is_approved && (
                <View style={{ marginTop: 8, gap: 6 }}>
                  {courts.length > 0 && <Button small title="Approve branch + its courts" onPress={() => approveBranch(f, true)} loading={busyId === f.id} />}
                  <Button small variant={courts.length ? 'ghost' : undefined} title="Approve branch only" onPress={() => approveBranch(f, false)} disabled={busyId === f.id} />
                </View>
              )}
              {courts.length === 0 ? <Muted style={{ marginTop: 6 }}>No courts added to this branch yet.</Muted> : courts.map((c: any) => {
                const needs = missing(c);
                const photos = (c.court_photos || []).filter((p: any) => p.status !== 'rejected').sort((a: any, b: any) => a.sort_order - b.sort_order);
                return (
                  <View key={c.id} style={{ borderLeftWidth: 3, borderColor: colors.border, paddingLeft: 10, marginTop: 10 }}>
                    <Line bold>{c.name} <Text style={{ color: colors.muted, fontWeight: '400' }}>· {c.is_indoor ? 'Indoor' : 'Outdoor'}{c.surface_type ? ` · ${c.surface_type}` : ''}</Text></Line>
                    <Line>{(c.court_sports || []).map((cs: any) => `${cs.sport?.name} ${Number(cs.price_per_hour)} EGP/hr`).join(', ') || '—'}</Line>
                    <Line muted size={12}>📞 {one(c.court_contacts)?.phone || '—'} · 🕐 {hoursText(c.availability_rules) || 'no hours yet'}</Line>
                    {!!c.maps_url && <Text style={{ color: colors.primaryAlt, fontSize: 12 }} onPress={() => Linking.openURL(c.maps_url)}>📍 check location</Text>}
                    {photos.length > 0 && (
                      <ScrollView horizontal style={{ marginVertical: 6 }}>
                        {photos.map((p: any) => (
                          <Pressable key={p.id} onPress={() => { const u = photoUrl(p.path); if (u) Linking.openURL(u); }}>
                            <Image source={{ uri: photoUrl(p.path) || undefined }} style={{ width: 96, height: 64, borderRadius: 6, marginRight: 6 }} />
                          </Pressable>
                        ))}
                      </ScrollView>
                    )}
                    {needs.length > 0 && <Text style={{ color: colors.danger, fontSize: 12 }}>Missing: {needs.join(', ')} — ask the owner to add it.</Text>}
                    {!f.is_approved && needs.length === 0 && <Muted style={{ fontSize: 12 }}>Approve the branch first — then this court.</Muted>}
                    <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
                      <View style={{ flex: 1 }}><Button small title="Approve court" onPress={() => reviewCourt(c, true)} loading={busyId === c.id} disabled={!f.is_approved || needs.length > 0} /></View>
                      <View style={{ flex: 1 }}><Button small variant="ghost" title="Reject" onPress={() => reviewCourt(c, false)} disabled={busyId === c.id} /></View>
                    </View>
                  </View>
                );
              })}
            </Card>
          );
        })}
      <Pager page={page} total={waitingFound.length} onChange={setPage} />

      <AdminExtras key={`e${key}`} />
      <AdminPhotos key={`p${key}`} />
      <AdminChanges key={`c${key}`} onChanged={load} />

      <LinkButton title={`${allOpen ? 'Hide' : 'Show'} all branches (${search.trim() ? `${othersFound.length} of ${others.length}` : others.length})`} onPress={() => setShowAll(!allOpen)} />
      {allOpen && (
        <>
          {othersFound.length === 0 && <Muted>No branches match your search.</Muted>}
          {othersFound.slice((othersPage - 1) * PAGE_SIZE, othersPage * PAGE_SIZE).map((f) => (
            <Card key={f.id}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Line bold>{f.name}</Line>
                <Badge tone={f.is_approved ? 'ok' : 'neutral'} text={f.is_approved ? 'Approved' : f.owner?.owner_status === 'pending' ? 'Owner not approved yet' : f.owner?.owner_status === 'frozen' ? 'Owner frozen' : 'Hidden'} />
              </View>
              <Line muted size={12}>{f.address}, {f.city} · {(f.courts || []).length} court(s) · {f.owner?.full_name}</Line>
              {!['pending', 'frozen'].includes(f.owner?.owner_status) && <LinkButton title={f.is_approved ? 'Hide from players' : 'Show again'} onPress={() => setVisible(f, !f.is_approved)} disabled={busyId === f.id} />}
            </Card>
          ))}
          <Pager page={othersPage} total={othersFound.length} onChange={setOthersPage} />
        </>
      )}
    </ScrollView>
  );
}
