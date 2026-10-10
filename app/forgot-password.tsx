import { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { Button, Field, Note } from '@/components/ui';
import { SITE_URL, supabase } from '@/lib/supabase';
import { colors, useTheme } from '@/lib/theme';

export default function ForgotPassword() {
  useTheme();
  const [id, setId] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    const value = id.trim();
    if (!value) return setErr('Type your email or username.');
    setBusy(true);
    setErr(null);
    // The reset page is on the website; the email button opens it and asks for the code.
    const redirectTo = `${SITE_URL}/auth/confirm?type=recovery&next=/reset-password`;
    let message: string | null = null;
    if (value.includes('@')) {
      const { error } = await supabase.auth.resetPasswordForEmail(value, { redirectTo });
      if (error && /rate|seconds/i.test(error.message)) message = error.message;
    } else {
      const { data, error } = await supabase.functions.invoke('forgot-password', {
        body: { username: value, redirectTo },
      });
      if (error) message = 'Something went wrong. Please try again in a minute.';
      else if (data?.error) message = String(data.error);
    }
    setBusy(false);
    if (message) setErr(message);
    else setSent(true);
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
      <Text style={{ color: colors.muted, marginBottom: 18 }}>
        Type your email or username and we will send you a code.
      </Text>
      {err && <Note kind="error">{err}</Note>}
      {sent ? (
        <Note kind="ok">
          If that account exists, an email is on its way. Tap the button in it and type the code.
        </Note>
      ) : null}
      <Field
        label="Email or username"
        value={id}
        onChangeText={setId}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="username"
        returnKeyType="send"
        onSubmitEditing={submit}
      />
      <Button title={sent ? 'Send again' : 'Send the email'} onPress={submit} loading={busy} />
    </ScrollView>
  );
}
