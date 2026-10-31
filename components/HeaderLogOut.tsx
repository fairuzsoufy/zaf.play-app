import { Alert, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { Text } from '@/components/AppText';
import { supabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';

// "Log out" in the top bar of the owner and admin screens (they have no Profile tab), asked first like the player Profile.
// `t`: the owner dashboard passes its English / Arabic t(); admin passes nothing.
export function HeaderLogOut({ t = (s: string) => s }: { t?: (s: string) => string }) {
  const router = useRouter();
  function ask() {
    Alert.alert(t('Do you want to log out?'), t('You can log in again any time.'), [
      { text: t('Stay logged in'), style: 'cancel' },
      { text: t('Yes, log out'), style: 'destructive', onPress: () => { router.replace('/(tabs)/(play)'); supabase.auth.signOut({ scope: 'local' }); } },
    ]);
  }
  return (
    <Pressable onPress={ask} hitSlop={10} accessibilityRole="button">
      <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 14 }}>{t('Log out')}</Text>
    </Pressable>
  );
}
