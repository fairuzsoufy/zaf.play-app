import { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Text } from '@/components/AppText';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { SITE_URL, supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { PERMISSIONS, type Access } from '@/lib/access';
import { cairoToDate, dateTimeText } from '@/lib/format';
import { capitalizeWords, FULL_NAME_HELP, isFullName } from '@/lib/validate';
import { LangSwitch, useT } from '@/lib/ownerLang';
import { colors, radius } from '@/lib/theme';
import { Badge, Box, fmtEGP, Loading, Muted, useOwner } from '@/components/owner';
import { Button, Field, Note } from '@/components/ui';

type Section = { id: string; label: string; short?: string; hint: string; icon: string; allowed: (a: Access) => boolean };

// The website's dashboard sections, each its own screen here
const SECTIONS: Section[] = [
  { id: 'calendar', label: 'Calendar', hint: 'Your day on every court, plus walk-ins', icon: '🕒', allowed: (a) => !!a.view_bookings },
  { id: 'bookings', label: 'Bookings', hint: 'Every booking on your courts', icon: '📅', allowed: (a) => !!a.view_bookings },
  { id: 'money', label: 'Money', hint: 'Bookings and money, busy hours, and what Zaf Play sent you', icon: '📊', allowed: (a) => !!a.view_finances || !!a.view_bookings },
  { id: 'courts', label: 'Courts', hint: 'Branches, courts, prices, hours, photos and plans', icon: '🏢', allowed: (a) => !!a.manage_branches || (a.status === 'frozen' && a.is_owner) },
  { id: 'tournaments', label: 'Tournaments', hint: 'Create and follow tournaments', icon: '🏆', allowed: (a) => !!a.manage_branches || !!a.manage_bookings || !!a.view_tournaments },
  { id: 'blocked', label: 'Blocked players', short: 'Blocked', hint: 'Players you stopped from booking', icon: '⛔', allowed: (a) => !!a.manage_bookings },
  { id: 'team', label: 'Team', hint: 'Add sub-users and choose what they can do', icon: '👥', allowed: (a) => a.role === 'owner' || !!a.co_owner },
];

type TodayBooking = { id: string; start_time: string; player: { full_name: string } | null; court: { name: string } | null };

const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 1000) / 10}%` : '');
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// The owner dashboard, like the website's /owner/dashboard: who you are, today's games, this month's money,
// and a tile for each section this person may open.
export default function OwnerDashboard() {
  const router = useRouter();
  const { access, reload } = useOwner();
  const { t, locale, lang } = useT();
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [branches, setBranches] = useState<{ id: string; name: string; is_approved: boolean }[]>([]);
  const [month, setMonth] = useState({ bookings: 0, gross: 0, commission: 0, net: 0 });
  const [today, setToday] = useState<{ total: number; next: TodayBooking | null } | null>(null);
  const [help, setHelp] = useState(false);

  const load = useCallback(async () => {
    const a = access;
    if (a.status === 'suspended' || a.status === 'removed' || a.status === 'pending' || a.status === 'rejected') return setLoaded(true);
    const jobs: Promise<unknown>[] = [];
    if (a.manage_branches || (a.status === 'frozen' && a.is_owner)) {
      jobs.push((async () => {
        const { data } = await supabase.from('facilities').select('id, name, is_approved').eq('owner_id', a.owner_id || '').eq('is_active', true).order('created_at');
        setBranches(((data as any[]) || []).filter((b) => a.is_owner || a.all_branches || (a.branch_ids || []).includes(b.id)));
      })());
    }
    if (a.view_bookings) {
      jobs.push((async () => {
        const day = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
        const { data } = await supabase
          .from('bookings')
          .select('id, start_time, player:users!bookings_user_id_fkey ( full_name ), court:courts ( name )')
          .eq('booking_source', 'player')
          .in('status', ['pending', 'confirmed', 'completed'])
          .gte('start_time', cairoToDate(day, 0).toISOString())
          .lt('start_time', cairoToDate(day, 24 * 60).toISOString())
          .order('start_time');
        const list = (data || []) as unknown as TodayBooking[];
        setToday({ total: list.length, next: list.find((b) => new Date(b.start_time).getTime() > Date.now()) || null });
      })());
    }
    if (a.view_finances) {
      jobs.push((async () => {
        const now = new Date();
        const { data } = await supabase.rpc('owner_revenue', {
          p_from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)),
          p_to: ymd(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
          p_group: 'month',
        });
        const r = ((data as any[]) || [])[0];
        setMonth({ bookings: Number(r?.bookings || 0), gross: Number(r?.gross || 0), commission: Number(r?.commission || 0), net: Number(r?.owner_net || 0) });
      })());
    }
    await Promise.all(jobs);
    setLoaded(true);
  }, [access]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function refresh() {
    setRefreshing(true);
    await reload();
    await load();
    setRefreshing(false);
  }

  if (!loaded) return <Loading />;

  if (access.status === 'pending') {
    return (
      <ScrollView contentContainerStyle={{ padding: 20, alignItems: 'stretch' }}>
        <Text style={{ fontSize: 44, textAlign: 'center' }}>⏳</Text>
        <View style={{ alignItems: 'center', marginVertical: 12 }}><LangSwitch /></View>
        <Text style={{ color: colors.text, fontSize: 22, fontWeight: '800', textAlign: 'center', marginBottom: 8 }}>{t('Waiting for approval')}</Text>
        <Muted style={{ textAlign: 'center' }}>
          {t('Thanks for joining Zaf Play, {name}! Our team is reviewing your account. Once we approve it, you can add your courts, prices and working hours here.', { name: access.full_name })}
        </Muted>
        <Muted style={{ textAlign: 'center', marginTop: 12 }}>
          {t("This usually takes less than a day. We'll email you as soon as your account is approved or declined. Questions? Email us at")} support@zafplay.com.
        </Muted>
        {access.role === 'owner' && <SignupCoOwner />}
      </ScrollView>
    );
  }

  if (access.status === 'rejected') return <OwnerNotApproved reason={access.reject_reason} onSent={reload} />;

  if (access.status === 'suspended' || access.status === 'removed') {
    return (
      <View style={{ padding: 24, alignItems: 'center' }}>
        <Text style={{ color: colors.text, fontSize: 22, fontWeight: '800', marginBottom: 8 }}>{t('Access paused')}</Text>
        <Badge tone="bad" text={access.status === 'suspended' ? t('Suspended') : t('Removed')} />
        <Muted style={{ textAlign: 'center', marginTop: 10 }}>
          {access.status === 'suspended'
            ? t('{name} or Zaf Play has suspended your access. Please contact them if you think this is a mistake.', { name: access.owner_name || t('Your manager') })
            : t('You are no longer part of a team on Zaf Play.')}
        </Muted>
      </View>
    );
  }

  const sections = SECTIONS.filter((s) => s.allowed(access));
  const frozen = access.status === 'frozen';
  const pendingBranches = frozen ? [] : branches.filter((b) => !b.is_approved);
  const monthName = new Date().toLocaleString(locale, { timeZone: 'Africa/Cairo', month: 'long' });
  const open = (id: string) => router.push(`/owner/${id}` as Href);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
        <Text style={{ color: colors.text, fontSize: 22, fontWeight: '800', flex: 1 }}>{t('Welcome, {name}', { name: access.full_name })}</Text>
        <LangSwitch />
      </View>
      <View style={{ flexDirection: 'row', gap: 6, marginBottom: 6 }}>
        <Badge tone="info" text={access.role === 'owner' ? t('Owner') : access.co_owner ? t('Co-owner') : t('Sub-user')} />
        <Badge tone={frozen ? 'bad' : access.status === 'invited' ? 'warn' : 'ok'} text={frozen ? t('Frozen') : access.status === 'invited' ? t('Invited') : t('Active')} />
      </View>
      <Muted style={{ marginBottom: 16 }}>
        {access.role === 'owner'
          ? t('Here is how your courts are doing.')
          : access.co_owner
            ? t('Co-owner with {name}. Same access as the owner, and you manage the sub-users.', { name: access.owner_name || '' })
            : `${t('Sub-user of {name}', { name: access.owner_name || '' })}${access.job_title ? ` · ${access.job_title}` : ''}${access.all_branches ? '' : ` · ${t('selected branches')}`}`}
      </Muted>

      {frozen && (
        <Box tone="bad">
          <Text style={{ color: colors.danger, fontWeight: '700' }}>❄️ {t('Zaf Play has frozen this account')}</Text>
          <Text style={{ color: colors.text, marginTop: 6 }}>
            {t('Your branches are hidden from players and changes are paused. You can still see your bookings, money and plans, and bookings already made stay as they are.')}
          </Text>
          {!!access.reject_reason && <Text style={{ color: colors.text, marginTop: 6 }}>{t('Reason:')} {access.reject_reason}</Text>}
          {access.role === 'owner' ? <FreezeAppeal /> : <Muted style={{ marginTop: 6 }}>{t('The account owner can appeal this from their dashboard.')}</Muted>}
        </Box>
      )}

      {access.status === 'invited' && (
        <Box tone="warn">
          <Text style={{ color: colors.noteText }}>
            {t("You haven't set a password yet.")}{' '}
            <Text style={{ textDecorationLine: 'underline', fontWeight: '700' }} onPress={() => Linking.openURL(`${SITE_URL}/accept-invite`)}>{t('Set your password')}</Text>{' '}
            {t('so you can log in again later.')}
          </Text>
        </Box>
      )}

      {access.is_owner && <TransferNotifications onView={() => open('money')} />}

      {pendingBranches.length > 0 && (
        <Box tone="warn">
          <Text style={{ color: colors.noteText }}>
            <Text style={{ fontWeight: '800' }}>{t('Waiting for approval:')}</Text> {pendingBranches.map((b) => b.name).join(lang === 'ar' ? '، ' : ', ')}.{' '}
            {t("Players can't see these branches until the Zaf Play team approves them. You can already add courts and working hours in the meantime.")}
          </Text>
        </Box>
      )}

      {today && (
        <Pressable onPress={() => open('bookings')} accessibilityRole="button">
          <Box>
            <Muted>📅 {t('Today')}</Muted>
            <Text style={{ color: colors.text, fontSize: 28, fontWeight: '800', marginTop: 2 }}>
              {today.total} <Text style={{ fontSize: 15, color: colors.muted, fontWeight: '600' }}>{today.total === 1 ? t('booking') : t('bookings')}</Text>
            </Text>
            <Muted>
              {today.next
                ? `${t('Next:')} ${new Date(today.next.start_time).toLocaleTimeString(locale, { timeZone: 'Africa/Cairo', hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase()} · ${today.next.court?.name || ''}${today.next.player?.full_name ? ` · ${today.next.player.full_name}` : ''}`
                : today.total > 0 ? t("All of today's games are done.") : t('No games booked today yet.')}
            </Muted>
          </Box>
        </Pressable>
      )}

      {access.view_finances && (
        <Box>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <Muted>💰 {t('{month} so far (played)', { month: monthName })}</Muted>
            <Muted>{t(month.bookings === 1 ? '{n} played booking' : '{n} played bookings', { n: month.bookings })}</Muted>
          </View>
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 10 }}>
            <Stat label={t('Players paid')} value={fmtEGP(month.gross)} />
            <Stat label={`${t('Zaf Play share')}${month.gross > 0 ? ` (${pct(month.commission, month.gross)})` : ''}`} value={fmtEGP(month.commission)} />
            <Stat label={access.is_owner ? t('Yours') : t("Owner's")} value={fmtEGP(month.net)} good />
          </View>
          {month.gross > 0 && (
            <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.border, overflow: 'hidden', flexDirection: 'row', marginTop: 10 }}>
              <View style={{ backgroundColor: colors.success, width: `${(month.net / month.gross) * 100}%` }} />
              <View style={{ backgroundColor: colors.brandBlue, width: `${(month.commission / month.gross) * 100}%` }} />
            </View>
          )}
          <Text style={{ color: colors.primaryAlt, marginTop: 10, fontWeight: '600' }} onPress={() => open('money')}>{t('See each transfer from Zaf Play →')}</Text>
        </Box>
      )}

      {sections.length === 0 ? (
        <Muted>{t("You don't have any permissions yet. Ask {name} to give you access.", { name: access.owner_name || '' })}</Muted>
      ) : (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4, marginTop: 4 }}>
            {sections.map((s) => (
              <Tile key={s.id} icon={s.icon} label={lang === 'ar' ? t(s.label) : s.short ?? s.label} hint={t(s.hint)} onPress={() => open(s.id)} />
            ))}
            {(access.role === 'owner' || access.co_owner) && (
              <Tile icon="🛡️" label={t('Agreement')} hint={t('Your terms, settlements and share with Zaf Play')} onPress={() => open('agreement')} />
            )}
          </View>

          <Pressable onPress={() => setHelp(!help)} style={{ marginTop: 10 }} accessibilityRole="button" accessibilityState={{ expanded: help }}>
            <Text style={{ color: colors.text, fontWeight: '700' }}>ⓘ {t('How this dashboard works')} {help ? '▴' : '▾'}</Text>
          </Pressable>
          {help && <DashboardHelp access={access} sections={sections} />}
        </>
      )}
    </ScrollView>
  );
}

function Stat({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <View style={{ flex: 1, borderRadius: radius.md, padding: 8, backgroundColor: good ? 'rgba(46,211,160,0.1)' : colors.cardAlt, borderWidth: good ? 1 : 0, borderColor: colors.success }}>
      <Text style={{ color: good ? colors.success : colors.muted, fontSize: 11, textAlign: 'center' }}>{label}</Text>
      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14, textAlign: 'center', marginTop: 2 }}>{value}</Text>
    </View>
  );
}

function Tile({ icon, label, hint, onPress }: { icon: string; label: string; hint: string; onPress: () => void }) {
  return (
    <View style={{ width: '50%', padding: 4 }}>
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityHint={hint}
        style={({ pressed }) => ({ backgroundColor: pressed ? colors.soft : colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: radius.lg, padding: 14, minHeight: 96 })}>
        <Text style={{ fontSize: 24 }}>{icon}</Text>
        <Text style={{ color: colors.text, fontWeight: '800', marginTop: 6 }}>{label}</Text>
        <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }} numberOfLines={2}>{hint}</Text>
      </Pressable>
    </View>
  );
}

function DashboardHelp({ access, sections }: { access: Access; sections: Section[] }) {
  const { t, lang } = useT();
  const canTeam = access.role === 'owner' || !!access.co_owner;
  const line = { color: colors.text, fontSize: 13, lineHeight: 19, marginBottom: 4 };
  const b = { fontWeight: '800' as const };
  return (
    <Box style={{ marginTop: 8 }}>
      {sections.map((x) => (
        <Text key={x.id} style={line}>
          <Text style={b}>{t(x.label)}:</Text> {lang === 'ar' ? t(x.hint) : x.hint.charAt(0).toLowerCase() + x.hint.slice(1)}.
          {x.id === 'courts' ? ` ${t('Zaf Play approves new courts and changes before players see them.')}` : ''}
        </Text>
      ))}
      {access.view_finances && (
        <Text style={[line, { marginTop: 6 }]}>
          <Text style={b}>{t('Money')}:</Text>{' '}
          {t('players pay Zaf Play when they book. Zaf Play keeps its share (the percentage of your court plan) and transfers the rest to your InstaPay account. Every transfer, with the bookings it covers, is under Money, Transfers.')}
        </Text>
      )}
      <Text style={[line, b, { marginTop: 8 }]}>{t('Who can do what')}</Text>
      <Text style={line}><Text style={b}>{t('Owner')}:</Text> {t('everything, including payouts, plans and adding or removing co-owners.')}</Text>
      <Text style={line}><Text style={b}>{t('Co-owner')}:</Text> {t('the same as the owner, and manages sub-users. Payouts go to the owner only.')}</Text>
      <Text style={line}><Text style={b}>{t('Sub-user')}:</Text> {t('only the access the owner or a co-owner gives them, on all branches or chosen ones.')}</Text>
      {canTeam && (
        <>
          <Text style={[line, b, { marginTop: 8 }]}>{t('Adding a sub-user')}</Text>
          <Text style={line}>{t('Open')} {t('Team')}, {t('add their email, pick their branches and tick what they may do:')}</Text>
          {PERMISSIONS.map((p) => <Text key={p.key} style={line}>•  <Text style={b}>{t(p.label)}:</Text> {t(p.help)}</Text>)}
        </>
      )}
    </Box>
  );
}

const PAYOUT_FIELDS = 'id, payout_date, total_owed_to_owner, amount_sent, payment_method, bank_reference';

// Green banner when Zaf Play has sent new transfers
function TransferNotifications({ onView }: { onView: () => void }) {
  const { t, locale } = useT();
  const [unseen, setUnseen] = useState<any[]>([]);
  useEffect(() => {
    supabase.from('payouts').select(PAYOUT_FIELDS).eq('direction', 'to_owner').is('seen_by_owner_at', null).order('paid_at', { ascending: false })
      .then(({ data }) => setUnseen((data as any[]) || []));
  }, []);
  if (unseen.length === 0) return null;
  const day = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(locale, { timeZone: 'Africa/Cairo', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  return (
    <Box tone="ok">
      <Text style={{ color: colors.success, fontWeight: '800' }}>
        💸 {unseen.length === 1 ? t('New transfer from Zaf Play') : t('{n} new transfers from Zaf Play', { n: unseen.length })}
      </Text>
      {unseen.slice(0, 5).map((p) => (
        <Text key={p.id} style={{ color: colors.text, fontSize: 13, marginTop: 3 }}>
          {t('{amount} for {day} via {method}', { amount: fmtEGP(p.amount_sent ?? p.total_owed_to_owner), day: day(p.payout_date), method: p.payment_method })}
          {p.bank_reference ? ` (${t('Ref')} ${p.bank_reference})` : ''}
        </Text>
      ))}
      {unseen.length > 5 && <Muted>{t('…and {n} more.', { n: unseen.length - 5 })}</Muted>}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
        <View style={{ flex: 1 }}><Button small title={t('View transfers')} onPress={onView} /></View>
        <View style={{ flex: 1 }}><Button small variant="ghost" title={t('Got it')} onPress={async () => { await supabase.rpc('mark_payouts_seen'); setUnseen([]); }} /></View>
      </View>
    </Box>
  );
}

type Step = { kind: 'frozen' | 'appealed' | 'appeal_declined'; note: string | null; created_at: string };

// A frozen owner appeals here. Zaf Play unfreezes them or declines with a note; the answer also arrives by email.
function FreezeAppeal() {
  const { session } = useAuth();
  const [last, setLast] = useState<Step | null | undefined>(undefined);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    const { data } = await supabase.from('owner_reviews').select('kind, note, created_at').eq('owner_id', session?.user.id || '')
      .in('kind', ['frozen', 'appealed', 'appeal_declined']).order('created_at', { ascending: false }).limit(1);
    setLast(((data as Step[]) || [])[0] || null);
  }, [session?.user.id]);
  useEffect(() => { load(); }, [load]);

  async function send() {
    const message = text.trim();
    if (message.length < 10) return setErr('Please tell us why in a few words (at least 10 characters).');
    setBusy(true);
    setErr('');
    const { error } = await supabase.rpc('owner_appeal_freeze', { p_note: message });
    setBusy(false);
    if (error) return setErr(error.message);
    setText('');
    load();
  }

  if (last === undefined) return null;
  if (last?.kind === 'appealed')
    return (
      <Box tone="warn" style={{ marginTop: 10, marginBottom: 0 }}>
        <Text style={{ color: colors.noteText, fontWeight: '700' }}>Appeal sent {dateTimeText(last.created_at)}</Text>
        {!!last.note && <Text style={{ color: colors.noteText, marginTop: 4 }}>{last.note}</Text>}
        <Text style={{ color: colors.noteText, marginTop: 6 }}>
          Waiting for Zaf Play to reply. If your appeal is approved, your account is active again. If it is declined, it stays frozen. We will email you either way.
        </Text>
      </Box>
    );
  return (
    <View style={{ marginTop: 10 }}>
      {last?.kind === 'appeal_declined' && (
        <Text style={{ color: colors.text, marginBottom: 8 }}>
          <Text style={{ fontWeight: '800' }}>Your last appeal was declined.</Text>{last.note ? ` Note from Zaf Play: ${last.note}` : ''} You can appeal again if something has changed.
        </Text>
      )}
      <Field label="Think this is a mistake? Appeal (required)" value={text} onChangeText={setText} multiline maxLength={1000}
        placeholder="Tell us why the freeze should be lifted, in your own words." style={{ minHeight: 90, textAlignVertical: 'top' }} />
      <Muted style={{ marginTop: -8, marginBottom: 10 }}>{text.trim().length}/1000 · The Zaf Play team reviews every appeal and emails you the answer.</Muted>
      {!!err && <Note kind="error">{err}</Note>}
      <Button small title="Send appeal" onPress={send} loading={busy} />
    </View>
  );
}

// Shown to an owner whose account wasn't approved: the reason, and a way to ask for another review.
function OwnerNotApproved({ reason, onSent }: { reason?: string | null; onSent: () => void }) {
  const { t } = useT();
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const shown = reason ? reason.charAt(0).toUpperCase() + reason.slice(1) : '';

  async function send() {
    setError('');
    if (note.trim().length < 10) return setError(t('Please tell us in a sentence what has changed.'));
    setSending(true);
    const { error: e } = await supabase.rpc('owner_request_review', { p_note: note.trim() });
    setSending(false);
    if (e) return setError(e.message);
    onSent();
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
      <View style={{ alignItems: 'center', marginBottom: 12 }}><LangSwitch /></View>
      <Text style={{ color: colors.text, fontSize: 22, fontWeight: '800', textAlign: 'center', marginBottom: 10 }}>{t("We couldn't approve your account yet")}</Text>
      <Muted style={{ textAlign: 'center' }}>
        {t("Thank you for wanting to bring your courts to Zaf Play. We looked at your details carefully, and we weren't able to approve your owner account this time.")}
      </Muted>
      {!!shown && <Box style={{ marginTop: 14 }}><Text style={{ color: colors.text }}><Text style={{ fontWeight: '800' }}>{t('Reason:')}</Text> {shown}</Text></Box>}
      <Muted style={{ textAlign: 'center', marginTop: 10, marginBottom: 14 }}>
        {t("This doesn't have to be the end. Tell us what changed, or what we may have missed, and we'll take another look, usually within a day.")}
      </Muted>
      <Field label={t('What has changed?')} value={note} onChangeText={setNote} multiline maxLength={500} style={{ minHeight: 80, textAlignVertical: 'top' }}
        placeholder={t("e.g. I updated my business name and added my facility's Instagram page.")} />
      {!!error && <Note kind="error">{error}</Note>}
      <Button title={sending ? t('Sending...') : t('Ask for another review')} onPress={send} loading={sending} />
      <Muted style={{ textAlign: 'center', marginTop: 16 }}>{t('You can also email us at')} support@zafplay.com {t('or message us on Instagram')} @zafplay.</Muted>
      <SignupCoOwner />
    </ScrollView>
  );
}

// While an owner waits for approval, the co-owner typed at sign-up can still be fixed or removed.
// Their invite email only goes out once Zaf Play approves the owner.
function SignupCoOwner() {
  const [saved, setSaved] = useState<{ name: string; email: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    supabase.rpc('my_signup_co_owner').then(({ data }) => {
      const c = (data as { name: string; email: string } | null) || { name: '', email: '' };
      setSaved(c);
      setName(c.name);
      setEmail(c.email);
    });
  }, []);

  async function save(remove = false) {
    setMsg('');
    const n = remove ? '' : capitalizeWords(name);
    const m = remove ? '' : email.trim().toLowerCase();
    if (!remove) {
      if (!isFullName(n)) return setMsg(`❌ ${FULL_NAME_HELP}`);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m)) return setMsg('❌ Please enter a valid email address.');
    }
    setBusy(true);
    if (!remove) {
      const { data } = await supabase.functions.invoke('check-email', { body: { email: m } }).catch(() => ({ data: null }));
      if (data && !data.ok) {
        setBusy(false);
        return setMsg(`❌ ${data.reason || 'Please check your email address.'}`);
      }
    }
    const { error } = await supabase.rpc('owner_set_signup_co_owner', { p_name: n, p_email: m });
    setBusy(false);
    if (error) return setMsg(`❌ ${error.message}`);
    setSaved({ name: n, email: m });
    setEditing(false);
    setMsg(remove ? 'Co-owner removed.' : `✅ Saved. ${n} gets the invite at ${m} once we approve you.`);
  }

  if (!saved) return null;
  return (
    <Box style={{ marginTop: 20 }}>
      <Text style={{ color: colors.text, fontWeight: '800' }}>Co-owner</Text>
      {!editing ? (
        <>
          <Text style={{ color: colors.text, marginTop: 4 }}>{saved.email ? `${saved.name} · ${saved.email}` : 'None added.'}</Text>
          {!!saved.email && <Muted>They get their sign-up email once we approve you.</Muted>}
          <View style={{ flexDirection: 'row', gap: 18, marginTop: 10 }}>
            <Text style={{ color: colors.primaryAlt, fontWeight: '700' }} onPress={() => setEditing(true)}>{saved.email ? 'Change' : 'Add a co-owner'}</Text>
            {!!saved.email && <Text style={{ color: colors.danger, fontWeight: '700' }} onPress={() => !busy && save(true)}>Remove</Text>}
          </View>
        </>
      ) : (
        <View style={{ marginTop: 10 }}>
          <Field label="Co-owner's full name" value={name} onChangeText={setName} />
          <Field label="Co-owner's email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}><Button small title="Save" onPress={() => save()} loading={busy} /></View>
            <View style={{ flex: 1 }}><Button small variant="ghost" title="Cancel" onPress={() => { setEditing(false); setName(saved.name); setEmail(saved.email); setMsg(''); }} /></View>
          </View>
        </View>
      )}
      {!!msg && <Text style={{ color: colors.text, marginTop: 10 }}>{msg}</Text>}
    </Box>
  );
}
