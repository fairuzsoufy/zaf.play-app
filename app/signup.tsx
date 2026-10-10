import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SITE_URL, supabase } from '@/lib/supabase';
import { colors, useTheme } from '@/lib/theme';
import { Button, Field, Note } from '@/components/ui';
import { LegalLinks } from '@/components/LegalLinks';
import { Gender, GenderField, UsernameField, UsernameStatus } from '@/components/forms';
import { suggestUsername } from '@/lib/username';
import { FULL_NAME_HELP, isEgyptMobile, isFullName, onlyDigits, PHONE_HELP } from '@/lib/validate';

function friendly(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('did you mean') || m.includes('throwaway') || m.includes("doesn't receive email") || m.includes('valid email address')) return message;
  if (m.includes('already registered') || m.includes('already been registered') || m.includes('user already exists')) return 'This email is already registered. Please log in instead.';
  if (m.includes('database error saving new user') || m.includes('duplicate key')) return 'An account with this email or phone number already exists. Please log in instead.';
  if (m.includes('rate limit') || m.includes('too many') || m.includes('for security purposes')) return 'Too many attempts. Please wait a few minutes and try again.';
  if (m.includes('invalid') && m.includes('email')) return 'Please enter a valid email address.';
  return 'Could not create your account right now. Please try again in a minute.';
}

export default function Signup() {
  useTheme();
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [gender, setGender] = useState<Gender>('');
  const [userStatus, setUserStatus] = useState<UsernameStatus>('');
  const [touched, setTouched] = useState(false);
  const [refCode, setRefCode] = useState('');
  const [refName, setRefName] = useState<{ code: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState('');
  const [wait, setWait] = useState(0);
  const [info, setInfo] = useState<string | null>(null);

  const code = refCode.trim();
  const refBy = refName && refName.code === code ? refName.name : null;
  useEffect(() => {
    if (code.length < 6) return;
    const t = setTimeout(async () => {
      const { data, error } = await supabase.rpc('check_referral_code', { p_code: code });
      if (!error) setRefName({ code, name: (data as string) || '' });
    }, 350);
    return () => clearTimeout(t);
  }, [code]);
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  async function submit() {
    setErr(null);
    if (!fullName.trim() || !email.trim() || !phone || !password) return setErr('Please fill in all fields.');
    if (!isFullName(fullName)) return setErr(FULL_NAME_HELP);
    if (!isEgyptMobile(phone)) return setErr(PHONE_HELP);
    if (!gender) return setErr('Please choose male or female.');
    if (userStatus !== 'ok') return setErr('Please choose an available username (3–20 characters: letters, numbers, _ and .).');
    if (code && refBy === '') return setErr('That referral code was not found. Check it, or leave it empty.');
    if (password.length < 6) return setErr('Your password needs at least 6 characters.');
    setBusy(true);
    // is the email real? (the same check the website runs)
    try {
      const { data } = await supabase.functions.invoke('check-email', { body: { email: email.trim() } });
      if (data && !data.ok) { setBusy(false); return setErr(data.reason || 'Please check your email address.'); }
    } catch { /* let it through, the confirmation email is the real test */ }
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo: `${SITE_URL}/`,
        data: { full_name: fullName.trim().replace(/\s+/g, ' '), phone, role: 'player', gender, username: username.trim(), referral_code: code || undefined },
      },
    });
    setBusy(false);
    if (error) return setErr(friendly(error.message));
    if (data.user && data.user.identities && data.user.identities.length === 0) return setErr('This email is already registered. Please log in instead.');
    if (!data.session) return setSentTo(email.trim().toLowerCase());
    router.replace('/');
  }

  async function resend() {
    setInfo(null);
    const { error } = await supabase.auth.resend({ type: 'signup', email: sentTo, options: { emailRedirectTo: `${SITE_URL}/` } });
    if (error) {
      const m = error.message.toLowerCase();
      return setInfo(m.includes('rate') || m.includes('seconds') ? 'Please wait a minute before asking for another email.' : 'Could not send the email right now. Please try again in a minute.');
    }
    setInfo('A new email is on its way. Use the newest one.');
    setWait(60);
  }

  if (sentTo) {
    return (
      <ScrollView contentContainerStyle={{ padding: 20 }}>
        <Text style={{ color: colors.text, fontSize: 24, fontWeight: '800', marginBottom: 8 }}>Check your email</Text>
        <Text style={{ color: colors.muted, marginBottom: 14 }}>
          We sent an email to {sentTo}. Tap the button in it and type the code to confirm your account, then come back here and log in.
        </Text>
        {info && <Note kind="ok">{info}</Note>}
        <Button title={wait > 0 ? `Send the email again (${wait}s)` : 'Send the email again'} variant="ghost" disabled={wait > 0} onPress={resend} />
        <View style={{ height: 12 }} />
        <Button title="Go to log in" onPress={() => router.replace('/login')} />
        <Pressable onPress={() => setSentTo('')}><Text style={{ color: colors.primaryAlt, textAlign: 'center', marginTop: 16 }}>Wrong email? Go back</Text></Pressable>
      </ScrollView>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Text style={{ color: colors.text, fontSize: 26, fontWeight: '800', marginBottom: 4 }}>Join Zaf Play</Text>
        <Text style={{ color: colors.muted, marginBottom: 22 }}>Book courts in seconds.</Text>
        {err && <Note kind="error">{err}</Note>}
        <Field label="Full name" value={fullName} onChangeText={setFullName} autoComplete="name" placeholder="First and last name"
          onBlur={async () => {
            if (touched || username || !isFullName(fullName)) return;
            const s = await suggestUsername(fullName);
            if (s) setUsername((cur) => cur || s);
          }} />
        <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" />
        <Field label="Mobile number" value={phone} onChangeText={(v) => setPhone(onlyDigits(v))} keyboardType="number-pad" maxLength={11} placeholder="01xxxxxxxxx" />
        <GenderField value={gender} onChange={setGender} />
        <UsernameField value={username} onChange={(v) => { setTouched(true); setUsername(v); }} onStatus={setUserStatus} hint="So friends can find you for teams and games." />
        <Field label="Referral code (optional)" value={refCode} onChangeText={(v) => setRefCode(v.toUpperCase().slice(0, 12))} autoCapitalize="characters" autoCorrect={false} />
        {code.length >= 6 && refBy !== null && (
          <Text style={{ color: refBy ? colors.success : colors.danger, marginTop: -8, marginBottom: 14 }}>
            {refBy ? `Invited by ${refBy}. You get a welcome discount on your first booking.` : 'That referral code was not found.'}
          </Text>
        )}
        <Field label="Password (at least 6 characters)" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoComplete="new-password" />
        <LegalLinks lead="By creating an account you agree to our" style={{ marginBottom: 12 }} />
        <Button title="Create my account" onPress={submit} loading={busy} />
        <Pressable onPress={() => router.replace('/login')}><Text style={{ color: colors.primaryAlt, textAlign: 'center', marginTop: 18 }}>Already have an account? Log in</Text></Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
