import { useCallback, useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, View } from 'react-native';
import { Stack } from 'expo-router';
import { Text } from '@/components/AppText';
import { supabase } from '@/lib/supabase';
import { searchMatches } from '@/lib/courtTimes';
import { colors } from '@/lib/theme';
import { Card, Line } from '@/components/admin';
import { Badge, Box, Chip, Chips, H2, LinkButton, Loading, Muted } from '@/components/owner';
import { Button, Field, Note } from '@/components/ui';

type PlayWhere = 'both' | 'indoor' | 'outdoor';
type Sport = { id: string; name: string; slug: string; emoji: string | null; icon_url: string | null; outdoor_only: boolean; indoor_only: boolean; is_active: boolean; sort_order: number };
type City = { name: string; sort_order: number; is_active: boolean };
type Area = { name: string; city: string; sort_order: number; is_active: boolean };
type Renaming = { kind: 'city' | 'area'; name: string; value: string };
type Deleting = { table: 'sports' | 'cities' | 'areas'; key: 'id' | 'name'; value: string; label: string };

const EMOJI_IDEAS = ['🏐', '🏖️', '🏀', '🎾', '⚽', '🏓', '🏸', '🥅', '🏒', '🏈', '⛳', '🤾', '🟢', '🔵'];
const playWhereOf = (s: Sport): PlayWhere => (s.outdoor_only ? 'outdoor' : s.indoor_only ? 'indoor' : 'both');
const PLAY_LABEL: Record<PlayWhere, string> = { both: 'Indoor & outdoor', indoor: 'Indoor only', outdoor: 'Outdoor only' };

function friendly(msg: string) {
  if (/foreign key|violates/.test(msg)) return 'It is still in use, so it can’t be deleted. Hide it instead.';
  if (/duplicate key|already exists/.test(msg)) return 'That name already exists.';
  if (/areas_name_len|cities_name_check/.test(msg)) return 'Names must be 2 to 40 characters.';
  return msg;
}

