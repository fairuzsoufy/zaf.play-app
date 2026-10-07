import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { colors, radius } from '@/lib/theme';
import { egp } from '@/lib/format';
import { Button } from '@/components/ui';

export default function Profile() {
  const router = useRouter();
  const { session } = useAuth();
  const [credit, setCredit] = useState<number | null>(null);
  const uid = session?.user.id;

  useEffect(() => {
    if (!uid) return;
    supabase.rpc('my_credit').then(({ data }) => setCredit(Number(data ?? 0)));
  }, [uid]);

  if (!session) {
    return (
      <View style={{ padding: 24 }}>
        <Text style={{ color: colors.muted, marginBottom: 16 }}>Log in to see your profile.</Text>
        <Button title="Log in" onPress={() => router.push('/login')} />
      </View>
    );
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16 }}>
      <View style={{ backgroundColor: colors.card, borderRadius: radius.lg, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: colors.border }}>
        <Text style={{ color: colors.muted }}>Signed in as</Text>
        <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700', marginTop: 4 }}>{session.user.email}</Text>
        {credit !== null && credit > 0 ? (
          <Text style={{ color: colors.success, marginTop: 10 }}>💳 Zaf Play credit: {egp(credit)}</Text>
        ) : null}
      </View>
      <Button title="Log out" variant="ghost" onPress={() => supabase.auth.signOut()} />
    </ScrollView>
  );
}
