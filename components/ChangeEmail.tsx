import { useState } from 'react';
import { Text, View } from 'react-native';
import { SITE_URL, supabase } from '@/lib/supabase';
import { colors, fonts, radius, useTheme } from '@/lib/theme';
import { Button, Field } from './ui';

// Change login email, like the website: Supabase sends a confirmation link to the new address and
// the change only happens once it's opened (the database copy then syncs itself).
export function ChangeEmail({ current }: { current: string }) {
  useTheme();
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  async function save() {
    setMsg('');
    const next = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(next)) return setMsg('❌ Please enter a valid email address.');
    if (next === current.toLowerCase()) return setMsg('❌ That is already your email.');
    setSaving(true);
    const { data: free } = await supabase.rpc('email_available', { p_email: next });
    if (!free) { setSaving(false); return setMsg('❌ This email is already used by another Zaf Play account.'); }
    try {
      const { data } = await supabase.functions.invoke('check-email', { body: { email: next } });
      if (data && !data.ok) { setSaving(false); return setMsg(`❌ ${data.reason || 'Please check your email address.'}`); }
    } catch { /* the confirmation link is the real test */ }
    const { error } = await supabase.auth.updateUser({ email: next }, { emailRedirectTo: `${SITE_URL}/profile` });
    setSaving(false);
    if (error) return setMsg(`❌ ${error.message}`);
    setEmail('');
    setMsg(`📧 We sent a confirmation link to ${next}. Your email changes once you open it. Until then, keep logging in with ${current}.`);
  }

  return (
    <View style={{ backgroundColor: colors.card, borderRadius: radius.xl, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: colors.border }}>
      <Text style={{ color: colors.text, fontFamily: fonts.displayBold, fontSize: 20, marginBottom: 8 }}>Email</Text>
      <Text style={{ color: colors.muted, fontSize: 12 }}>Current email</Text>
      <Text style={{ color: colors.text, marginBottom: 12 }}>{current}</Text>
      <Field label="New email" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" placeholder="name@example.com" />
      <Button title="Change email" onPress={save} loading={saving} disabled={!email.trim()} />
      <Text style={{ color: msg ? colors.text : colors.muted, fontSize: msg ? 14 : 12, textAlign: 'center', marginTop: 8 }}>
        {msg || 'We email a link to the new address to confirm it.'}
      </Text>
    </View>
  );
}
