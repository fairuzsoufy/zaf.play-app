import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Linking, Platform, ScrollView, View } from 'react-native';
import { Text, TextInput } from '@/components/AppText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { colors, radius, useTheme } from '@/lib/theme';
import { dateTimeText } from '@/lib/format';
import { Button, Note } from '@/components/ui';

type Row = {
  block_id: string; facility_id: string | null; facility_name: string | null; reason_label: string; blocked_at: string;
  appeal_status: 'pending' | 'approved' | 'declined' | null; appeal_message: string | null; appeal_at: string | null;
  admin_note: string | null; can_appeal: boolean;
};
const MIN = 10;
const MAX = 1000;

// Appeal a restriction (the website's /appeal): the player writes why each block should be lifted and Zaf Play
// approves (the block is lifted) or declines (it stays). The answer also arrives by email.
export default function Appeal() {
  const { scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { session, loading: authLoading } = useAuth();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [text, setText] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('my_block_appeals');
    setRows((data as Row[]) || []);
  }, []);
  useEffect(() => {
    if (session) load();
    else if (!authLoading) router.replace('/login');
  }, [session, authLoading, load, router]);

  async function send(blockId: string) {
    const message = (text[blockId] || '').trim();
    if (message.length < MIN) return setErr((e) => ({ ...e, [blockId]: `Please tell us why in a few words (at least ${MIN} characters).` }));
    setBusy(blockId);
    setErr((e) => ({ ...e, [blockId]: '' }));
    const { error } = await supabase.rpc('submit_block_appeal', { p_block_id: blockId, p_message: message });
    setBusy(null);
    if (error) return setErr((e) => ({ ...e, [blockId]: error.message }));
    load();
  }

  const card = { backgroundColor: colors.card, borderRadius: radius.lg, padding: 14, borderWidth: 1, borderColor: colors.border, marginBottom: 12, gap: 8 };
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior="padding" keyboardVerticalOffset={insets.top + (Platform.OS === 'ios' ? 44 : 56)}>
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }} keyboardShouldPersistTaps="handled">
      <Text style={{ color: colors.muted, marginBottom: 14 }}>Tell us why the restriction should be lifted. The Zaf Play team reviews every appeal and emails you the answer.</Text>
      {rows === null ? <ActivityIndicator color={colors.primary} /> : rows.length === 0 ? (
        <View style={card}>
          <Text style={{ color: colors.text, fontWeight: '700' }}>You are not restricted</Text>
          <Text style={{ color: colors.muted }}>You can book anywhere on Zaf Play.</Text>
          <Button small title="Find a court" onPress={() => router.replace('/')} />
        </View>
      ) : rows.map((r) => {
        const value = text[r.block_id] || '';
        return (
          <View key={r.block_id} style={card}>
            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 16 }}>{r.facility_id === null ? 'All of Zaf Play' : r.facility_name || 'A branch'}</Text>
            <Text style={{ color: colors.muted }}>Reason: <Text style={{ color: colors.text, fontWeight: '700' }}>{r.reason_label}</Text></Text>
            <Text style={{ color: colors.muted, fontSize: 12 }}>Restricted {dateTimeText(r.blocked_at)}</Text>
            {r.appeal_status === 'pending' && (
              <Note kind="ok">
                Appeal sent {r.appeal_at ? dateTimeText(r.appeal_at) : ''}{'\n'}{r.appeal_message}{'\n\n'}Waiting for Zaf Play to reply. If your appeal is approved, you will be unblocked and can book again. If it is declined, the block stays. We will email you either way.
              </Note>
            )}
            {r.appeal_status === 'declined' && !r.can_appeal && (
              <Note kind="error">
                Your appeal was declined.{r.admin_note ? `\nNote from Zaf Play: ${r.admin_note}` : ''}{'\n'}For anything else, email{' '}
                <Text onPress={() => Linking.openURL('mailto:support@zafplay.com')} style={{ textDecorationLine: 'underline', fontWeight: '700' }}>support@zafplay.com</Text>.
              </Note>
            )}
            {r.can_appeal && (
              <>
                <Text style={{ color: colors.text, fontWeight: '700' }}>Why should we lift this? (required)</Text>
                <TextInput value={value} onChangeText={(v) => setText((t) => ({ ...t, [r.block_id]: v }))} maxLength={MAX} multiline keyboardAppearance={scheme}
                  placeholder="Tell us what happened, in your own words." placeholderTextColor={colors.muted}
                  style={{ minHeight: 110, textAlignVertical: 'top', borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 10, color: colors.text }} />
                <Text style={{ color: colors.muted, fontSize: 12 }}>{value.trim().length}/{MAX}</Text>
                {!!err[r.block_id] && <Text style={{ color: colors.danger }}>{err[r.block_id]}</Text>}
                <Button title="Send appeal" loading={busy === r.block_id} disabled={busy !== null || value.trim().length < MIN} onPress={() => send(r.block_id)} />
              </>
            )}
          </View>
        );
      })}
    </ScrollView>
    </KeyboardAvoidingView>
  );
}
