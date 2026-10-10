import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, Share, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SITE_URL, supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { colors, fonts, radius, themed, useTheme } from '@/lib/theme';
import { dateLabel, egp } from '@/lib/format';
import { Button, Card, Field, GradientFill, GradientText, Note, PressableScale } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { DeleteAccount } from '@/components/DeleteAccount';
import { LegalLinks } from '@/components/LegalLinks';
import { toast } from '@/components/Toast';
import { Gender, GenderField, UsernameField, UsernameStatus } from '@/components/forms';
import { capitalizeWords, FULL_NAME_HELP, isEgyptMobile, isFullName, onlyDigits, PHONE_HELP } from '@/lib/validate';

const KIND: Record<string, string> = { earned: 'Added from a cancelled booking', used: 'Used on a booking', restored: 'Returned (booking was not paid)' };
const useCard = themed(() => ({ backgroundColor: colors.card, borderRadius: radius.lg, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: colors.border }));

export default function Profile() {
  const card = useCard();
  const router = useRouter();
  const params = useLocalSearchParams<{ edit?: string }>();
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

  // opened from booking to add a missing mobile number: start in edit mode
  useEffect(() => {
    if (params.edit === '1') { setEditing(true); router.setParams({ edit: undefined }); }
  }, [params.edit]);

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
    toast('Your profile is saved');
  }

  // leave edit mode without saving: put the saved values back
  function cancelEdit() {
    setFullName(me.full_name || ''); setPhone(me.phone || ''); setUsername(me.username || '');
    setGender(savedGender); setStatus(''); setMsg(null); setEditing(false);
  }

  if (authLoading) return <ActivityIndicator style={{ marginTop: 60 }} color={colors.primary} />;
  if (!session) {
    return (
      <View style={{ padding: 24 }}>
        <Text style={{ color: colors.muted, marginBottom: 16 }}>Log in to see your profile.</Text>
        <Button title="Log in" onPress={() => router.push('/login')} />
        <View style={{ height: 10 }} />
        <Button title="Create an account" variant="ghost" onPress={() => router.push('/signup')} />
        <Pressable onPress={() => router.push('/signup-owner')} hitSlop={8}>
          <Text style={{ color: colors.muted, textAlign: 'center', marginTop: 14 }}>
            Own courts? <Text style={{ color: colors.primaryAlt, fontWeight: '600' }}>Sign up as a court owner</Text>
          </Text>
        </Pressable>
      </View>
    );
  }
  if (!me) return <ActivityIndicator style={{ marginTop: 60 }} color={colors.primary} />;

  const link = ref?.code ? `${SITE_URL}/signup?ref=${ref.code}` : '';
  const shareText = `Join me on Zaf Play to book courts and play together. Use my code ${ref?.code} and get ${ref?.percent}% off your first booking: ${link}`;

  const initials = (me.full_name || me.email || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w: string) => w[0]?.toUpperCase()).join('');

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      {me.role !== 'player' && (
        <Note kind="ok">You are logged in as {me.role}. Owner and staff tools are on zafplay.com.</Note>
      )}

      {/* who you are: initials and name */}
      <View style={[card, { alignItems: 'center', paddingVertical: 22 }]}>
        <View style={{ alignItems: 'center' }}>
          <View style={{ width: 76, height: 76, borderRadius: 38, backgroundColor: colors.soft, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: colors.primary, fontFamily: fonts.display, fontSize: 28 }}>{initials}</Text>
          </View>
          <Text style={{ color: colors.text, fontFamily: fonts.display, fontSize: 22, marginTop: 10 }}>{me.full_name || 'Your name'}</Text>
          {me.username ? <Text style={{ color: colors.primary, fontWeight: '700', marginTop: 2 }}>@{me.username}</Text> : null}
          {credit !== null && credit > 0 && (
            <View style={{ marginTop: 10, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6, backgroundColor: colors.soft }}>
              <Text style={{ color: colors.success, fontWeight: '800' }}>💳 {egp(credit)} credit</Text>
            </View>
          )}
        </View>
      </View>

      {credit !== null && ledger.length > 0 && (
        <View style={card}>
          <Text style={{ color: colors.text, fontFamily: fonts.displayBold, fontSize: 18 }}>Credit history</Text>
          <Text style={{ color: colors.muted, marginTop: 2, fontSize: 12 }}>Taken off your next booking automatically.</Text>
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

      <View style={card}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <Text style={{ color: colors.text, fontFamily: fonts.displayBold, fontSize: 20 }}>My details</Text>
          {!editing && (
            <PressableScale onPress={() => setEditing(true)} hitSlop={8} accessibilityRole="button"
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, overflow: 'hidden' }}>
              <GradientFill />
              <Icon name="edit" color="#fff" size={15} />
              <Text style={{ color: '#fff', fontFamily: fonts.displayBold, fontSize: 15 }}>Edit</Text>
            </PressableScale>
          )}
        </View>
        {!editing ? (
          <>
            <Detail label="Full name" value={me.full_name} />
            <Detail label="Username" value={me.username ? `@${me.username}` : ''} />
            <Detail label="Mobile number" value={me.phone} />
            <Detail label="Gender" value={savedGender ? savedGender[0].toUpperCase() + savedGender.slice(1) : ''} />
            <Detail label="Email" value={me.email} last />
          </>
        ) : (
          <View style={{ marginTop: 10 }}>
            {msg && <Note kind={msg.kind}>{msg.text}</Note>}
            <Field label="Full name" value={fullName} onChangeText={setFullName} autoComplete="name" placeholder="First and last name" />
            <Field label="Mobile number" value={phone} onChangeText={(v) => setPhone(onlyDigits(v))} keyboardType="number-pad" maxLength={11} />
            <GenderField value={gender} onChange={setGender} />
            <UsernameField value={username} onChange={setUsername} onStatus={setStatus} current={me.username || ''}
              hint="Friends use it to find you for teams and games. 3–20 characters: letters, numbers, _ and ." />
            <Button title="Save changes" onPress={save} loading={saving} />
            <View style={{ height: 8 }} />
            <Button title="Cancel" variant="ghost" onPress={cancelEdit} />
          </View>
        )}
      </View>

      {ref?.code && (
        <Card glow style={{ padding: 14 }}>
          <Text style={{ color: colors.text, fontFamily: fonts.displayBold, fontSize: 17 }}>🎁 Invite friends · both get {ref.percent}% off</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 }}>
            <View style={{ flex: 1, borderRadius: radius.md, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.borderStrong, paddingVertical: 8, alignItems: 'center' }}>
              <GradientText style={{ fontFamily: fonts.display, fontSize: 20, letterSpacing: 1.5 }}>{ref.code}</GradientText>
            </View>
            <Button small title="Share" onPress={() => Share.share({ message: shareText })} />
            <PressableScale onPress={() => Linking.openURL(`https://wa.me/?text=${encodeURIComponent(shareText)}`)} accessibilityLabel="Share on WhatsApp"
              style={{ width: 44, height: 44, borderRadius: radius.md, backgroundColor: '#25D366', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="whatsapp" color="#fff" size={22} />
            </PressableScale>
          </View>
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: 8 }}>{ref.friends_joined} joined · {ref.available} discount{ref.available === 1 ? '' : 's'} waiting for you</Text>
        </Card>
      )}

      <Button title="Log out" onPress={() => supabase.auth.signOut()} />
      {me.role === 'player' && <DeleteAccount />}
      <LegalLinks style={{ marginTop: 18 }} />
    </ScrollView>
  );
}

function Detail({ label, value, last }: { label: string; value?: string | null; last?: boolean }) {
  useTheme();
  return (
    <View style={{ paddingVertical: 10, borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.border }}>
      <Text style={{ color: colors.muted, fontSize: 12 }}>{label}</Text>
      <Text style={{ color: value ? colors.text : colors.muted, fontSize: 16, fontWeight: '600', marginTop: 2 }}>{value || 'Not added yet'}</Text>
    </View>
  );
}
