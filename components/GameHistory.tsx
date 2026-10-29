import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Text } from '@/components/AppText';
import { supabase } from '@/lib/supabase';
import { dateTimeText } from '@/lib/format';
import { colors } from '@/lib/theme';

type Entry = { kind: 'host_left' | 'new_host' | 'player_left'; first_name: string | null; created_at: string };

// What changed in a game, like the website: a host who had to leave, the new host, a player who had to leave.
export function GameHistory({ gameId }: { gameId: string }) {
  const [rows, setRows] = useState<Entry[]>([]);
  useEffect(() => {
    supabase.rpc('open_game_history', { p_game_id: gameId }).then(({ data }) => setRows((data as Entry[]) || []));
  }, [gameId]);
  if (rows.length === 0) return null;
  const text = (e: Entry) =>
    e.kind === 'host_left' ? `${e.first_name || 'The host'} had to leave the game.`
      : e.kind === 'new_host' ? `${e.first_name || 'A player'} is now the host. A place opened up for a new player.`
      : `${e.first_name || 'A player'} had to leave the game. A place opened up.`;
  return (
    <View style={{ marginTop: 20 }}>
      <Text style={{ color: colors.text, fontSize: 17, fontWeight: '700' }}>Game history</Text>
      {rows.map((e, i) => (
        <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10, borderBottomWidth: 1, borderColor: colors.border, paddingVertical: 8 }}>
          <Text style={{ color: colors.text, fontSize: 13, flex: 1 }}>{text(e)}</Text>
          <Text style={{ color: colors.muted, fontSize: 11 }}>{dateTimeText(e.created_at)}</Text>
        </View>
      ))}
    </View>
  );
}
