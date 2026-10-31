import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, Share, View } from 'react-native';
import { Text } from '@/components/AppText';
import { LoginForm } from '@/app/login';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SITE_URL, supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { colors, fonts, radius, themed, useTheme } from '@/lib/theme';
import { dateLabel, egp } from '@/lib/format';
import { Button, Card, Field, GradientText, Note, PressableScale } from '@/components/ui';
import { Icon, type IconName } from '@/components/Icon';
import { Logo } from '@/components/Logo';
import { DeleteAccount } from '@/components/DeleteAccount';
import { AccountStatus, BlockedNotice } from '@/components/BlockedNotice';
import { FriendsCard } from '@/components/Friends';
import { ChangeEmail } from '@/components/ChangeEmail';
import { askLogOutEverywhere, LoginSecurity } from '@/components/LoginSecurity';
import { ThemePicker } from '@/components/ThemeToggle';
import { nextBadgeText, ProgressRing, StatsPanel, usePlayerStats } from '@/components/PlayerStats';
import { LegalLinks } from '@/components/LegalLinks';
import { toast } from '@/components/Toast';
import { Gender, GenderField, UsernameField, UsernameStatus } from '@/components/forms';
import { capitalizeWords, FULL_NAME_HELP, isEgyptMobile, isFullName, onlyDigits, PHONE_HELP } from '@/lib/validate';

const KIND: Record<string, string> = { earned: 'Added from a cancelled booking', used: 'Used on a booking', restored: 'Returned (booking was not paid)' };
const useCard = themed(() => ({ backgroundColor: colors.card, borderRadius: radius.xl, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: colors.border }));

type Tab = 'me' | 'friends' | 'account';
type Section = 'details' | 'email' | 'password' | 'credit' | null;

