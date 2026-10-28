import { useEffect, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { supabase } from '@/lib/supabase';
import { colors, radius, useTheme } from '@/lib/theme';
import { Button, Note } from '@/components/ui';

const CODE_LENGTH = 8; // the codes in Zaf Play emails are 8 digits
const COOLDOWN_S = 60; // Supabase sends one email per address every 60 seconds

function friendlyCodeError(message: string) {
  const m = message.toLowerCase();
  if (m.includes('rate') || m.includes('too many') || m.includes('seconds')) return 'Too many tries. Please wait a few minutes and try again.';
  if (m.includes('expired') || m.includes('invalid')) return 'This code is wrong or has expired. Only the newest code we sent works. You can request a new one.';
  return 'Could not check the code. Please try again.';
}

// The 8-digit code from the email, like the website's CodeEntry: checked as soon as all digits are in.
// `type` signup confirms a new account, recovery logs in to choose a new password. With `username` (a reset asked
// for with a username) the code is checked on the server, so the email is never asked or shown.
export function CodeEntry({ email, username, type, onVerified, onResend }: {
  email?: string; username?: string; type: 'signup' | 'recovery'; onVerified: () => void; onResend: () => Promise<string | null>;
}) {
  const { scheme } = useTheme();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [wait, setWait] = useState(COOLDOWN_S);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  async function verify(c: string) {
    setBusy(true);
    setError('');
    setInfo('');
    if (username) {
      const { data, error: e } = await supabase.functions.invoke('forgot-password', { body: { username, code: c } });
      const s = !e && data?.access_token ? await supabase.auth.setSession({ access_token: data.access_token, refresh_token: data.refresh_token }) : null;
      setBusy(false);
      if (!s || s.error) return setError(friendlyCodeError(String(data?.error || e?.message || s?.error?.message || '')));
      return onVerified();
    }
    const { error: e } = await supabase.auth.verifyOtp({ email: (email || '').trim().toLowerCase(), token: c, type });
    setBusy(false);
    if (e) return setError(friendlyCodeError(e.message)); // what they typed stays, so one wrong digit can be fixed
    onVerified();
  }

  function take(value: string) {
    const digits = value.replace(/\D/g, '').slice(0, CODE_LENGTH);
    setCode(digits);
    if (error) setError('');
    if (digits.length === CODE_LENGTH && !busy) verify(digits);
  }

  async function paste() {
    const text = await Clipboard.getStringAsync();
    if (!/\d/.test(text)) return setError(`Copy the ${CODE_LENGTH}-number code from the email first, then press Paste code.`);
    take(text);
  }

  async function resend() {
    setError('');
    const e = await onResend();
    if (e) return setError(e);
    setInfo('A new code is on its way. Only the newest code works.');
    setCode('');
    setWait(COOLDOWN_S);
  }

  return (
    <View>
      <Text style={{ color: colors.text, fontWeight: '700' }}>Code from the email</Text>
      <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 8 }}>The {CODE_LENGTH} numbers we emailed you. Not your password.</Text>
      <TextInput value={code} onChangeText={take} keyboardType="number-pad" maxLength={CODE_LENGTH} autoFocus textContentType="oneTimeCode" autoComplete="one-time-code"
        keyboardAppearance={scheme} accessibilityLabel={`Code from the email, ${CODE_LENGTH} digits`} placeholder="••••••••" placeholderTextColor={colors.muted}
        style={{ borderWidth: 1, borderColor: error ? colors.danger : colors.border, borderRadius: radius.md, paddingVertical: 14, color: colors.text, fontSize: 26, letterSpacing: 8, textAlign: 'center', fontWeight: '700' }} />
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
        <View style={{ flex: 1 }}><Button small variant="ghost" title="Paste code" onPress={paste} /></View>
        <View style={{ flex: 1 }}><Button small title="Check code" loading={busy} disabled={code.length !== CODE_LENGTH} onPress={() => verify(code)} /></View>
      </View>
      {!!error && <View style={{ marginTop: 10 }}><Note kind="error">{error}</Note></View>}
      {!!info && <View style={{ marginTop: 10 }}><Note kind="ok">{info}</Note></View>}
      <View style={{ marginTop: 12 }}>
        <Button small variant="ghost" title={wait > 0 ? `Send a new code (${wait}s)` : 'Send a new code'} disabled={wait > 0} onPress={resend} />
      </View>
      <Text style={{ color: colors.muted, fontSize: 12, marginTop: 8 }}>Check spam if you don't see the email.</Text>
    </View>
  );
}
