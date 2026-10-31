import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { Text } from '@/components/AppText';
import { useRouter } from 'expo-router';
import { Button, Field, Note } from '@/components/ui';
import { CodeEntry } from '@/components/CodeEntry';
import { SITE_URL, supabase } from '@/lib/supabase';
import { colors, useTheme } from '@/lib/theme';
import { passwordProblem } from '@/lib/validate';

// Forgot password, like the website: email or username → the 8-digit code from the email → a new password.
// The answer is the same whether the account exists or not.
export default function ForgotPassword() {
  useTheme();
  const router = useRouter();
  const [id, setId] = useState('');
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<'ask' | 'code' | 'password' | 'done'>('ask');
  const [err, setErr] = useState<string | null>(null);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const who = id.trim();
  const isUsername = !who.includes('@') || who.startsWith('@');

  // sends the reset code; returns an error text, or null when it was sent (or nothing to send: we never say which)
  async function sendCode(): Promise<string | null> {
    const redirectTo = `${SITE_URL}/reset-password`;
    if (isUsername) {
      const { data, error } = await supabase.functions.invoke('forgot-password', { body: { username: who, redirectTo } });
      if (error) return 'Could not send the code right now. Please try again in a minute.';
      return data?.error ? String(data.error) : null;
    }
    // an email goes through the server too, so an account that signs in only with Google gets no reset code
    const { error } = await supabase.functions.invoke('forgot-password', { body: { email: who, redirectTo } });
    return error ? 'Could not send the code right now. Please try again in a minute.' : null;
  }

  async function submit() {
    if (!who) return setErr('Please enter your email or username.');
    setBusy(true);
    setErr(null);
    const e = await sendCode();
    setBusy(false);
    if (e) setErr(e);
    else setStep('code');
  }

  async function save() {
    setErr(null);
    const problem = passwordProblem(pw);
    if (problem) return setErr(problem);
    if (pw !== pw2) return setErr("The two passwords don't match.");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) { setBusy(false); return setErr('Could not save your new password. Please try again in a minute.'); }
    // whoever else had this account open (another phone, a shared computer) is logged out
    await supabase.auth.signOut({ scope: 'others' });
    setBusy(false);
    setStep('done');
    setTimeout(() => router.replace('/(tabs)/(play)'), 1500);
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
      {step === 'ask' && (
        <>
          <Text style={{ color: colors.muted, marginBottom: 18 }}>Type your email or username and we will email you a code.</Text>
          {err && <Note kind="error">{err}</Note>}
          <Field label="Email or username" value={id} onChangeText={setId} autoCapitalize="none" autoCorrect={false} autoComplete="username"
            returnKeyType="send" onSubmitEditing={submit} />
          <Button title="Send the code" onPress={submit} loading={busy} />
        </>
      )}
      {step === 'code' && (
        <>
          <Text style={{ color: colors.text, marginBottom: 14 }}>
            📬 If an account exists for {who}, we've emailed it a code. Type the code below, then choose a new password. Signed up with Google? There is no password: use Continue with Google to log in.
          </Text>
          <CodeEntry type="recovery" email={isUsername ? undefined : who} username={isUsername ? who.replace(/^@/, '') : undefined}
            onVerified={() => { setErr(null); setStep('password'); }} onResend={sendCode} />
        </>
      )}
      {step === 'password' && (
        <>
          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 18, marginBottom: 12 }}>Choose a new password</Text>
          {err && <Note kind="error">{err}</Note>}
          <Field label="New password" value={pw} onChangeText={setPw} secureTextEntry autoCapitalize="none" autoComplete="new-password" textContentType="newPassword" />
          <Field label="Type it again" value={pw2} onChangeText={setPw2} secureTextEntry autoCapitalize="none" autoComplete="new-password" textContentType="newPassword" />
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: -6, marginBottom: 12 }}>At least 8 characters, with a letter and a number.</Text>
          <Button title="Save new password" onPress={save} loading={busy} />
        </>
      )}
      {step === 'done' && <Note kind="ok">✅ Your new password is saved and you are logged in.</Note>}
    </ScrollView>
    </KeyboardAvoidingView>
  );
}
