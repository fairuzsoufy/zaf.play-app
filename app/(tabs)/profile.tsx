import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, Share, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SITE_URL, supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { colors, radius, useTheme } from '@/lib/theme';
import { dateLabel, egp } from '@/lib/format';
import { Button, Field, GradientFill, Note } from '@/components/ui';
import { Gender, GenderField, UsernameField, UsernameStatus } from '@/components/forms';
import { capitalizeWords, FULL_NAME_HELP, isEgyptMobile, isFullName, onlyDigits, PHONE_HELP } from '@/lib/validate';

const KIND: Record<string, string> = { earned: 'Added from a cancelled booking', used: 'Used on a booking', restored: 'Returned (booking was not paid)' };
const cardStyle = () => ({ backgroundColor: colors.card, borderRadius: radius.lg, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: colors.border });

function Info({ label, value }: { label: string; value?: string | null }) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 2 }}>{label}</Text>
      <Text style={{ color: colors.text, fontSize: 16, fontWeight: '600' }}>{value || '—'}</Text>
    </View>
  );
}

export default function Profile() {
  const { mode, setMode } = useTheme();
  const router = useRouter();
  const { session, loading: authLoading } = useAuth();
  const uid = session?.user.id;
  const [me, setMe] = useState<any>(null);
  const [ref, setRef] = useState<any>(null);
  const [credit, setCredit] = useState<number | null>(null);
  const [ledger, setLedger] = useState<any[]>([]);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [username, setUsername] = useState('');
  const [gender, setGender] = useState<Gender>('');
  const [savedGender, setSavedGender] = useState<Gender>('');
  const [status, setStatus] = useState<UsernameStatus>('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  // the "Saved" banner goes away by itself
  useEffect(() => { if (!saved) return; const t = setTimeout(() => setSaved(false), 3000); return () => clearTimeout(t); }, [saved]);

  const load = useCallback(async () => {
    if (!uid) return;
    const { data } = await supabase.from('users').select('full_name,email,phone,username,role,gender').eq('id', uid).single();
    const u = data as any;
    setMe(u);
    setFullName(u?.full_name || ''); setPhone(u?.phone || ''); setUsername(u?.username || '');
    setGender((u?.gender || '') as Gender); setSavedGender((u?.gender || '') as Gender);
    supabase.rpc('my_credit').then(({ data: c }) => setCredit(Number(c ?? 0)));
    supabase.from('credit_ledger').select('id,amount,kind,created_at,booking:bookings(court:courts(name))').order('created_at', { ascending: false }).limit(6)
      .then(({ data: l }) => setLedger((l ?? []) as any[]));
    if (u?.role === 'player') supabase.rpc('my_referrals').then(({ data: r }) => setRef(r));
  }, [uid]);
  useEffect(() => { load(); }, [load]);

  async function save() {
    setMsg(null);
    if (!isFullName(fullName)) return setMsg({ kind: 'error', text: FULL_NAME_HELP });
    if (!isEgyptMobile(phone)) return setMsg({ kind: 'error', text: PHONE_HELP });
    if (status === 'taken' || status === 'bad') return setMsg({ kind: 'error', text: 'Please choose an available username.' });
    if (!gender) return setMsg({ kind: 'error', text: 'Please choose male or female.' });
    setSaving(true);
    if (gender !== savedGender) {
      const { error } = await supabase.rpc('set_my_gender', { p_gender: gender });
      if (error) { setSaving(false); return setMsg({ kind: 'error', text: error.message }); }
      setSavedGender(gender);
    }
    const { error } = await supabase.rpc('update_my_profile', { p_full_name: capitalizeWords(fullName), p_phone: phone, p_username: username.trim().toLowerCase() || null });
    setSaving(false);
    if (error) return setMsg({ kind: 'error', text: error.message });
    setMe({ ...me, full_name: capitalizeWords(fullName), phone, username: username.trim().toLowerCase() || me.username });
    setStatus('');
    setEditing(false);
    setSaved(true);
  }

  function cancelEdit() {
    setEditing(false); setMsg(null); setStatus('');
    setFullName(me.full_name || ''); setPhone(me.phone || ''); setUsername(me.username || ''); setGender(savedGender);
  }

  if (authLoading) return <ActivityIndicator style={{ marginTop: 60 }} color={colors.primary} />;
  if (!session) {
    return (
      <View style={{ padding: 24 }}>
        <Text style={{ color: colors.muted, marginBottom: 16 }}>Log in to see your profile.</Text>
        <Button title="Log in" onPress={() => router.push('/login')} />
        <View style={{ height: 10 }} />
        <Button title="Create an account" variant="ghost" onPress={() => router.push('/signup')} />
      </View>
    );
  }
  if (!me) return <ActivityIndicator style={{ marginTop: 60 }} color={colors.primary} />;

  const link = ref?.code ? `${SITE_URL}/signup?ref=${ref.code}` : '';
  const shareText = `Join me on Zaf Play to book courts and play together. Use my code ${ref?.code} and get ${ref?.percent}% off your first booking: ${link}`;

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      {me.role !== 'player' && (
        <Note kind="ok">You are logged in as {me.role}. Owner and staff tools are coming to the app soon; for now use zafplay.com.</Note>
      )}

      {credit !== null && (credit > 0 || ledger.length > 0) && (
        <View style={cardStyle()}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <Text style={{ color: colors.text, fontWeight: '700' }}>💳 Zaf Play credit</Text>
            <Text style={{ color: colors.success, fontSize: 22, fontWeight: '800' }}>{egp(credit)}</Text>
          </View>
          <Text style={{ color: colors.muted, marginTop: 6, fontSize: 13 }}>Credit comes from a cancellation when you choose to keep it as credit. It is taken off your next booking automatically.</Text>
          {ledger.map((r) => (
            <View key={r.id} style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text }}>{KIND[r.kind] ?? r.kind}</Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>{dateLabel(r.created_at)}{r.booking?.court?.name ? ` · ${r.booking.court.name}` : ''}</Text>
              </View>
              <Text style={{ color: Number(r.amount) > 0 ? colors.success : colors.muted, fontWeight: '700' }}>{Number(r.amount) > 0 ? '+' : '−'} {egp(Math.abs(Number(r.amount)))}</Text>
            </View>
          ))}
        </View>
      )}

      {saved && <Note kind="ok">✅ Your changes are saved.</Note>}

      <View style={cardStyle()}>
        <Text style={{ color: colors.muted, marginBottom: 12 }}>{me.email}</Text>
        {editing ? (
          <>
            {msg && <Note kind={msg.kind}>{msg.text}</Note>}
            <Field label="Full name" value={fullName} onChangeText={setFullName} autoComplete="name" placeholder="First and last name" />
            <Field label="Mobile number" value={phone} onChangeText={(v) => setPhone(onlyDigits(v))} keyboardType="number-pad" maxLength={11} />
            <GenderField value={gender} onChange={setGender} />
            <UsernameField value={username} onChange={setUsername} onStatus={setStatus} current={me.username || ''}
              hint="Friends use it to find you for teams and games. 3–20 characters: letters, numbers, _ and ." />
            <Button title="Save changes" onPress={save} loading={saving} />
            <View style={{ height: 8 }} />
            <Button title="Cancel" variant="ghost" onPress={cancelEdit} />
          </>
        ) : (
          <>
            <Info label="Full name" value={me.full_name} />
            <Info label="Mobile number" value={me.phone} />
            <Info label="Gender" value={savedGender ? savedGender[0].toUpperCase() + savedGender.slice(1) : ''} />
            <Info label="Username" value={me.username ? `@${me.username}` : ''} />
            <View style={{ height: 4 }} />
            <Button title="Edit profile" onPress={() => { setSaved(false); setEditing(true); }} />
          </>
        )}
      </View>

      <View style={cardStyle()}>
        <Text style={{ color: colors.text, fontWeight: '700', marginBottom: 10 }}>Appearance</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {([['light', '☀️ Light'], ['dark', '🌙 Dark'], ['system', 'Auto']] as const).map(([m, label]) => (
            <Pressable key={m} onPress={() => setMode(m)} accessibilityRole="button" accessibilityState={{ selected: mode === m }}
              style={{ flex: 1, paddingVertical: 11, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: mode === m ? 'transparent' : colors.border, backgroundColor: colors.bg, overflow: 'hidden' }}>
              {mode === m && <GradientFill />}
              <Text style={{ color: mode === m ? '#fff' : colors.text, fontWeight: '600' }}>{label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {ref?.code && (
        <View style={cardStyle()}>
          <Text style={{ color: colors.text, fontWeight: '700' }}>🎁 Invite friends, both get {ref.percent}% off</Text>
          <Text style={{ color: colors.muted, marginTop: 6, fontSize: 13 }}>
            Your friend gets {ref.percent}% off their first booking. When they have played, you get {ref.percent}% off your next booking, for every friend.
          </Text>
          <Text style={{ color: colors.primaryAlt, fontSize: 26, fontWeight: '800', letterSpacing: 2, marginVertical: 10 }}>{ref.code}</Text>
          <Button title="Share my code" onPress={() => Share.share({ message: shareText })} />
          <View style={{ height: 8 }} />
          <Button title="Share on WhatsApp" variant="ghost" onPress={() => Linking.openURL(`https://wa.me/?text=${encodeURIComponent(shareText)}`)} />
          <Text style={{ color: colors.text, marginTop: 12 }}>Friends joined: {ref.friends_joined} · Discounts waiting for you: {ref.available}</Text>
          {(ref.rewards ?? []).map((r: any, i: number) => (
            <Text key={i} style={{ color: colors.muted, fontSize: 13, marginTop: 6 }}>
              {r.kind === 'welcome' ? `Welcome discount (invited by ${r.friend})` : `${r.friend} played, thank-you discount`}: {r.percent}% · {r.status === 'available' ? 'next booking' : `used ${r.used_at ? dateLabel(r.used_at) : ''}`}
            </Text>
          ))}
        </View>
      )}

      <Button title="Log out" variant="ghost" onPress={() => supabase.auth.signOut()} />
    </ScrollView>
  );
}
