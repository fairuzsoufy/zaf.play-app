import { useCallback, useEffect, useState } from 'react';
import { Modal, ScrollView, Text } from 'react-native';
import { Stack, usePathname, useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { getMyAccess, type Access } from '@/lib/access';
import { isAgreementSigner, loadLatestAgreement, loadMySignature } from '@/lib/agreement';
import { cleanOwnerInstapay, isOwnerInstapay } from '@/lib/payment';
import { OwnerLangProvider, useT } from '@/lib/ownerLang';
import { colors, fonts } from '@/lib/theme';
import { Box, Loading, Muted, OwnerContext } from '@/components/owner';
import { Button, Field, Note } from '@/components/ui';

// The owner and staff side, like the website's /owner pages: only for owners and their team.
// Owners and co-owners sign the partner agreement first, and add their InstaPay for branches moved to them.
export default function OwnerLayout() {
  return (
    <OwnerLangProvider>
      <OwnerShell />
    </OwnerLangProvider>
  );
}

function OwnerShell() {
  const router = useRouter();
  const pathname = usePathname();
  const { session, loading } = useAuth();
  const { t } = useT();
  const [access, setAccess] = useState<Access | null | undefined>(undefined);

  const reload = useCallback(async () => {
    setAccess(await getMyAccess());
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!session) {
      router.replace('/login');
      return;
    }
    reload();
  }, [loading, session?.user.id]);

  // not an owner or staff: back to the player side
  useEffect(() => {
    if (access === null || (access && access.role !== 'owner' && access.role !== 'staff')) router.replace('/');
  }, [access]);

  // the partner agreement comes first for the owner and co-owners (only once one is published)
  useEffect(() => {
    if (!access || !session || pathname.startsWith('/owner/agreement')) return;
    let cancelled = false;
    (async () => {
      const latest = await loadLatestAgreement();
      if (cancelled || !latest || !isAgreementSigner(access)) return;
      const signed = await loadMySignature(session.user.id, latest.version);
      if (!cancelled && !signed) router.replace('/owner/agreement');
    })();
    return () => { cancelled = true; };
  }, [access, pathname]);

  if (!access || (access.role !== 'owner' && access.role !== 'staff')) return <Loading />;

  const title = (s: string) => ({ title: t(s) });
  return (
    <OwnerContext.Provider value={{ access, reload }}>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.text,
          headerTitleStyle: { fontFamily: fonts.displayBold, fontSize: 19 },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="index" options={title('Dashboard')} />
        <Stack.Screen name="agreement" options={title('Partner agreement')} />
        <Stack.Screen name="calendar" options={title('Calendar')} />
        <Stack.Screen name="bookings" options={title('Bookings')} />
        <Stack.Screen name="money" options={title('Money')} />
        <Stack.Screen name="courts" options={title('Courts')} />
        <Stack.Screen name="tournaments" options={title('Tournaments')} />
        <Stack.Screen name="blocked" options={title('Blocked players')} />
        <Stack.Screen name="team" options={title('Team')} />
      </Stack>
      {!pathname.startsWith('/owner/agreement') && <InstapayGate />}
    </OwnerContext.Provider>
  );
}

type MovedBranch = { id: string; name: string; city: string; old_instapay: string | null };

// After branches move to a new owner, their InstaPay still belongs to the old owner. The new owner (or co-owner)
// enters their own InstaPay for every moved branch before using the dashboard, so no money goes to the wrong person.
function InstapayGate() {
  const [branches, setBranches] = useState<MovedBranch[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.rpc('my_branches_needing_instapay').then(({ data }) => setBranches((data as MovedBranch[] | null) || []));
  }, []);

  async function save() {
    setError('');
    const bad = branches.find((b) => !isOwnerInstapay(values[b.id] || ''));
    if (bad) return setError(`${bad.name}: an 11-digit mobile number (01xxxxxxxxx) or your InstaPay link (https://...).`);
    setBusy(true);
    for (const b of branches) {
      const { error: err } = await supabase.rpc('owner_set_branch_instapay', { p_facility_id: b.id, p_instapay: values[b.id].trim() });
      if (err) {
        setBusy(false);
        return setError(`${b.name}: ${err.message}`);
      }
    }
    setBusy(false);
    setBranches([]);
  }

  if (branches.length === 0) return null;
  return (
    <Modal animationType="slide" presentationStyle="fullScreen">
      <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: 20, paddingTop: 60 }} keyboardShouldPersistTaps="handled">
        <Text style={{ color: colors.text, fontSize: 24, fontWeight: '800' }}>Add your InstaPay</Text>
        <Muted style={{ marginTop: 8, marginBottom: 18 }}>
          These branches are now yours. Their InstaPay still belongs to the previous owner. Please add your own InstaPay for each
          branch, so Zaf Play sends your money to you. You can use the dashboard right after.
        </Muted>
        {branches.map((b) => (
          <Box key={b.id}>
            <Text style={{ color: colors.text, fontWeight: '700' }}>{b.name}</Text>
            <Muted style={{ marginBottom: 10 }}>{b.city}</Muted>
            <Field label={`InstaPay for ${b.name}`} value={values[b.id] || ''} autoCapitalize="none" autoCorrect={false}
              onChangeText={(v) => setValues({ ...values, [b.id]: cleanOwnerInstapay(v) })} placeholder="01xxxxxxxxx or https://ipn.eg/..." />
          </Box>
        ))}
        {!!error && <Note kind="error">{error}</Note>}
        <Button title="Save and open the dashboard" onPress={save} loading={busy} />
      </ScrollView>
    </Modal>
  );
}
