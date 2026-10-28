import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { supabase } from '@/lib/supabase';
import { dateTimeText } from '@/lib/format';
import { searchMatches } from '@/lib/courtTimes';
import { useT } from '@/lib/ownerLang';
import { colors } from '@/lib/theme';
import { Badge, Box, Chip, Chips, H2, LinkButton, Loading, Muted, Pager, PAGE_SIZE } from '@/components/owner';
import { Button, Field } from '@/components/ui';

type Found = { id: string; full_name: string; username: string | null; already_blocked: boolean };
type Facility = { id: string; name: string };
type BlockRow = {
  id: string; user_id: string; full_name: string; username: string | null; facility_id: string | null; facility_name: string | null;
  reason_label: string; reason_deleted: boolean; created_at: string; created_by_name: string | null; lifted_at: string | null;
};
type Reason = { id: string; label: string; deleted_at: string | null };

// Block a player by exact email or phone number, with a reason from the list (the player sees it), like the
// website's Blocked players for owners. Blocks can cover all branches or one, and can cancel what is coming up.
export default function OwnerBlocked() {
  const { t, tm } = useT();
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [blocks, setBlocks] = useState<BlockRow[] | null>(null);
  const [reasons, setReasons] = useState<Reason[]>([]);
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState(false);
  const [found, setFound] = useState<Found[]>([]);
  const [picked, setPicked] = useState<Found | null>(null);
  const [reason, setReason] = useState('');
  const [scope, setScope] = useState('');
  const [cancelUpcoming, setCancelUpcoming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [showPast, setShowPast] = useState(false);
  const [listSearch, setListSearch] = useState('');
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    const [f, b, r] = await Promise.all([
      supabase.rpc('blockable_facilities'),
      supabase.rpc('list_blocked_players', { p_include_lifted: showPast }),
      supabase.rpc('list_block_reasons', { p_include_deleted: false }),
    ]);
    setFacilities((f.data as Facility[]) || []);
    setBlocks((b.data as BlockRow[]) || []);
    setReasons((r.data as Reason[]) || []);
  }, [showPast]);
  useEffect(() => { load(); }, [load]);

  async function search() {
    if (query.trim().length < 5 || busy) return;
    setMsg(null);
    setPicked(null);
    setBusy(true);
    const { data, error } = await supabase.rpc('find_player_to_block', { p_query: query });
    setBusy(false);
    if (error) return setMsg({ kind: 'error', text: error.message });
    setFound((data as Found[]) || []);
    setSearched(true);
  }

  async function block() {
    if (!picked || !reason) return;
    setBusy(true);
    setMsg(null);
    const { data, error } = await supabase.rpc('block_player', { p_user_id: picked.id, p_reason_id: reason, p_facility_id: scope || null, p_cancel_upcoming: cancelUpcoming });
    setBusy(false);
    if (error) return setMsg({ kind: 'error', text: error.message });
    const d = data as { upcoming?: number; cancelled?: number; games?: number };
    const up = Number(d?.upcoming || 0);
    const done = Number(d?.cancelled || 0);
    const games = Number(d?.games || 0);
    setMsg({
      kind: 'ok',
      text: t('{name} is blocked.', { name: picked.full_name })
        + (games > 0 ? ` ${t('{n} game(s) handled: a hosted game moves to the next player (or is cancelled and refunded if nobody else joined), and a joined seat is refunded.', { n: games })}` : '')
        + (done > 0 ? ` ${t('{n} upcoming booking(s) cancelled and the player was told.', { n: done })}` : '')
        + (up > 0 ? ` ${t('{n} upcoming booking(s) still active — cancel them from Bookings.', { n: up })}` : ''),
    });
    setPicked(null);
    setFound([]);
    setSearched(false);
    setQuery('');
    setReason('');
    setScope('');
    setCancelUpcoming(false);
    load();
  }

  async function unblock(id: string) {
    setBusy(true);
    setMsg(null);
    const { error } = await supabase.rpc('unblock_player', { p_block_id: id });
    setBusy(false);
    setConfirmId(null);
    if (error) return setMsg({ kind: 'error', text: error.message });
    setMsg({ kind: 'ok', text: t('The player can book again.') });
    load();
  }

  const shown = (blocks || []).filter((b) => !listSearch.trim() || searchMatches(listSearch, [b.full_name, b.username, b.facility_name, b.reason_label, b.created_by_name].filter(Boolean).join(' ')));
  const paged = shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
      <Box>
        <H2>{t('Block a player')}</H2>
        <Field label={t('Phone number or email of the player')} value={query} placeholder={t('Phone number or email')} autoCapitalize="none" autoCorrect={false}
          keyboardType="email-address" returnKeyType="search" onSubmitEditing={search}
          onChangeText={(v) => { setQuery(v); setSearched(false); setPicked(null); }} />
        <Button small title={t('Search')} onPress={search} disabled={busy || query.trim().length < 5} />
        {searched && found.length === 0 && <Muted style={{ marginTop: 10 }}>{t('No player found. The email or phone number must match exactly.')}</Muted>}
        {found.length > 0 && !picked && found.map((p) => (
          <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderTopWidth: 1, borderColor: colors.border, marginTop: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontWeight: '700' }}>{p.full_name} {p.username ? <Text style={{ color: colors.muted, fontWeight: '400' }}>@{p.username}</Text> : null}</Text>
              {p.already_blocked && <Badge tone="bad" text={t('Already blocked')} />}
            </View>
            <LinkButton title={p.already_blocked ? t('Change reason') : t('Choose')} onPress={() => setPicked(p)} />
          </View>
        ))}
        {picked && (
          <View style={{ marginTop: 14 }}>
            <Text style={{ color: colors.text, fontWeight: '800', marginBottom: 8 }}>{picked.full_name} {picked.username ? `@${picked.username}` : ''}</Text>
            <Muted>{t('Reason (the player will see it)')}</Muted>
            <Chips>{reasons.filter((r) => !r.deleted_at).map((r) => <Chip key={r.id} label={t(r.label)} on={reason === r.id} onPress={() => setReason(r.id)} />)}</Chips>
            {facilities.length > 1 && (
              <>
                <Muted>{t('Block from')}</Muted>
                <Chips>
                  <Chip label={t('All my branches')} on={!scope} onPress={() => setScope('')} />
                  {facilities.map((f) => <Chip key={f.id} label={f.name} on={scope === f.id} onPress={() => setScope(f.id)} />)}
                </Chips>
              </>
            )}
            <Pressable onPress={() => setCancelUpcoming(!cancelUpcoming)} accessibilityRole="checkbox" accessibilityState={{ checked: cancelUpcoming }}
              style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 }}>
              <Text style={{ color: cancelUpcoming ? colors.success : colors.muted, fontSize: 20, marginRight: 8 }}>{cancelUpcoming ? '☑' : '☐'}</Text>
              <Text style={{ color: colors.text, flex: 1 }}>{t('Also cancel their upcoming bookings and games here (refunded in full, the player is told by email; a hosted game goes to the next player)')}</Text>
            </Pressable>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}><Button small title={t('Block {name}', { name: picked.full_name.split(' ')[0] })} onPress={block} loading={busy} disabled={!reason} /></View>
              <View style={{ flex: 1 }}><Button small variant="ghost" title={t('Cancel')} onPress={() => setPicked(null)} /></View>
            </View>
          </View>
        )}
        {msg && <Text style={{ color: msg.kind === 'ok' ? colors.success : colors.danger, marginTop: 10 }}>{msg.text}</Text>}
      </Box>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <H2>{t('Blocked players')}{blocks ? ` (${blocks.filter((b) => !b.lifted_at).length})` : ''}</H2>
        <Chip label={t('Show past blocks')} on={showPast} onPress={() => { setShowPast(!showPast); setPage(1); }} />
      </View>
      {blocks !== null && blocks.length > 0 && (
        <Field label={t('Search')} value={listSearch} onChangeText={(v) => { setListSearch(v); setPage(1); }} placeholder={t('Search by player, branch or reason')} />
      )}
      {blocks === null ? <Loading /> : blocks.length === 0 ? <Muted>{t('Nobody is blocked.')}</Muted> : shown.length === 0 ? <Muted>{t('No blocks match.')}</Muted> : paged.map((b) => (
        <Box key={b.id}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <Text style={{ color: colors.text, fontWeight: '800', flex: 1 }}>{b.full_name} {b.username ? <Text style={{ color: colors.muted, fontWeight: '400' }}>@{b.username}</Text> : null}</Text>
            <Badge tone={b.lifted_at ? 'ok' : 'bad'} text={b.lifted_at ? t('Active') : t('Is blocked')} />
          </View>
          <Text style={{ color: colors.text, marginTop: 4 }}>
            {b.facility_name || t('All of Zaf Play')} · {t(b.reason_label)}{b.reason_deleted ? ` (${t('reason removed from the list')})` : ''}
          </Text>
          <Muted style={{ fontSize: 12 }}>
            {tm(dateTimeText(b.created_at))}{b.created_by_name ? ` · ${t('by {name}', { name: b.created_by_name })}` : ''}
            {b.lifted_at ? ` · ${t('unblocked {when}', { when: tm(dateTimeText(b.lifted_at)) })}` : ''}
          </Muted>
          {!b.lifted_at && (
            <View style={{ flexDirection: 'row', marginTop: 6 }}>
              {confirmId === b.id ? (
                <>
                  <LinkButton title={t('Yes, unblock')} onPress={() => unblock(b.id)} disabled={busy} />
                  <LinkButton title={t('No')} onPress={() => setConfirmId(null)} />
                </>
              ) : <LinkButton title={t('Unblock')} onPress={() => setConfirmId(b.id)} />}
            </View>
          )}
        </Box>
      ))}
      <Pager page={page} total={shown.length} onChange={setPage} />
    </ScrollView>
  );
}
