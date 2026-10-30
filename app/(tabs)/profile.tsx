import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, Share, View } from 'react-native';
import { Text } from '@/components/AppText';
import { LoginForm } from '../login';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SITE_URL, supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { colors, fonts, radius, themed, useTheme } from '@/lib/theme';
import { dateLabel, egp } from '@/lib/format';
import { Button, Card, Field, GradientFill, GradientText, Note, PressableScale } from '@/components/ui';
import { Icon, type IconName } from '@/components/Icon';
import { Logo } from '@/components/Logo';
import { DeleteAccount } from '@/components/DeleteAccount';
import { AccountStatus, BlockedNotice } from '@/components/BlockedNotice';
import { FriendsCard } from '@/components/Friends';
import { ChangeEmail } from '@/components/ChangeEmail';
import { LoginSecurity } from '@/components/LoginSecurity';
import { ThemePicker } from '@/components/ThemeToggle';
import { ProgressRing, StreakProfile } from '@/components/PlayerStats';
import { LegalLinks } from '@/components/LegalLinks';
import { toast } from '@/components/Toast';
import { Gender, GenderField, UsernameField, UsernameStatus } from '@/components/forms';
import { capitalizeWords, FULL_NAME_HELP, isEgyptMobile, isFullName, onlyDigits, PHONE_HELP } from '@/lib/validate';

const KIND: Record<string, string> = { earned: 'Added from a cancelled booking', used: 'Used on a booking', restored: 'Returned (booking was not paid)' };
const useCard = themed(() => ({ backgroundColor: colors.card, borderRadius: radius.xl, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: colors.border }));

export default function Profile() {
  const card = useCard();
  const router = useRouter();
  const params = useLocalSearchParams<{ edit?: string; complete?: string }>();
  const [completing, setCompleting] = useState(false); // just signed in with Google: mobile, gender and username still needed
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
  const scroll = useRef<ScrollView>(null);
  const detailsY = useRef(0);

  // opened from booking to add a missing mobile number: start in edit mode
  useEffect(() => {
    if (params.edit === '1') { setEditing(true); router.setParams({ edit: undefined }); }
    if (params.complete === '1') { setCompleting(true); router.setParams({ complete: undefined }); }
  }, [params.edit, params.complete]);

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
    return <LoginForm embedded hero={<LoggedOutHero />} />;
  }
  if (!me) return <ActivityIndicator style={{ marginTop: 60 }} color={colors.primary} />;

  const link = ref?.code ? `${SITE_URL}/signup?ref=${ref.code}` : '';
  const shareText = `Join me on Zaf Play to book courts and play together. Use my code ${ref?.code} and get ${ref?.percent}% off your first booking: ${link}`;

  const initialsText = <GradientText style={{ fontFamily: fonts.display, fontSize: 38 }}>{(me.full_name || me.email || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w: string) => w[0]?.toUpperCase()).join('')}</GradientText>;
  const nameBlock = (
    <>
      <Text style={{ color: colors.tabOn, fontFamily: fonts.display, fontSize: 24, textAlign: 'center' }}>{me.full_name || 'Your name'}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 }}>
        {me.username ? <Text style={{ color: colors.primary, fontWeight: '700' }}>@{me.username}</Text> : null}
        {me.role === 'player' && <AccountStatus />}
      </View>
    </>
  );

  return (
    <ScrollView ref={scroll} style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      {(me.role === 'owner' || me.role === 'staff') && (
        <View style={{ marginBottom: 14 }}><Button title="Open the owner dashboard" onPress={() => router.push('/owner')} /></View>
      )}
      {me.role === 'admin' && <Button title="Open the admin screens" onPress={() => router.push('/admin')} />}

      {/* who you are: the Streak Ring (progress to the next badge) around your initials */}
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginBottom: -24, zIndex: 1 }}>
        {ref?.code && <IconButton icon="share" label="Invite friends" onPress={() => Share.share({ message: shareText })} />}
        <IconButton icon="edit" label="Edit my details" onPress={() => { setEditing(true); scroll.current?.scrollTo({ y: detailsY.current - 12, animated: true }); }} />
      </View>
      {me.role === 'player' ? (
        <StreakProfile uid={uid!} credit={credit} initials={initialsText} header={nameBlock} />
      ) : (
        <>
          <ProgressRing progress={1}>{initialsText}</ProgressRing>
          <View style={{ alignItems: 'center', marginTop: 10 }}>{nameBlock}</View>
          {credit !== null && credit > 0 && (
            <View style={{ alignSelf: 'center', marginTop: 10, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6, backgroundColor: colors.soft }}>
              <Text style={{ color: colors.success, fontWeight: '800' }}>{egp(credit)} credit</Text>
            </View>
          )}
        </>
      )}
      <View style={{ height: 16 }} />

      {me.role === 'player' && <BlockedNotice />}

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

      <View style={card} onLayout={(e) => { detailsY.current = e.nativeEvent.layout.y; }}>
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
            {completing && <Note kind="ok">Welcome to Zaf Play! One last step: add your mobile number, gender and a username, then save.</Note>}
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

      {me.email && <ChangeEmail current={me.email} />}
      <ThemePicker />
      <LoginSecurity />

      {me.role === 'player' && <FriendsCard />}

      {ref?.code && (
        <Card glow style={{ padding: 14 }}>
          <Text style={{ color: colors.text, fontFamily: fonts.displayBold, fontSize: 17 }}>🎁 Invite friends · both get {ref.percent}% off</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 }}>
            <View style={{ flex: 1, borderRadius: radius.md, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.borderStrong, paddingVertical: 8, alignItems: 'center' }}>
              <GradientText style={{ fontFamily: fonts.display, fontSize: 22, letterSpacing: 2 }}>{ref.code}</GradientText>
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

      <View style={{ marginTop: 16 }}><Button title="Log out" onPress={() => { router.replace('/'); supabase.auth.signOut({ scope: 'local' }); }} /></View>
      {me.role === 'player' && <DeleteAccount />}
      <LegalLinks style={{ marginTop: 18 }} />
    </ScrollView>
  );
}

// Small square button over the ring (share, edit).
function IconButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  useTheme();
  return (
    <PressableScale onPress={onPress} accessibilityLabel={label} hitSlop={6}
      style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={icon} color={colors.muted} size={17} />
    </PressableScale>
  );
}

// Logged out: an empty ring breathing around the logo, above the login form.
function LoggedOutHero() {
  useTheme();
  return (
    <View style={{ alignItems: 'center', marginBottom: 20, marginTop: 6 }}>
      <ProgressRing progress={0} breathe>
        <Logo width={84} />
      </ProgressRing>
      <Text style={{ color: colors.tabOn, fontFamily: fonts.display, fontSize: 26, marginTop: 14 }}>Every game counts</Text>
      <Text style={{ color: colors.muted, textAlign: 'center', marginTop: 4, paddingHorizontal: 16 }}>Log in to fill your ring, keep a streak and earn badges.</Text>
    </View>
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
