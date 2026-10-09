import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { colors, fonts, radius, themed } from '@/lib/theme';
import { Button, Field, Note, PressableScale } from '@/components/ui';

// "Delete my account" at the bottom of a player's profile (the App Store and Google Play require it in the app).
// The database decides whether it is allowed (no upcoming bookings, games, payments or refunds in progress)
// and returns its own message if not.
export function DeleteAccount() {
  const s = useS();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function remove() {
    setBusy(true);
    setError('');
    const { error: e } = await supabase.rpc('delete_my_account');
    if (e) {
      setBusy(false);
      setError(e.message);
      return;
    }
    await supabase.auth.signOut();
    router.replace('/');
  }

  function close() {
    setOpen(false);
    setTyped('');
    setError('');
  }

  return (
    <View style={s.wrap}>
      {!open ? (
        <PressableScale onPress={() => setOpen(true)} accessibilityRole="button" style={s.open}>
          <Text style={s.openText}>Delete my account</Text>
        </PressableScale>
      ) : (
        <View style={s.box}>
          <Text style={s.title}>Delete my account?</Text>
          <Text style={s.body}>
            This is permanent. You will not be able to log in again, and any credit or discounts you have are lost. Past bookings stay in
            our records without your name, because court owners&apos; payments depend on them.
          </Text>
          {error ? <Note kind="error">{error}</Note> : null}
          <Field label="Type DELETE to confirm" value={typed} onChangeText={setTyped} autoCapitalize="characters" autoCorrect={false} />
          <PressableScale
            onPress={remove}
            disabled={busy || typed.trim().toUpperCase() !== 'DELETE'}
            accessibilityRole="button"
            style={[s.confirm, (busy || typed.trim().toUpperCase() !== 'DELETE') && { opacity: 0.5 }]}
          >
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.confirmText}>Delete my account for good</Text>}
          </PressableScale>
          <View style={{ height: 8 }} />
          <Button title="Keep my account" variant="ghost" onPress={close} />
        </View>
      )}
    </View>
  );
}

const useS = themed(() => StyleSheet.create({
  wrap: { marginTop: 18, alignItems: 'center' },
  open: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: radius.md, borderWidth: 1, borderColor: 'transparent', backgroundColor: 'rgba(255,92,108,0.12)' },
  openText: { color: colors.danger, fontWeight: '700' },
  box: { alignSelf: 'stretch', backgroundColor: colors.card, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border, padding: 16 },
  title: { color: colors.danger, fontFamily: fonts.displayBold, fontSize: 20, marginBottom: 6 },
  body: { color: colors.muted, lineHeight: 20, marginBottom: 14 },
  confirm: { borderRadius: radius.md, paddingVertical: 15, alignItems: 'center', backgroundColor: colors.danger },
  confirmText: { color: '#fff', fontFamily: fonts.displayBold, fontSize: 17 },
}));
