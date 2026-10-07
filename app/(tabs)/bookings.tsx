import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { colors, radius } from '@/lib/theme';
import { dateLabel, egp, timeLabel } from '@/lib/format';
import { Button } from '@/components/ui';

type Row = {
  id: string; start_time: string; end_time: string; status: string; payment_status: string; total_price: number;
  court: { name: string; facility: { name: string } | null } | null;
};

export default function Bookings() {
  const router = useRouter();
  const { session, loading: authLoading } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const uid = session?.user.id;

  const load = useCallback(async () => {
    if (!uid) { setLoading(false); return; }
    const { data } = await supabase
      .from('bookings')
      .select('id,start_time,end_time,status,payment_status,total_price,court:courts(name,facility:facilities(name))')
      .eq('user_id', uid)
      .order('start_time', { ascending: false })
      .limit(50);
    setRows((data ?? []) as unknown as Row[]);
    setLoading(false);
    setRefreshing(false);
  }, [uid]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (authLoading || (uid && loading)) return <ActivityIndicator style={{ marginTop: 60 }} color={colors.primary} />;
  if (!uid) {
    return (
      <View style={{ padding: 24 }}>
        <Text style={{ color: colors.muted, marginBottom: 16 }}>Log in to see your bookings.</Text>
        <Button title="Log in" onPress={() => router.push('/login')} />
      </View>
    );
  }

  return (
    <FlatList
      data={rows}
      keyExtractor={(r) => r.id}
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 16 }}
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.primary} onRefresh={() => { setRefreshing(true); load(); }} />}
      ListEmptyComponent={<Text style={{ color: colors.muted, textAlign: 'center', marginTop: 40 }}>No bookings yet.</Text>}
      renderItem={({ item }) => (
        <Pressable
          style={s.card}
          disabled={item.status !== 'pending'}
          onPress={() => router.push({ pathname: '/pay/[id]', params: { id: item.id } })}
        >
          <Text style={s.title}>{item.court?.name}</Text>
          <Text style={s.sub}>{item.court?.facility?.name}</Text>
          <Text style={s.sub}>{dateLabel(item.start_time)} · {timeLabel(item.start_time)} – {timeLabel(item.end_time)}</Text>
          <Text style={s.sub}>{egp(item.total_price)} · {item.status} · {item.payment_status}</Text>
          {item.status === 'pending' && <Text style={{ color: colors.primaryAlt, marginTop: 6, fontWeight: '600' }}>Tap to pay or check the payment →</Text>}
        </Pressable>
      )}
    />
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: colors.border },
  title: { color: colors.text, fontSize: 16, fontWeight: '700' },
  sub: { color: colors.muted, marginTop: 3 },
});
