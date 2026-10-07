import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { Link, useRouter } from 'expo-router';
import { Button, Field, Note } from '@/components/ui';
import { signIn } from '@/lib/auth';
import { colors } from '@/lib/theme';

export default function Login() {
  const router = useRouter();
  const [id, setId] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setErr(null);
    const e = await signIn(id, pw);
    setBusy(false);
    if (e) return setErr(e);
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
        <Text style={{ color: colors.text, fontSize: 26, fontWeight: '800', marginBottom: 4 }}>Welcome back</Text>
        <Text style={{ color: colors.muted, marginBottom: 22 }}>Log in with your email or username.</Text>
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
        <View style={{ alignItems: 'center', marginTop: 18 }}>
          <Link href="/forgot-password" style={{ color: colors.primaryAlt }}>Forgot password?</Link>
        </View>
        <Text style={{ color: colors.muted, textAlign: 'center', marginTop: 24, fontSize: 13 }}>
          New here? Sign-up in the app is coming soon — you can create your account on zafplay.com for now.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