export default function Profile() {
  const card = useCard();
  const router = useRouter();
  const params = useLocalSearchParams<{ edit?: string; complete?: string }>();
  const [completing, setCompleting] = useState(false); // just signed in with Google: mobile, gender and username still needed
  const { session, loading: authLoading } = useAuth();
  const uid = session?.user.id;
  // signs in with Google only (from the login token, so it's known on the first render): no password to change, email stays the Google one
  const providers: string[] = session?.user.app_metadata?.providers ?? [];
  const googleOnly = providers.length > 0 && providers.every((p) => p === 'google');
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
  // Profile is one page: the Me / Friends / Account tabs only change what's below, and Account's sections open in place.
  const [tab, setTab] = useState<Tab>('me');
  const [open, setOpen] = useState<Section>(null);
  const scroll = useRef<ScrollView>(null);
  const friendsY = useRef(0);
  const friendsCardY = useRef(0);
  const player = usePlayerStats(me?.role === 'player' ? uid : undefined);

  function editDetails() { setTab('account'); setOpen('details'); setEditing(true); }

  // opened from booking to add a missing mobile number: start in edit mode
  useEffect(() => {
    if (params.edit === '1') { editDetails(); router.setParams({ edit: undefined }); }
    if (params.complete === '1') { setCompleting(true); editDetails(); router.setParams({ complete: undefined }); }
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

  function logOut() {
    Alert.alert('Do you want to log out?', 'You can log in again any time.', [
      { text: 'Stay logged in', style: 'cancel' },
      { text: 'Yes, log out', style: 'destructive', onPress: () => { router.replace('/(tabs)/(play)'); supabase.auth.signOut({ scope: 'local' }); } },
    ]);
  }

  if (authLoading) return <ActivityIndicator style={{ marginTop: 60 }} color={colors.primary} />;
  if (!session) {
    return <LoginForm embedded hero={<LoggedOutHero />} />;
  }
  if (!me) return <ActivityIndicator style={{ marginTop: 60 }} color={colors.primary} />;

  const isPlayer = me.role === 'player';
  const shown: Tab = isPlayer ? tab : 'account'; // owners, staff and admins have no stats or friends here
  const link = ref?.code ? `${SITE_URL}/signup?ref=${ref.code}` : '';
  const shareText = `Join me on Zaf Play to book courts and play together. Use my code ${ref?.code} and get ${ref?.percent}% off your first booking: ${link}`;
  const initials = (me.full_name || me.email || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w: string) => w[0]?.toUpperCase()).join('');
  const logOutAll = (
    <PressableScale onPress={() => askLogOutEverywhere(router)} accessibilityRole="button"
      style={{ paddingHorizontal: 20, paddingVertical: 10, borderRadius: radius.md, backgroundColor: colors.cardAlt }}>
      <Text style={{ color: colors.text, fontWeight: '700' }}>Log out of all devices</Text>
    </PressableScale>
  );
  const toggle = (s: Section) => { setOpen(open === s ? null : s); if (s !== 'details') setEditing(false); };

  return (
    <ScrollView ref={scroll} style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 24 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      {(me.role === 'owner' || me.role === 'staff') && (
        <View style={{ marginBottom: 14 }}><Button title="Open the owner dashboard" onPress={() => router.push('/owner')} /></View>
      )}
      {me.role === 'admin' && <View style={{ marginBottom: 14 }}><Button title="Open the admin screens" onPress={() => router.push('/admin')} /></View>}

      {/* who you are: initials inside the Streak Ring (progress to the next game badge) */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <ProgressRing progress={isPlayer ? player.progress : 1} size={68} stroke={6}>
          <GradientText style={{ fontFamily: fonts.display, fontSize: 20 }}>{initials}</GradientText>
        </ProgressRing>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ color: colors.tabOn, fontFamily: fonts.display, fontSize: 21 }} numberOfLines={1}>{me.full_name || 'Your name'}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 }}>
            {me.username ? <Text style={{ color: colors.primary, fontWeight: '700' }} numberOfLines={1}>@{me.username}</Text> : null}
            {isPlayer && <AccountStatus />}
          </View>
          {isPlayer && player.stats && <Text style={{ color: colors.muted, fontSize: 12, marginTop: 3 }} numberOfLines={1}>{nextBadgeText(player.stats.games, player.next)}</Text>}
        </View>
      </View>

      {isPlayer && <View style={{ marginTop: 12 }}><BlockedNotice /></View>}

      {isPlayer && (
        <View style={{ flexDirection: 'row', marginTop: 12, marginBottom: 4, backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 3 }}>
          {([['me', 'Me'], ['friends', 'Friends'], ['account', 'Account']] as [Tab, string][]).map(([t, label]) => {
            const on = tab === t;
            return (
              <Pressable key={t} onPress={() => setTab(t)} accessibilityRole="tab" accessibilityState={{ selected: on }}
                style={{ flex: 1, paddingVertical: 9, borderRadius: radius.sm, alignItems: 'center', backgroundColor: on ? colors.accent : 'transparent' }}>
                <Text style={{ color: on ? '#fff' : colors.muted, fontFamily: fonts.displayBold, fontSize: 14 }}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {shown === 'me' && <StatsPanel stats={player.stats} trust={player.trust} days={player.days} credit={credit} />}

      {shown === 'friends' && (
        <View style={{ marginTop: 8 }} onLayout={(e) => { friendsY.current = e.nativeEvent.layout.y; }}>
          {ref?.code && (
            <Card glow style={{ padding: 14, marginBottom: 14 }}>
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
          <View onLayout={(e) => { friendsCardY.current = e.nativeEvent.layout.y; }}>
            {/* searching: bring the search box to the top so its results show above the keyboard */}
            <FriendsCard onSearchFocus={() => setTimeout(() => scroll.current?.scrollTo({ y: friendsY.current + friendsCardY.current - 8, animated: true }), 250)} />
          </View>
        </View>
      )}

      {shown === 'account' && (
        <View style={{ marginTop: 8 }}>
          {/* each row opens right here; only one is open at a time */}
          <View style={[card, { paddingVertical: 2, paddingHorizontal: 14 }]}>
            <Row icon="user" title="My details" value={me.phone || 'Add your mobile'} open={open === 'details'} onPress={() => toggle('details')}>
              {!editing ? (
                <>
                  <Detail label="Full name" value={me.full_name} />
                  <Detail label="Username" value={me.username ? `@${me.username}` : ''} />
                  <Detail label="Mobile number" value={me.phone} />
                  <Detail label="Gender" value={savedGender ? savedGender[0].toUpperCase() + savedGender.slice(1) : ''} last />
                  <View style={{ marginTop: 6 }}><Button small title="Edit my details" onPress={() => setEditing(true)} /></View>
                </>
              ) : (
                <>
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
                </>
              )}
            </Row>
            {me.email && (
              <Row icon="info" title="Email" value={me.email} open={open === 'email'} onPress={() => toggle('email')} last={googleOnly && !(credit !== null && ledger.length > 0)}>
                <ChangeEmail current={me.email} bare />
              </Row>
            )}
            {!googleOnly && (
              <Row icon="lock" title="Password" value="Change your password" open={open === 'password'} onPress={() => toggle('password')} last={!(credit !== null && ledger.length > 0)}>
                <LoginSecurity bare />
              </Row>
            )}
            {credit !== null && ledger.length > 0 && (
              <Row icon="wallet" title="Credit" value={egp(credit)} open={open === 'credit'} onPress={() => toggle('credit')} last>
                <Text style={{ color: colors.muted, fontSize: 12 }}>Taken off your next booking automatically.</Text>
                {ledger.map((r) => (
                  <View key={r.id} style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.text }}>{KIND[r.kind] ?? r.kind}</Text>
                      <Text style={{ color: colors.muted, fontSize: 12 }}>{dateLabel(r.created_at)}{r.booking?.court?.name ? ` · ${r.booking.court.name}` : ''}</Text>
                    </View>
                    <Text style={{ color: Number(r.amount) > 0 ? colors.success : colors.muted, fontWeight: '700' }}>{Number(r.amount) > 0 ? '+' : '−'} {egp(Math.abs(Number(r.amount)))}</Text>
                  </View>
                ))}
              </Row>
            )}
          </View>

          <ThemePicker />
          <Button title="Log out" onPress={logOut} />
          {isPlayer ? <DeleteAccount beside={logOutAll} /> : <View style={{ marginTop: 18, alignItems: 'center' }}>{logOutAll}</View>}
          <LegalLinks style={{ marginTop: 14 }} />
        </View>
      )}
    </ScrollView>
  );
}

// One line in the Account tab; tapping it opens its section underneath, in place.
function Row({ icon, title, value, open, onPress, last, children }: { icon: IconName; title: string; value?: string; open: boolean; onPress: () => void; last?: boolean; children: ReactNode }) {
  useTheme();
  return (
    <View style={{ borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.border }}>
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ expanded: open }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 11 }}>
        <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: colors.cardAlt, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} color={colors.primary} size={16} />
        </View>
        <Text style={{ color: colors.text, fontFamily: fonts.bodySemi, fontSize: 15 }}>{title}</Text>
        <Text style={{ flex: 1, color: colors.muted, fontSize: 12, textAlign: 'right' }} numberOfLines={1}>{value}</Text>
        <Text style={{ color: colors.muted, fontSize: 16, transform: [{ rotate: open ? '90deg' : '0deg' }] }}>›</Text>
      </Pressable>
      {open && <View style={{ paddingBottom: 12 }}>{children}</View>}
    </View>
  );
}

// Logged out: an empty ring breathing around the logo, above the login form.
function LoggedOutHero() {
  useTheme();
  return (
    <View style={{ alignItems: 'center', marginBottom: 14 }}>
      <ProgressRing progress={0} breathe size={104} stroke={8}>
        <Logo width={60} />
      </ProgressRing>
      <Text style={{ color: colors.tabOn, fontFamily: fonts.display, fontSize: 22, marginTop: 10 }}>Play. Compete. Connect.</Text>
      <Text style={{ color: colors.muted, textAlign: 'center', marginTop: 2 }}>Keep a streak and earn badges.</Text>
    </View>
  );
}

function Detail({ label, value, last }: { label: string; value?: string | null; last?: boolean }) {
  useTheme();
  return (
    <View style={{ paddingVertical: 8, borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.border }}>
      <Text style={{ color: colors.muted, fontSize: 12 }}>{label}</Text>
      <Text style={{ color: value ? colors.text : colors.muted, fontSize: 15, fontWeight: '600', marginTop: 1 }}>{value || 'Not added yet'}</Text>
    </View>
  );
}