// Sports & Cities, like the website's admin catalog: add, edit, hide and delete sports, cities and areas.
export default function AdminCatalog() {
  const [sports, setSports] = useState<Sport[] | null>(null);
  const [cities, setCities] = useState<City[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [usage, setUsage] = useState<Record<string, number>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [sportEditId, setSportEditId] = useState<string | null>(null);
  const [sportName, setSportName] = useState('');
  const [sportEmoji, setSportEmoji] = useState('');
  const [sportWhere, setSportWhere] = useState<PlayWhere>('both');
  const [newCity, setNewCity] = useState('');
  const [newArea, setNewArea] = useState('');
  const [newAreaCity, setNewAreaCity] = useState('');
  const [renaming, setRenaming] = useState<Renaming | null>(null);
  const [deleting, setDeleting] = useState<Deleting | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    const [s, c, a, u] = await Promise.all([
      supabase.from('sports').select('id, name, slug, emoji, icon_url, outdoor_only, indoor_only, is_active, sort_order').order('name'),
      supabase.from('cities').select('name, sort_order, is_active').order('name'),
      supabase.from('areas').select('name, city, sort_order, is_active').order('name'),
      supabase.rpc('admin_catalog_usage'),
    ]);
    setSports((s.data as Sport[]) || []);
    setCities((c.data as City[]) || []);
    setAreas((a.data as Area[]) || []);
    const map: Record<string, number> = {};
    for (const r of (u.data as any[]) || []) map[`${r.kind}:${r.key}`] = Number(r.uses);
    setUsage(map);
    if (c.data && c.data.length) setNewAreaCity((cur) => cur || (c.data[0] as City).name);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function run(action: () => PromiseLike<{ error: { message: string } | null }>, okText: string) {
    setBusy(true);
    setMsg(null);
    const { error } = await action();
    setBusy(false);
    if (error) { setMsg({ ok: false, text: friendly(error.message) }); return false; }
    setMsg({ ok: true, text: okText });
    await load();
    return true;
  }

  function resetSportForm() { setSportEditId(null); setSportName(''); setSportEmoji(''); setSportWhere('both'); }

  async function saveSport() {
    const editing = (sports || []).find((s) => s.id === sportEditId);
    const ok = await run(() => supabase.rpc('admin_save_sport', { p_id: sportEditId, p_name: sportName, p_emoji: sportEmoji, p_play_where: sportWhere, p_is_active: editing ? editing.is_active : true }),
      sportEditId ? `✅ ${sportName.trim()} updated.` : `✅ ${sportName.trim()} added. Owners can now offer it on their courts.`);
    if (ok && editing?.icon_url && (sportEmoji || '') !== (editing.emoji || '')) {
      // a new emoji was chosen: show it instead of the picture
      await supabase.from('sports').update({ icon_url: null }).eq('id', editing.id);
      await load();
    }
    if (ok) resetSportForm();
  }

  const toggleSport = (s: Sport) => run(() => supabase.rpc('admin_save_sport', { p_id: s.id, p_name: s.name, p_emoji: s.emoji || '', p_play_where: playWhereOf(s), p_is_active: !s.is_active }),
    s.is_active ? `${s.name} is hidden from players and owners.` : `${s.name} is visible again.`);

  async function remove(d: Deleting) {
    setDeleting(null);
    await run(() => supabase.from(d.table).delete().eq(d.key, d.value), `${d.label} deleted.`);
  }

  async function saveRename() {
    if (!renaming) return;
    const value = renaming.value.trim();
    if (!value || value === renaming.name) return setRenaming(null);
    const ok = await run(() => supabase.from(renaming.kind === 'city' ? 'cities' : 'areas').update({ name: value }).eq('name', renaming.name),
      `Renamed ${renaming.name} to ${value}. Branches there were updated too.`);
    if (ok) setRenaming(null);
  }

  const del = (d: Deleting) => deleting?.value === d.value && deleting.table === d.table ? (
    <>
      <LinkButton title="Yes, delete" onPress={() => remove(d)} disabled={busy} />
      <LinkButton title="No" onPress={() => setDeleting(null)} />
    </>
  ) : <LinkButton title="Delete" onPress={() => setDeleting(d)} />;

  const renameBox = (r: Renaming) => (
    <View>
      <Field label="New name" value={r.value} onChangeText={(v) => setRenaming({ ...r, value: v })} maxLength={40} autoFocus returnKeyType="done" onSubmitEditing={saveRename} />
      <View style={{ flexDirection: 'row' }}>
        <LinkButton title="Save" onPress={saveRename} disabled={busy} />
        <LinkButton title="Cancel" onPress={() => setRenaming(null)} />
      </View>
    </View>
  );

  if (sports === null) return <><Stack.Screen options={{ title: 'Sports & Cities' }} /><Loading /></>;
  const q = search.trim();
  const match = (...words: (string | null | undefined)[]) => !q || searchMatches(q, words.filter(Boolean).join(' '));
  const editing = sports.find((x) => x.id === sportEditId);

  return (
    <>
      <Stack.Screen options={{ title: 'Sports & Cities' }} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        {msg && <Note kind={msg.ok ? 'ok' : 'error'}>{msg.text}</Note>}
        <Field label="Search" value={search} onChangeText={setSearch} placeholder="Sports, cities or areas" />

        <H2>Sports</H2>
        <Box>
          <Text style={{ color: colors.text, fontWeight: '800', marginBottom: 8 }}>{sportEditId ? 'Edit sport' : 'Add a new sport'}</Text>
          <Field label="Name" value={sportName} onChangeText={setSportName} placeholder="e.g. Padel" maxLength={40} />
          <Field label="Icon (emoji)" value={sportEmoji} onChangeText={setSportEmoji} placeholder="🎾" maxLength={8} />
          {!!editing?.icon_url && <Muted style={{ fontSize: 12 }}>Uses a picture now — pick an emoji to replace it</Muted>}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
            {EMOJI_IDEAS.map((e) => (
              <Pressable accessibilityRole="button" key={e} onPress={() => setSportEmoji(e)} style={{ width: 38, height: 38, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center',
                borderColor: sportEmoji === e ? colors.primary : colors.border, backgroundColor: sportEmoji === e ? colors.card : 'transparent' }}>
                <Text style={{ fontSize: 18 }}>{e}</Text>
              </Pressable>
            ))}
          </View>
          <Muted>Where can it be played?</Muted>
          <Chips>{(['both', 'indoor', 'outdoor'] as PlayWhere[]).map((w) => <Chip key={w} label={`${w === 'indoor' ? '🏠 ' : w === 'outdoor' ? '☀️ ' : '🏠☀️ '}${PLAY_LABEL[w]}`} on={sportWhere === w} onPress={() => setSportWhere(w)} />)}</Chips>
          <Muted style={{ fontSize: 12, marginBottom: 10 }}>{sportWhere === 'both' ? 'Players will be asked whether they want indoor or outdoor.'
            : `Players skip the indoor/outdoor question, and owners can only add it to ${sportWhere} courts.`}</Muted>
          <Button title={sportEditId ? 'Save changes' : 'Add sport'} onPress={saveSport} disabled={busy || !sportName.trim()} />
          {!!sportEditId && <LinkButton title="Cancel" onPress={resetSportForm} />}
        </Box>
        {sports.length === 0 && <Muted>No sports yet. Add the first one above.</Muted>}
        {sports.filter((s) => match(s.name)).map((s) => {
          const uses = usage[`sport:${s.id}`] || 0;
          return (
            <Card key={s.id}>
              <View style={{ flexDirection: 'row', alignItems: 'center', opacity: s.is_active ? 1 : 0.5 }}>
                {s.icon_url ? <Image source={{ uri: s.icon_url }} style={{ width: 28, height: 28, marginRight: 10 }} /> : <Text style={{ fontSize: 24, marginRight: 10 }}>{s.emoji || '🏅'}</Text>}
                <View style={{ flex: 1 }}>
                  <Line bold>{s.name}</Line>
                  <Line muted size={12}>{PLAY_LABEL[playWhereOf(s)]} · on {uses} court{uses === 1 ? '' : 's'}</Line>
                </View>
                {!s.is_active && <Badge text="Hidden" />}
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 }}>
                <LinkButton title="Edit" onPress={() => { setSportEditId(s.id); setSportName(s.name); setSportEmoji(s.emoji || ''); setSportWhere(playWhereOf(s)); }} />
                <LinkButton title={s.is_active ? 'Hide' : 'Show'} onPress={() => toggleSport(s)} disabled={busy} />
                {uses === 0 && del({ table: 'sports', key: 'id', value: s.id, label: s.name })}
              </View>
            </Card>
          );
        })}

        <H2>Cities</H2>
        <Box>
          <Field label="New city" value={newCity} onChangeText={setNewCity} placeholder="e.g. Hurghada" maxLength={40} />
          <Button small title="Add city" disabled={busy || !newCity.trim()} onPress={async () => {
            const name = newCity.trim();
            const ok = await run(() => supabase.from('cities').insert({ name, sort_order: cities.length + 1 }), `✅ ${name} added. Now add its areas below.`);
            if (ok) { setNewCity(''); setNewAreaCity(name); }
          }} />
        </Box>
        {cities.length === 0 && <Muted>No cities yet.</Muted>}
        {cities.filter((c) => match(c.name)).map((c) => {
          const nAreas = usage[`city:${c.name}`] || 0;
          const isRenaming = renaming?.kind === 'city' && renaming.name === c.name;
          return (
            <Card key={c.name}>
              {isRenaming ? renameBox(renaming!) : (
                <>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', opacity: c.is_active ? 1 : 0.5 }}>
                    <Line bold>📍 {c.name}</Line>
                    {!c.is_active && <Badge text="Hidden" />}
                  </View>
                  <Line muted size={12}>{nAreas} area{nAreas === 1 ? '' : 's'}{nAreas === 0 ? ' — add at least one area so players can pick this city' : ''}</Line>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 }}>
                    <LinkButton title="Rename" onPress={() => setRenaming({ kind: 'city', name: c.name, value: c.name })} />
                    <LinkButton title={c.is_active ? 'Hide' : 'Show'} disabled={busy} onPress={() => run(() => supabase.from('cities').update({ is_active: !c.is_active }).eq('name', c.name),
                      c.is_active ? `${c.name} is hidden (with all its areas).` : `${c.name} is visible again.`)} />
                    {nAreas === 0 && del({ table: 'cities', key: 'name', value: c.name, label: c.name })}
                  </View>
                </>
              )}
            </Card>
          );
        })}

        <H2>Areas</H2>
        <Box>
          <Field label="New area" value={newArea} onChangeText={setNewArea} placeholder="e.g. Sheraton" maxLength={40} />
          <Muted>In</Muted>
          <Chips>{cities.map((c) => <Chip key={c.name} label={c.name} on={newAreaCity === c.name} onPress={() => setNewAreaCity(c.name)} />)}</Chips>
          <Button small title="Add area" disabled={busy || cities.length === 0 || !newArea.trim()} onPress={async () => {
            const name = newArea.trim();
            const ok = await run(() => supabase.from('areas').insert({ name, city: newAreaCity, sort_order: areas.length + 1 }), `✅ ${name} added to ${newAreaCity}.`);
            if (ok) setNewArea('');
          }} />
        </Box>
        {areas.length === 0 && <Muted>No areas yet.</Muted>}
        {cities.filter((c) => areas.some((a) => a.city === c.name)).map((c) => {
          const list = areas.filter((a) => a.city === c.name && match(a.name, c.name));
          if (list.length === 0) return null;
          return (
            <View key={c.name} style={{ marginBottom: 8 }}>
              <Text style={{ color: colors.muted, fontWeight: '700', marginBottom: 6 }}>📍 {c.name}</Text>
              {list.map((a) => {
                const uses = usage[`area:${a.name}`] || 0;
                const isRenaming = renaming?.kind === 'area' && renaming.name === a.name;
                return (
                  <Card key={a.name}>
                    {isRenaming ? renameBox(renaming!) : (
                      <>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', opacity: a.is_active ? 1 : 0.5 }}>
                          <Line bold>{a.name}</Line>
                          {!a.is_active && <Badge text="Hidden" />}
                        </View>
                        <Line muted size={12}>{uses} branch{uses === 1 ? '' : 'es'}</Line>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 }}>
                          <LinkButton title={moving === a.name ? 'Close' : 'Move'} onPress={() => setMoving(moving === a.name ? null : a.name)} />
                          <LinkButton title="Rename" onPress={() => setRenaming({ kind: 'area', name: a.name, value: a.name })} />
                          <LinkButton title={a.is_active ? 'Hide' : 'Show'} disabled={busy} onPress={() => run(() => supabase.from('areas').update({ is_active: !a.is_active }).eq('name', a.name),
                            a.is_active ? `${a.name} is hidden from players.` : `${a.name} is visible again.`)} />
                          {uses === 0 && del({ table: 'areas', key: 'name', value: a.name, label: a.name })}
                        </View>
                        {moving === a.name && (
                          <Chips>{cities.map((cc) => <Chip key={cc.name} label={cc.name} on={a.city === cc.name} onPress={async () => {
                            if (cc.name === a.city) return;
                            const ok = await run(() => supabase.from('areas').update({ city: cc.name }).eq('name', a.name), `${a.name} moved to ${cc.name}.`);
                            if (ok) setMoving(null);
                          }} />)}</Chips>
                        )}
                      </>
                    )}
                  </Card>
                );
              })}
            </View>
          );
        })}
        {cities.some((c) => c.is_active) && areas.length > 0 && !areas.some((a) => a.is_active) && (
          <Text style={{ color: colors.danger }}>Players can&apos;t search until at least one area is visible.</Text>
        )}
      </ScrollView>
    </>
  );
}
