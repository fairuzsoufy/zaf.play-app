import { useState } from 'react';
import { View } from 'react-native';
import { Text } from '@/components/AppText';
import { supabase } from '@/lib/supabase';
import { dateTimeText } from '@/lib/format';
import { colors } from '@/lib/theme';
import { LinkButton, Muted } from './owner';

const HISTORY: Record<string, string> = {
  pending: 'Sent for approval', resent: 'Edited and sent again', approved: 'Approved', rejected: 'Rejected', closed: 'Registration closed',
  scheduled: 'Schedule made', finished: 'Finished', cancelled: 'Cancelled', time_changed: 'Time changed', team_withdrew: 'Team withdrew',
};

// every time a tournament was sent, rejected (with the reason), approved or cancelled
export function TournamentHistory({ id }: { id: string }) {
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
