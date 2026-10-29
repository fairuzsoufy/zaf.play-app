import { useCallback, useState } from 'react';
import { Linking, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { Text } from '@/components/AppText';
import { SITE_URL, supabase } from '@/lib/supabase';
import { colors, fonts, radius } from '@/lib/theme';

// The admin home, like the website's admin menu: the inboxes first, each with the number waiting for you.
const SECTIONS = [
  { id: 'payments', label: 'Payment approvals', icon: '💸', hint: 'InstaPay screenshots to check' },
  { id: 'refunds', label: 'Cancellations & Refunds', icon: '↩️', hint: 'Cancel requests and refunds to send' },
  { id: 'games', label: 'Games & Tournaments', icon: '🏆', hint: 'Tournaments, team and game payments' },
  { id: 'approvals', label: 'Courts & Owners', icon: '🏢', hint: 'New owners, branches, courts, photos, changes' },
  { id: 'users', label: 'People', icon: '👥', hint: 'Players, owners, staff and admins' },
  { id: 'blocked', label: 'Blocked players', icon: '⛔', hint: 'Blocks, reasons and appeals' },
  { id: 'bookings', label: 'Bookings', icon: '📅', hint: 'Every booking' },
  { id: 'plans', label: 'Court Plans', icon: '📋', hint: 'Trial and partner plans, requests' },
  { id: 'agreements', label: 'Owner agreements', icon: '✍️', hint: 'Partner agreement versions and signatures' },
  { id: 'catalog', label: 'Sports & Cities', icon: '🗺️', hint: 'Sports, cities and areas' },
  { id: 'settlements', label: 'Owner Settlements', icon: '🏦', hint: 'Transfers to and from owners' },
  { id: 'revenue', label: 'Revenue', icon: '📈', hint: 'Zaf Play earnings' },
  { id: 'expenses', label: 'Expenses', icon: '🧾', hint: 'Costs and spending' },
  { id: 'leads', label: 'Owner leads', icon: '🎯', hint: 'Courts to sign up, follow-ups' },
  { id: 'notes', label: 'Notes', icon: '🗒️', hint: 'Team notes' },
  { id: 'settings', label: 'Settings', icon: '⚙️', hint: 'Fees, shares and switches' },
] as const;

// the screens built so far; the rest are still on zafplay.com/admin
const READY = new Set<string>(['payments', 'refunds', 'approvals', 'games', 'users', 'blocked']);

type Counts = Record<string, number>;

export default function AdminHome() {
  const router = useRouter();
  const [counts, setCounts] = useState<Counts>({});
  const [refreshing, setRefreshing] = useState(false);

  // the same numbers as the website's admin menu
  const load = useCallback(async () => {
    const [settle, balances, ownerPays, pays, reqs, refundsDue, owners, photos, plans, courts, changes, branches, games, extras, leads, transfers, appeals, ownerAppeals] = await Promise.all([
      supabase.rpc('admin_pending_settlements'),
      supabase.rpc('admin_owner_balances'),
      supabase.from('payouts').select('id', { count: 'exact', head: true }).eq('direction', 'to_zaf').eq('status', 'pending'),
      supabase.from('payments').select('id, booking:bookings ( status, cancel_request_status )').eq('status', 'pending'),
      supabase.rpc('admin_cancel_requests'),
      supabase.from('bookings').select('id', { count: 'exact', head: true }).eq('refund_status', 'due').or('cancel_request_status.is.null,cancel_request_status.neq.pending'),
      supabase.rpc('admin_pending_owners'),
      supabase.from('court_photos').select('id, court:courts!inner ( is_approved )').eq('status', 'pending').eq('court.is_approved', true),
      supabase.from('court_plan_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('courts').select('id', { count: 'exact', head: true }).eq('is_approved', false).eq('is_active', true),
      supabase.from('change_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('facilities').select('id', { count: 'exact', head: true }).eq('is_approved', false).eq('is_active', true),
      supabase.rpc('admin_games_queue'),
      supabase.from('court_extras').select('id', { count: 'exact', head: true }).eq('status', 'pending').eq('is_active', true),
      supabase.from('owner_leads').select('id', { count: 'exact', head: true })
        .lte('next_follow_up', new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' })).not('status', 'in', '(signed,not_interested)'),
      supabase.from('ownership_transfers').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('block_appeals').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.rpc('admin_open_owner_appeals'),
    ]);
    const q: any = games.data || {};
    setCounts({
      approvals: ((owners.data as any[]) || []).filter((o) => o.owner_status === 'pending' && o.email_confirmed).length + ((photos.data as any[]) || []).length
        + (courts.count || 0) + (changes.count || 0) + (branches.count || 0) + (extras.count || 0) + (transfers.count || 0) + (Number(ownerAppeals.data) || 0),
      games: (q.tournaments || []).length + (q.team_payments || []).length + (q.game_payments || []).length + (q.refunds || []).length,
      payments: ((pays.data as any[]) || []).filter((p) => p.booking?.cancel_request_status !== 'pending' && p.booking?.status !== 'cancelled').length,
      refunds: ((reqs.data as any[]) || []).length + (refundsDue.count || 0),
      plans: plans.count || 0,
      leads: leads.count || 0,
      blocked: appeals.count || 0,
      settlements: ((settle.data as any[]) || []).length + (ownerPays.count || 0) + ((balances.data as any[]) || []).filter((b) => b.kind === 'owner_owes').length,
    });
  }, []);
  useFocusEffect(useCallback(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]));

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.primary} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <Stack.Screen options={{ title: 'Admin' }} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {SECTIONS.map((s) => {
          const n = counts[s.id] || 0;
          return (
            <Pressable key={s.id} onPress={() => (READY.has(s.id) ? router.push(`/admin/${s.id}` as any) : Linking.openURL(`${SITE_URL}/admin/${s.id === 'payments' ? '' : s.id}`))}
              style={{ width: '48%', backgroundColor: colors.card, borderWidth: 1, borderColor: n ? colors.warning : colors.border, borderRadius: radius.lg, padding: 12, minHeight: 96 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 22 }}>{s.icon}</Text>
                {n > 0 && <Text style={{ backgroundColor: colors.warning, color: '#1a1200', fontWeight: '800', fontSize: 12, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10, overflow: 'hidden' }}>{n}</Text>}
              </View>
              <Text style={{ color: colors.text, fontFamily: fonts.displayBold, fontSize: 15, marginTop: 6 }}>{s.label}</Text>
              <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>{READY.has(s.id) ? s.hint : 'Opens zafplay.com for now'}</Text>
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}
