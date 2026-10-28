import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { colors, radius, useTheme } from '@/lib/theme';

type MyBlock = { facility_id: string | null; facility_name: string | null; reason_label: string; appeal_status: string | null; can_appeal: boolean };

// Tells a blocked player where they are blocked and why, like the website. With a facilityId it only shows blocks
// that apply to that branch (or to all of Zaf Play); without one (Profile) it lists every block.
export function BlockedNotice({ facilityId }: { facilityId?: string | null }) {
  useTheme();
  const router = useRouter();
  const { session } = useAuth();
  const [blocks, setBlocks] = useState<MyBlock[]>([]);

  const load = useCallback(async () => {
    if (!session) { setBlocks([]); return; }
    const { data } = await supabase.rpc('my_block_appeals');
    const list = (data as MyBlock[]) || [];
    setBlocks(facilityId === undefined ? list : list.filter((b) => b.facility_id === null || b.facility_id === facilityId));
  }, [facilityId, session]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (blocks.length === 0) return null;
  const pending = blocks.some((b) => b.appeal_status === 'pending');
  const canAppeal = blocks.some((b) => b.can_appeal);
  return (
    <View accessibilityRole="alert" style={{ borderWidth: 1, borderColor: colors.danger, backgroundColor: 'rgba(255,92,108,0.08)', borderRadius: radius.lg, padding: 14, marginBottom: 14 }}>
      <Text style={{ color: colors.danger, fontWeight: '700' }}>
        {blocks.length === 1 && blocks[0].facility_id !== null ? `You can't book at ${blocks[0].facility_name ?? 'this facility'} right now`
          : blocks.length === 1 ? "You can't book on Zaf Play right now" : 'Some bookings are blocked for you'}
      </Text>
      {blocks.map((b, i) => (
        <Text key={i} style={{ color: colors.text, marginTop: 4 }}>{b.facility_id === null ? 'All of Zaf Play' : b.facility_name}: <Text style={{ fontWeight: '700' }}>{b.reason_label}</Text></Text>
      ))}
      <Text style={{ color: colors.text, marginTop: 8 }}>
        {pending ? 'Appeal sent. Waiting for Zaf Play to reply: approved means you are unblocked, declined means the block stays. '
          : canAppeal ? 'If you think this is a mistake, ' : 'Your appeal was declined. '}
        <Text onPress={() => router.push('/appeal')} style={{ fontWeight: '700', textDecorationLine: 'underline' }}>
          {pending ? 'See your appeal' : canAppeal ? 'appeal this decision' : 'See the answer'}
        </Text>
        {canAppeal && !pending ? ' and tell us why.' : ''}
      </Text>
    </View>
  );
}

// The small Active / Blocked badge beside the player's name on Profile.
export function AccountStatus() {
  useTheme();
  const { session } = useAuth();
  const [blocked, setBlocked] = useState<boolean | null>(null);
  useEffect(() => {
    if (!session) return;
    supabase.rpc('my_block_list').then(({ data }) => setBlocked(((data as unknown[]) || []).length > 0));
  }, [session]);
  if (blocked === null) return null;
  return (
    <View accessibilityLabel={blocked ? "Account status: Blocked. You can't book at some places right now." : 'Account status: Active. You can book anywhere on Zaf Play.'}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2,
        backgroundColor: blocked ? 'rgba(255,92,108,0.15)' : 'rgba(46,211,160,0.15)' }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: blocked ? colors.danger : colors.success }} />
      <Text style={{ color: blocked ? colors.danger : colors.success, fontSize: 12, fontWeight: '700' }}>{blocked ? 'Blocked' : 'Active'}</Text>
    </View>
  );
}
