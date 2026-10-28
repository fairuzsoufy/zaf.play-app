import { useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, Switch, View } from 'react-native';
import { Text } from '@/components/AppText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { SITE_URL, supabase } from '@/lib/supabase';
import { colors, fonts, radius, useTheme } from '@/lib/theme';
import { Button, Field, Note } from '@/components/ui';
import { LegalLinks } from '@/components/LegalLinks';
import { Gender, GenderField, UsernameField, UsernameStatus } from '@/components/forms';
import { capitalizeWords, FULL_NAME_HELP, isEgyptMobile, isFullName, onlyDigits, passwordProblem, PHONE_HELP } from '@/lib/validate';
import { checkSignupEmail } from '@/lib/signupEmail';
import { CodeEntry } from '@/components/CodeEntry';

// same rule as the website's isEnglishText
const isEnglish = (v: string) => /^[A-Za-z0-9\s.,'’&()\-/#:+!?@]*$/.test(v);
const ENGLISH_HELP = 'Please write this in English (letters A–Z, numbers and simple punctuation).';

function friendly(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('already registered') || m.includes('already been registered') || m.includes('user already exists')) return 'This email is already registered. Please log in instead.';
  if (m.includes('database error saving new user') || m.includes('duplicate key')) return 'An account with this email or phone number already exists. Please log in instead.';
  if (m.includes('rate limit') || m.includes('too many') || m.includes('for security purposes')) return 'Too many attempts. Please wait a few minutes and try again.';
  if (m.includes('invalid') && m.includes('email')) return 'Please enter a valid email address.';
  return 'Could not create your account right now. Please try again in a minute.';
}

// is the email real? (the same check-email function the website uses); '' means fine
async function emailProblem(email: string): Promise<string> {
  try {
    const { data, error } = await supabase.functions.invoke('check-email', { body: { email: email.trim() } });
    if (error || !data) return '';
    return data.ok ? '' : data.reason || 'Please check your email address.';
  } catch {
    return '';
  }
}

