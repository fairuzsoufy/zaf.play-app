import { useState } from 'react';
import { Alert, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Text } from '@/components/AppText';
import { supabase } from '@/lib/supabase';
import { passwordProblem } from '@/lib/validate';
import { colors, fonts, radius, useTheme } from '@/lib/theme';
import { Button, Field, Note } from './ui';

// Profile → Password, like the website: type the current password, then the new one. Changing it logs out
// every other phone and browser, so a login someone else may have stays closed.
export function LoginSecurity() {
  useTheme();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [noPassword, setNoPassword] = useState(false); // a Google login that never had a password

  async function save() {
    setMsg(null);
    if (!noPassword && !current) return setMsg({ ok: false, text: 'Please type your current password.' });
    const problem = passwordProblem(next);
    if (problem) return setMsg({ ok: false, text: problem });
    setSaving(true);
    try {
      if (!noPassword) {
        const { data: check, error } = await supabase.rpc('verify_my_password', { p_password: current });
        if (error) return setMsg({ ok: false, text: error.message.includes('too_many_attempts') ? 'Too many wrong tries. Please wait 15 minutes, or log out and use “Forgot password?”.' : 'Could not check your password. Please try again in a minute.' });
        if (check === 'none') {
          setNoPassword(true);
          return setMsg({ ok: false, text: 'You log in with Google, so there is no current password. Choose a password below to also log in with your email.' });
        }
        if (check !== 'ok') return setMsg({ ok: false, text: 'Your current password is wrong.' });
      }
      const { error } = await supabase.auth.updateUser({ password: next });
      if (error) return setMsg({ ok: false, text: 'Could not change your password. Please try again in a minute.' });
      await supabase.auth.signOut({ scope: 'others' });
      setCurrent(''); setNext(''); setNoPassword(false); setOpen(false);
      setMsg({ ok: true, text: 'Password changed. Every other phone and browser was logged out; this one stays logged in.' });
    } finally {
      setSaving(false);
    }
  }

  function logOutEverywhere() {
    Alert.alert('Log out of all devices?', 'You will be logged out on every phone, computer and the Zaf Play app, including this one. You can log in again straight away.', [
      { text: 'Cancel', style: 'cancel' },
      // like the website: logging out lands on the Book screen
      { text: 'Yes, log out everywhere', style: 'destructive', onPress: () => { router.replace('/'); supabase.auth.signOut({ scope: 'global' }); } },
    ]);
  }

  return (
    <View style={{ backgroundColor: colors.card, borderRadius: radius.xl, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: colors.border }}>
      <Text style={{ color: colors.text, fontFamily: fonts.displayBold, fontSize: 20, marginBottom: 8 }}>Password</Text>
      {!open ? (
        <Button small variant="ghost" title="Change password" onPress={() => { setOpen(true); setMsg(null); }} />
      ) : (
        <>
          {!noPassword && <Field label="Current password" value={current} onChangeText={setCurrent} secureTextEntry autoCapitalize="none" autoComplete="current-password" textContentType="password" />}
          <Field label="New password" value={next} onChangeText={setNext} secureTextEntry autoCapitalize="none" autoComplete="new-password" textContentType="newPassword" />
          <Button title={saving ? 'Saving...' : 'Change password'} onPress={save} loading={saving} disabled={!next} />
          <View style={{ height: 8 }} />
          <Button variant="ghost" title="Cancel" onPress={() => { setOpen(false); setMsg(null); }} />
        </>
      )}
      {msg && <View style={{ marginTop: 10 }}><Note kind={msg.ok ? 'ok' : 'error'}>{msg.text}</Note></View>}
      <View style={{ height: 10 }} />
      <Button small variant="ghost" title="Log out of all devices" onPress={logOutEverywhere} />
    </View>
  );
}
