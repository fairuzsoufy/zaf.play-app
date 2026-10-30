import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { Text } from '@/components/AppText';
import { Link, useRouter } from 'expo-router';
import { Button, Field, Note } from '@/components/ui';
import { signIn } from '@/lib/auth';
import { GoogleButton } from '@/components/GoogleButton';
import { CodeEntry } from '@/components/CodeEntry';
import { supabase } from '@/lib/supabase';
import { colors, useTheme } from '@/lib/theme';

export default function Login() {
  return <LoginForm />;
}

// also shown straight on the Profile tab when logged out (embedded: stay there after logging in)
export function LoginForm({ embedded = false }: { embedded?: boolean }) {
  useTheme();
  const link = { color: colors.linkSoft, fontWeight: '600' as const, textDecorationLine: 'underline' as const };
  const router = useRouter();
  const [id, setId] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setErr(null);
    const r = await signIn(id, pw);
    if (r.confirmEmail) {
      // someone who closed the sign-up screen by mistake just logs in and gets a fresh code
      await resend(r.confirmEmail);
      setBusy(false);
      return setConfirm(r.confirmEmail);
    }
    setBusy(false);
    if (r.error) return setErr(r.error);
    done();
  }

  // owners and their team go to the dashboard and admins to the admin screens, like the website; players go back to where they were
  async function done() {
    const { data } = await supabase.rpc('my_access');
    const role = (data as { role?: string } | null)?.role;
    if (role === 'owner' || role === 'staff') return router.replace('/owner');
    if (role === 'admin') return router.replace('/admin');
    if (embedded) return;
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  // a code sent less than a minute ago is refused; that code still works, so the screen just asks for it
  async function resend(email: string): Promise<string | null> {
    const { error } = await supabase.auth.resend({ type: 'signup', email });
    if (!error || /rate|seconds|too many/i.test(error.message)) return null;
    return 'Could not send a new code right now. Please try again in a minute.';
  }

  if (confirm) {
    return (
      <ScrollView contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
        <Text style={{ color: colors.text, fontSize: 22, fontWeight: '800', marginBottom: 8 }}>Confirm your email</Text>
        <Text style={{ color: colors.muted, marginBottom: 16 }}>We've emailed a code to {confirm}. Type it below to finish logging in.</Text>
        <CodeEntry type="signup" email={confirm} onVerified={done} onResend={() => resend(confirm)} />
      </ScrollView>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
        <Text style={{ color: colors.text, fontSize: 26, fontWeight: '800', marginBottom: embedded ? 16 : 4 }}>Welcome back</Text>
        {!embedded && <Text style={{ color: colors.muted, marginBottom: 22 }}>Log in with your email or username.</Text>}
        <GoogleButton />
        {err && <Note kind="error">{err}</Note>}
        <Field
          label="Email or username"
          value={id}
          onChangeText={setId}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username"
          textContentType="username"
          returnKeyType="next"
        />
        <Field
          label="Password"
          value={pw}
          onChangeText={setPw}
          secureTextEntry
          autoCapitalize="none"
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={submit}
        />
        <Button title="Log in" onPress={submit} loading={busy} />
        {/* the wording in the accent colour, the tappable part in white (text colour) and underlined */}
        <View style={{ alignItems: 'center', marginTop: 18, gap: 14 }}>
          <Link href="/forgot-password" style={link}>Forgot password?</Link>
          <Text style={{ color: colors.primary }}>New here? <Link href="/signup" replace={!embedded} style={link}>Create an account</Link></Text>
          <Text style={{ color: colors.primary }}>Own courts? <Link href="/signup-owner" replace={!embedded} style={link}>Sign up as a court owner</Link></Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
