import { useCallback, useEffect, useState } from 'react';
import { Linking, ScrollView, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { SvgXml } from 'react-native-svg';
import { Text } from '@/components/AppText';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { isAdmin } from '@/lib/admin';
import { colors, fonts } from '@/lib/theme';
import { Loading } from '@/components/owner';
import { Button, Field, Note } from '@/components/ui';

// The admin side, like the website's /admin: only for admins, and only after the two-step code.
export default function AdminLayout() {
  const router = useRouter();
  const { session, loading } = useAuth();
  const [ok, setOk] = useState<boolean | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!session) return router.replace('/login');
    isAdmin(session.user.id).then((a) => (a ? setOk(true) : router.replace('/(tabs)/(play)')));
  }, [loading, session?.user.id]);

  if (!ok) return <Loading />;
  return (
    <TwoStep>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.text,
          headerTitleStyle: { fontFamily: fonts.displayBold, fontSize: 19 },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.bg },
        }}
      />
    </TwoStep>
  );
}

type Step = { kind: 'loading' } | { kind: 'ok' } | { kind: 'code'; factorId: string } | { kind: 'setup'; factorId: string; qr: string; secret: string; uri: string };

// Admin two-step login, like the website: a 6-digit code from an authenticator app. The first time the admin links
// the app. On a phone the authenticator is usually on the same phone, so "Open in authenticator" adds it directly.
// The database checks the same thing: admin actions refuse a login that has not entered a code.
function TwoStep({ children }: { children: React.ReactNode }) {
  const [step, setStep] = useState<Step>({ kind: 'loading' });
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const decide = useCallback(async () => {
    const { data: aal, error: aalErr } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aalErr) return setError('Could not check your login. Close and open this screen again.');
    if (aal.currentLevel === 'aal2') return setStep({ kind: 'ok' });
    const { data: factors, error: listErr } = await supabase.auth.mfa.listFactors();
    if (listErr) return setError('Could not check your login. Close and open this screen again.');
    const linked = factors.totp.find((f) => f.status === 'verified');
    if (linked) return setStep({ kind: 'code', factorId: linked.id });
    for (const f of factors.all.filter((f) => f.status === 'unverified')) await supabase.auth.mfa.unenroll({ factorId: f.id });
    const { data: added, error: addErr } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Zaf Play admin' });
    if (addErr || !added) return setError('Could not start the two-step setup. Close and open this screen again.');
    setStep({ kind: 'setup', factorId: added.id, qr: added.totp.qr_code, secret: added.totp.secret, uri: added.totp.uri });
  }, []);
  useEffect(() => { decide(); }, [decide]);

  async function confirm() {
    if (step.kind !== 'code' && step.kind !== 'setup') return;
    if (!/^\d{6}$/.test(code)) return setError('Enter the 6-digit code from your authenticator app.');
    setBusy(true);
    setError('');
    const { error: e } = await supabase.auth.mfa.challengeAndVerify({ factorId: step.factorId, code });
    setBusy(false);
    if (e) { setCode(''); return setError('That code is wrong or has expired. Enter the newest code from the app.'); }
    setStep({ kind: 'ok' });
  }

  if (step.kind === 'ok') return <>{children}</>;
  if (step.kind === 'loading') return error ? <View style={{ padding: 24 }}><Note kind="error">{error}</Note></View> : <Loading />;

  const svg = step.kind === 'setup' ? decodeURIComponent(step.qr.replace(/^data:image\/svg\+xml;(utf-8|charset=utf-8)?,?/, '')) : '';
  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: 20, paddingTop: 70 }} keyboardShouldPersistTaps="handled">
      <Text style={{ color: colors.text, fontFamily: fonts.display, fontSize: 26, marginBottom: 8 }}>Two-step login</Text>
      {step.kind === 'setup' ? (
        <>
          <Text style={{ color: colors.muted, marginBottom: 12 }}>
            Admin screens need a second step. Add Zaf Play to an authenticator app (Google Authenticator, Microsoft Authenticator or 1Password), then enter the 6-digit code it shows.
          </Text>
          <Button title="Open in my authenticator app" onPress={() => Linking.openURL(step.uri).catch(() => setError('No authenticator app found. Install one, or type the key below into it.'))} />
          <Text style={{ color: colors.muted, marginTop: 14, fontSize: 12 }}>Or scan this from another phone:</Text>
          {svg.startsWith('<svg') && <View style={{ alignSelf: 'center', backgroundColor: '#fff', padding: 8, borderRadius: 12, marginVertical: 10 }}><SvgXml xml={svg} width={180} height={180} /></View>}
          <Text style={{ color: colors.muted, fontSize: 12, textAlign: 'center' }} onPress={() => Clipboard.setStringAsync(step.secret)}>
            Or type this key in the app (tap to copy): <Text style={{ color: colors.text }}>{step.secret}</Text>
          </Text>
        </>
      ) : (
        <Text style={{ color: colors.muted, marginBottom: 12 }}>Enter the 6-digit code from your authenticator app.</Text>
      )}
      <View style={{ height: 14 }} />
      <Field label="6-digit code" value={code} onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={6} />
      {!!error && <Note kind="error">{error}</Note>}
      <Button title={busy ? 'Checking...' : 'Continue'} onPress={confirm} loading={busy} />
    </ScrollView>
  );
}
