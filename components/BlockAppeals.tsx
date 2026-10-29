import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { Text } from '@/components/AppText';
import { supabase } from '@/lib/supabase';
import { dateTimeText } from '@/lib/format';
import { colors } from '@/lib/theme';
import { Badge, Box, Chip, H2, LinkButton, Loading, Muted } from '@/components/owner';
import { Field } from '@/components/ui';

type Appeal = {
  id: string; full_name: string; username: string | null; email: string | null; phone: string | null;
  facility_name: string | null; reason_label: string; blocked_at: string; blocked_by_name: string | null; block_active: boolean;
  message: string; status: 'pending' | 'approved' | 'declined'; admin_note: string | null; created_at: string;
  decided_at: string | null; decided_by_name: string | null;
};

// Appeals from blocked players, like the website's BlockAppealsAdmin. Approve lifts the block (the player can
// book again); Decline keeps it. The player is emailed either way, with the optional note.
export default function BlockAppeals({ onChange }: { onChange?: () => void }) {
  const [rows, setRows] = useState<Appeal[] | null>(null);
  const [showPast, setShowPast] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<{ id: string; approve: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('admin_block_appeals', { p_include_decided: showPast });
    setRows((data as Appeal[]) || []);
  }, [showPast]);
  useEffect(() => { load(); }, [load]);

  async function decide(a: Appeal, approve: boolean) {
    setBusy(true);
    setMsg(null);
    const { error } = await supabase.rpc('admin_decide_block_appeal', { p_appeal_id: a.id, p_approve: approve, p_note: notes[a.id] || null });
    setBusy(false);
    setConfirm(null);
    if (error) return setMsg({ kind: 'error', text: error.message });
    setMsg({ kind: 'ok', text: approve ? `${a.full_name} can book again. They were emailed.` : `Appeal declined. ${a.full_name} stays blocked and was emailed.` });
    load();
    onChange?.();
  }

  const pending = (rows || []).filter((r) => r.status === 'pending').length;

  return (
    <Box>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <H2>Appeals{pending > 0 ? ` (${pending})` : ''}</H2>
        <Chip label="Show reviewed" on={showPast} onPress={() => setShowPast(!showPast)} />
      </View>
      {msg && <Text style={{ color: msg.kind === 'ok' ? colors.success : colors.danger, marginBottom: 8 }}>{msg.text}</Text>}
      {rows === null ? <Loading /> : rows.length === 0 ? <Muted>No appeals waiting.</Muted> : rows.map((a) => (
        <View key={a.id} style={{ paddingVertical: 10, borderTopWidth: 1, borderColor: colors.border }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <Text style={{ color: colors.text, fontWeight: '800', flex: 1 }}>{a.full_name} {a.username ? <Text style={{ color: colors.muted, fontWeight: '400' }}>@{a.username}</Text> : null}</Text>
            <Badge tone={a.status === 'pending' ? 'warn' : a.status === 'approved' ? 'ok' : 'bad'} text={a.status === 'pending' ? 'Waiting' : a.status === 'approved' ? 'Approved' : 'Declined'} />
          </View>
          {!!(a.phone || a.email) && <Muted style={{ fontSize: 12 }}>{[a.phone, a.email].filter(Boolean).join(' · ')}</Muted>}
          <Text style={{ color: colors.text, marginTop: 2 }}>Blocked from {a.facility_name || 'all of Zaf Play'} · {a.reason_label}</Text>
          <Muted style={{ fontSize: 12 }}>Blocked {dateTimeText(a.blocked_at)}{a.blocked_by_name ? ` by ${a.blocked_by_name}` : ''} · appeal sent {dateTimeText(a.created_at)}</Muted>
          <Text style={{ color: colors.text, backgroundColor: colors.bg, borderLeftWidth: 4, borderColor: colors.border, padding: 10, borderRadius: 8, marginVertical: 8 }}>{a.message}</Text>
          {a.status !== 'pending' ? (
            <Muted style={{ fontSize: 12 }}>
              {a.status === 'approved' ? 'Approved' : 'Declined'}{a.decided_at ? ` ${dateTimeText(a.decided_at)}` : ''}
              {a.decided_by_name ? ` by ${a.decided_by_name}` : ''}{a.admin_note ? ` · Note: ${a.admin_note}` : ''}
            </Muted>
          ) : (
            <>
              <Field label="Note to the player (optional, sent in the email)" value={notes[a.id] || ''} maxLength={500}
                onChangeText={(v) => setNotes((n) => ({ ...n, [a.id]: v }))} />
              {!a.block_active && <Muted style={{ fontSize: 12 }}>This block was already removed.</Muted>}
              {confirm?.id === a.id ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
                  <Text style={{ color: colors.text, marginRight: 6 }}>{confirm.approve ? 'Lift the block and let them book again?' : 'Keep them blocked?'}</Text>
                  <LinkButton title={confirm.approve ? 'Yes, approve' : 'Yes, decline'} onPress={() => decide(a, confirm.approve)} disabled={busy} />
                  <LinkButton title="No" onPress={() => setConfirm(null)} />
                </View>
              ) : (
                <View style={{ flexDirection: 'row' }}>
                  <LinkButton title="Approve" onPress={() => setConfirm({ id: a.id, approve: true })} />
                  <LinkButton title="Decline" onPress={() => setConfirm({ id: a.id, approve: false })} />
                </View>
              )}
            </>
          )}
        </View>
      ))}
    </Box>
  );
}