// Court owners sign up here (like zafplay.com/signup/owner). We approve them, then they add branches and courts on the website.
export default function OwnerSignup() {
  const insets = useSafeAreaInsets();
  useTheme();
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [gender, setGender] = useState<Gender>('');
  const [username, setUsername] = useState('');
  const [userStatus, setUserStatus] = useState<UsernameStatus>('');
  const [business, setBusiness] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [hasCo, setHasCo] = useState(false);
  const [coName, setCoName] = useState('');
  const [coEmail, setCoEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const [confirmed, setConfirmed] = useState(false);

  async function submit() {
    setErr(null);
    if (!fullName.trim() || !email.trim() || !phone || !password || !business.trim()) return setErr('Please fill in all fields.');
    if (!isFullName(fullName)) return setErr(FULL_NAME_HELP);
    if (!isEgyptMobile(phone)) return setErr(PHONE_HELP);
    if (!gender) return setErr('Please choose male or female.');
    if (!isEnglish(business)) return setErr(`Business name: ${ENGLISH_HELP}`);
    const pwErr = passwordProblem(password);
    if (pwErr) return setErr(pwErr);
    if (hasCo) {
      if (!isFullName(coName)) return setErr(`Co-owner: ${FULL_NAME_HELP}`);
      if (!coEmail.trim() || coEmail.trim().toLowerCase() === email.trim().toLowerCase()) return setErr('Co-owner: enter their own email (not yours).');
    }
    if (userStatus !== 'ok') return setErr('Please choose an available username (3–20 characters: letters, numbers, _ and .).');

    setBusy(true);
    const e1 = await emailProblem(email);
    if (e1) { setBusy(false); return setErr(e1); }
    const mail = await checkSignupEmail(email, 'owner');
    if (!mail.ok) { setBusy(false); return setErr(mail.text); }
    if (hasCo) {
      const e2 = await emailProblem(coEmail);
      if (e2) { setBusy(false); return setErr(`Co-owner email: ${e2}`); }
      const { data: coTaken } = await supabase.rpc('co_owner_email_problem', { p_email: coEmail.trim() });
      if (coTaken) { setBusy(false); return setErr(`Co-owner email: ${coTaken}`); }
    }
    // a second account can't use the same mobile number
    const { data: phoneTaken } = await supabase.rpc('phone_in_use', { p_phone: phone });
    if (phoneTaken) { setBusy(false); return setErr('This mobile number is already used by another Zaf Play account. Log in instead, or use a different number.'); }
    // branches (area, address, InstaPay) are added from the dashboard after approval;
    // a co-owner gets their invite email once this account is approved
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo: `${SITE_URL}/`,
        data: {
          full_name: capitalizeWords(fullName),
          phone,
          role: 'owner',
          gender,
          username: username.trim(),
          business_name: capitalizeWords(business),
          co_owner_name: hasCo ? capitalizeWords(coName) : '',
          co_owner_email: hasCo ? coEmail.trim().toLowerCase() : '',
        },
      },
    });
    setBusy(false);
    if (error) return setErr(friendly(error.message));
    if (data.user && data.user.identities && data.user.identities.length === 0) return setErr('This email is already registered. Please log in instead.');
    setDone(true);
  }

  if (done) {
    const step = (n: string, title: string, body: string) => (
      <View style={{ flexDirection: 'row', gap: 12, marginBottom: 14 }}>
        <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: colors.soft, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: colors.primary, fontFamily: fonts.display }}>{n}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontFamily: fonts.displayBold, fontSize: 15 }}>{title}</Text>
          <Text style={{ color: colors.muted, marginTop: 2, lineHeight: 20 }}>{body}</Text>
        </View>
      </View>
    );
    return (
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 + insets.bottom }}>
        <Text style={{ color: colors.text, fontFamily: fonts.display, fontSize: 24, marginBottom: 6 }}>Almost there</Text>
        <Text style={{ color: colors.muted, marginBottom: 14 }}>We sent a code to {email.trim().toLowerCase()}. Type it here to confirm your email.</Text>
        {confirmed ? <Note kind="ok">✅ Email confirmed.</Note> : (
          <View style={{ marginBottom: 18 }}>
            <CodeEntry type="signup" email={email.trim().toLowerCase()} onVerified={() => setConfirmed(true)}
              onResend={async () => {
                const { error } = await supabase.auth.resend({ type: 'signup', email: email.trim().toLowerCase() });
                return error ? (/rate|seconds/i.test(error.message) ? 'Please wait a minute before asking for another code.' : 'Could not send the code right now. Please try again in a minute.') : null;
              }} />
          </View>
        )}
        <View style={{ backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: 16, paddingBottom: 4, marginBottom: 18 }}>
          {step('1', 'Confirm your email', 'Type the code from the email above.')}
          {step('2', 'We approve your account', 'The Zaf Play team reviews every new owner, usually within a day.' + (hasCo ? ' Your co-owner gets their sign-up email once you are approved.' : ''))}
          {step('3', 'Add your courts', 'On zafplay.com, add your branch (area, address and InstaPay for your earnings), then your courts, prices and hours. Once we check them, players can book.')}
        </View>
        <Button title="Open zafplay.com" onPress={() => Linking.openURL(`${SITE_URL}/login`)} />
        <View style={{ height: 10 }} />
        <Button title="Go to log in" variant="ghost" onPress={() => router.replace('/login')} />
      </ScrollView>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 + insets.bottom }} keyboardShouldPersistTaps="handled">
        <Text style={{ color: colors.text, fontFamily: fonts.display, fontSize: 24, marginBottom: 4 }}>List your courts on Zaf Play</Text>
        <Text style={{ color: colors.muted, marginBottom: 22 }}>Reach more players and manage your bookings in one place.</Text>
        {err && <Note kind="error">{err}</Note>}
        <Field label="Your full name" value={fullName} onChangeText={setFullName} autoComplete="name" placeholder="First and last name" />
        <GenderField value={gender} onChange={setGender} />
        <UsernameField value={username} onChange={setUsername} onStatus={setUserStatus} hint="You can log in with it instead of your email." />
        <Field label="Business / facility name (in English)" value={business} onChangeText={setBusiness} placeholder="e.g. Zaf Sports Center" />
        <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" />
        <Field label="Mobile number" value={phone} onChangeText={(v) => setPhone(onlyDigits(v))} keyboardType="number-pad" maxLength={11} placeholder="01xxxxxxxxx" />
        <Field label="Password (at least 6 characters)" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoComplete="new-password" />

        <View style={{ backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 16 }}>
          <Pressable onPress={() => setHasCo(!hasCo)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ color: colors.text, fontFamily: fonts.displayBold, fontSize: 15 }}>I have a co-owner</Text>
            <Switch value={hasCo} onValueChange={setHasCo} trackColor={{ true: colors.accent, false: colors.borderStrong }} thumbColor="#fff" />
          </Pressable>
          {hasCo && (
            <View style={{ marginTop: 14 }}>
              <Field label="Co-owner's full name" value={coName} onChangeText={setCoName} autoComplete="off" />
              <Field label="Co-owner's email" value={coEmail} onChangeText={setCoEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" />
              <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 18 }}>
                They get an email only after we approve your account, and finish signing up from it.
              </Text>
            </View>
          )}
        </View>

        <LegalLinks lead="By creating an account you agree to our" style={{ marginBottom: 12 }} />
        <Button title="Sign up as a court owner" onPress={submit} loading={busy} />
        <Pressable onPress={() => router.replace('/login')}><Text style={{ color: colors.primaryAlt, textAlign: 'center', marginTop: 18 }}>Already have an account? Log in</Text></Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
