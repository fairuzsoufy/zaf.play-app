import { Fragment, useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { Text } from '@/components/AppText';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { isAgreementSigner, loadLatestAgreement, loadMySignature, signedDate, type AgreementSignature, type AgreementVersion } from '@/lib/agreement';
import { useT } from '@/lib/ownerLang';
import { colors } from '@/lib/theme';
import { Box, Loading, Muted, useOwner } from '@/components/owner';
import { Button, Field, Note } from '@/components/ui';

// The partner agreement, like the website's /owner/agreement. The owner and each co-owner sign it with their
// full name before using the dashboard; afterwards this screen shows what they signed and when.
export default function OwnerAgreement() {
  const router = useRouter();
  const { session } = useAuth();
  const { access } = useOwner();
  const { t, lang } = useT();
  const [loading, setLoading] = useState(true);
  const [agreement, setAgreement] = useState<AgreementVersion | null>(null);
  const [signature, setSignature] = useState<AgreementSignature | null>(null);
  const [name, setName] = useState('');
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      const latest = await loadLatestAgreement();
      setAgreement(latest);
      if (latest && session) setSignature(await loadMySignature(session.user.id, latest.version));
      setLoading(false);
    })();
  }, []);

  async function sign() {
    if (!agreement || busy) return;
    setError('');
    const full = name.trim().replace(/\s+/g, ' ');
    if (full.length < 5 || !full.includes(' ')) return setError(t('Please type your full name (first and last name).'));
    if (!agree) return setError(t('Please tick the box to agree.'));
    setBusy(true);
    const { data, error: e } = await supabase.rpc('sign_owner_agreement', { p_version: agreement.version, p_full_name: full });
    setBusy(false);
    if (e) return setError(e.message);
    setSignature({ full_name: full, signed_at: data as string, version: agreement.version });
  }

  if (loading) return <Loading />;

  if (!agreement)
    return (
      <View style={{ padding: 20 }}>
        <Muted>{t("Your partner agreement isn't ready yet. We'll email you when it is.")}</Muted>
      </View>
    );

  const signer = isAgreementSigner(access);
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        <Text style={{ color: colors.text, fontSize: 22, fontWeight: '800' }}>{t('Zaf Play Court Partner Agreement')}</Text>
        <Muted style={{ marginBottom: 14 }}>{t('Version {n}', { n: agreement.version })}</Muted>
        {lang === 'ar' && <Muted style={{ marginBottom: 14 }}>{t('The agreement itself is written in English, and the English text is the one you sign.')}</Muted>}

        {signature ? (
          <Box tone="ok">
            <Text style={{ color: colors.success, fontWeight: '700' }}>✓ {t('Signed by {name}', { name: signature.full_name })}</Text>
            <Muted>{signedDate(signature.signed_at)} {t('(Cairo time)')}</Muted>
            <View style={{ marginTop: 10 }}>
              <Button small title={t('Go to my dashboard')} onPress={() => router.replace('/owner')} />
            </View>
          </Box>
        ) : signer ? (
          <Box tone="warn">
            <Text style={{ color: colors.noteText }}>{t('Please read the agreement and sign it at the bottom of this page before you use your dashboard.')}</Text>
          </Box>
        ) : null}

        <View style={{ direction: 'ltr' }}>
          <AgreementText body={agreement.body} />
        </View>

        {!signature && signer && (
          <Box style={{ marginTop: 20 }}>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 17, marginBottom: 10 }}>{t('Sign')}</Text>
            <Field label={t('Your full name')} value={name} onChangeText={setName} autoComplete="name" maxLength={120} placeholder={t('First and last name')} />
            <Muted style={{ marginBottom: 10 }}>{t('Date: filled in automatically when you sign.')}</Muted>
            <Pressable onPress={() => setAgree(!agree)} accessibilityRole="checkbox" accessibilityState={{ checked: agree }}
              style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 14 }}>
              <Text style={{ color: agree ? colors.success : colors.muted, fontSize: 20, marginRight: 8 }}>{agree ? '☑' : '☐'}</Text>
              <Text style={{ color: colors.text, flex: 1 }}>{t('I have read this agreement and I agree to it, including starting my courts on the Trial plan.')}</Text>
            </Pressable>
            {!!error && <Note kind="error">{error}</Note>}
            <Button title={busy ? t('Signing...') : t('Sign the agreement')} onPress={sign} loading={busy} />
          </Box>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// The agreement text from the database, in the same small part of Markdown as the website's AgreementText:
// "## " headings, "- " bullets, "|" tables, "---" lines, **bold** and plain paragraphs.
function inline(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <Text key={i} style={{ fontWeight: '800' }}>{part.slice(2, -2)}</Text>
      : <Fragment key={i}>{part}</Fragment>
  );
}

const cells = (row: string) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

function AgreementText({ body }: { body: string }) {
  const p = { color: colors.text, fontSize: 14, lineHeight: 21, marginBottom: 10 };
  return (
    <View>
      {body.trim().split(/\n\s*\n/).map((block, i) => {
        const lines = block.split('\n');
        if (block.trim() === '---') return <View key={i} style={{ height: 1, backgroundColor: colors.border, marginVertical: 12 }} />;
        if (block.startsWith('## ')) return <Text key={i} style={{ color: colors.text, fontSize: 17, fontWeight: '800', marginTop: 8, marginBottom: 8 }}>{block.slice(3)}</Text>;
        if (lines.every((l) => l.trim().startsWith('|'))) {
          const [head, , ...rows] = lines;
          return (
            <ScrollView key={i} horizontal style={{ marginBottom: 10 }}>
              <View>
                {[head, ...rows].map((r, k) => (
                  <View key={k} style={{ flexDirection: 'row' }}>
                    {cells(r).map((c, j) => (
                      <Text key={j} style={{ color: colors.text, width: 150, padding: 6, borderWidth: 0.5, borderColor: colors.border, fontSize: 13, fontWeight: k === 0 ? '800' : '400' }}>{inline(c)}</Text>
                    ))}
                  </View>
                ))}
              </View>
            </ScrollView>
          );
        }
        if (lines.every((l) => l.startsWith('- '))) {
          return (
            <View key={i} style={{ marginBottom: 10 }}>
              {lines.map((l, j) => <Text key={j} style={[p, { marginBottom: 4 }]}>•  {inline(l.slice(2))}</Text>)}
            </View>
          );
        }
        return <Text key={i} style={p}>{inline(lines.join(' '))}</Text>;
      })}
    </View>
  );
}
