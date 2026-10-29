import { useCallback, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { Text } from '@/components/AppText';
import { useFocusEffect, useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { capitalizeWords, ENGLISH_HELP, isEnglishText } from '@/lib/validate';
import { cleanOwnerInstapay, isOwnerInstapay } from '@/lib/payment';
import { searchMatches } from '@/lib/courtTimes';
import { useRequestId } from '@/lib/requestId';
import { useT } from '@/lib/ownerLang';
import { colors, radius } from '@/lib/theme';
import { Badge, Box, H2, LinkButton, Loading, Muted, Pager, PAGE_SIZE, useOwner } from '@/components/owner';
import { AreaPicker, PlanBox } from '@/components/ownerCourts';
import { Button, Field, Note } from '@/components/ui';

type Branch = {
  id: string; name: string; city: string; address: string; latitude: number | null; longitude: number | null; is_approved: boolean;
  courts: { id: string; name: string; is_approved: boolean; is_active: boolean }[];
};

// Branches and their courts, like the website's Courts section. A frozen owner only sees the plans.
export default function OwnerCourts() {
  const router = useRouter();
  const { access } = useOwner();
  const { t } = useT();
  const req = useRequestId();
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [address, setAddress] = useState('');
  const [instapay, setInstapay] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [doneMsg, setDoneMsg] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const canManage = !!access.manage_branches;

  const load = useCallback(async () => {
    const { data } = await supabase.from('facilities')
      .select('id, name, city, address, latitude, longitude, is_approved, is_active, courts ( id, name, is_approved, is_active )')
      .eq('owner_id', access.owner_id ?? access.user_id).eq('is_active', true).order('created_at', { ascending: false });
    // employees only see the branches they were given
    setBranches(((data as Branch[]) || []).filter((b) => access.is_owner || access.all_branches || (access.branch_ids || []).includes(b.id)));
  }, [access]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function addBranch() {
    setErrorMsg('');
    if (!name || !city || !address) return setErrorMsg(t('Please fill in all fields.'));
    if (!isEnglishText(name) || !isEnglishText(address)) return setErrorMsg(`${t('Branch name and address:')} ${t(ENGLISH_HELP)}`);
    if (!isOwnerInstapay(instapay)) return setErrorMsg(t('InstaPay: an 11-digit mobile number (01xxxxxxxxx) or your InstaPay link (https://...).'));
    setSaving(true);
    const { error } = await supabase.rpc('owner_add_branch', {
      p_request_id: req.get(), p_name: capitalizeWords(name), p_city: city, p_address: capitalizeWords(address), p_instapay: instapay.trim(),
    });
    setSaving(false);
    if (error) return setErrorMsg(error.message);
    req.done();
    setName(''); setCity(''); setAddress(''); setInstapay('');
    setAdding(false);
    load();
  }

  // removing a branch hides it and its courts for good; past bookings and money stay in the records
  function removeBranch(b: Branch) {
    Alert.alert(t('Remove branch'), t("Remove {name}? It and its {n} court(s) are hidden from players and leave this list. Past bookings and money stay in your records. This can't be undone here.", { name: b.name, n: b.courts.length }), [
      { text: t('Cancel'), style: 'cancel' },
      {
        text: t('Remove branch'), style: 'destructive', onPress: async () => {
          setErrorMsg('');
          const { error } = await supabase.rpc('owner_remove_branch', { p_facility_id: b.id });
          if (error) return setErrorMsg(error.message);
          setDoneMsg(`🗑️ ${t('{name} was removed.', { name: b.name })}`);
          load();
        },
      },
    ]);
  }

  if (!branches) return <Loading />;

  // frozen, or a team member without "Manage branches": the plans only
  if (!canManage) {
    return (
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <H2>{t('Plans')}</H2>
        <PlanBox facilityIds={branches.map((b) => b.id)} />
      </ScrollView>
    );
  }

  const found = branches.filter((b) => searchMatches(search, [b.name, b.city, b.address, ...b.courts.map((c) => c.name)].join(' ')));
  const shown = found.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <H2>{access.is_owner ? t('My branches') : t('Branches')}</H2>
        {access.is_owner && <LinkButton title={adding ? t('Cancel') : t('+ Add Branch')} onPress={() => setAdding(!adding)} />}
      </View>

      {adding && access.is_owner && (
        <Box>
          <Text style={{ color: colors.text, fontWeight: '800', marginBottom: 8 }}>{t('New Branch')}</Text>
          <Field label={t('Branch Name')} value={name} onChangeText={setName} placeholder={t('e.g. Zaf Sports Center - Nasr City')} />
          <AreaPicker value={city} onChange={setCity} />
          <Field label={t('Address')} value={address} onChangeText={setAddress} />
          <Field label={t("InstaPay for this branch's earnings")} value={instapay} autoCapitalize="none" autoCorrect={false}
            onChangeText={(v) => setInstapay(cleanOwnerInstapay(v))} placeholder="01xxxxxxxxx or https://ipn.eg/..." />
          {!!errorMsg && <Note kind="error">{errorMsg}</Note>}
          <Button title={saving ? t('Saving...') : t('Create Branch')} onPress={addBranch} loading={saving} />
        </Box>
      )}
      {!!errorMsg && !adding && <Note kind="error">{errorMsg}</Note>}
      {!!doneMsg && <Note kind="ok">{doneMsg}</Note>}

      {branches.length === 0 ? (
        <Muted>{t('You don\'t have any branches yet. Click "+ Add Branch" to create your first one.')}</Muted>
      ) : (
        <>
          <Field label={t('Search branches or courts')} value={search} onChangeText={(v) => { setSearch(v); setPage(1); }} />
          {shown.map((b) => (
            <View key={b.id} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: 14, marginBottom: 12, backgroundColor: colors.card }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16, flex: 1 }}>{b.name}</Text>
                <Badge tone={b.is_approved ? 'ok' : 'warn'} text={b.is_approved ? t('Approved') : t('Pending Approval')} />
              </View>
              <Muted>{b.address}, {b.city}</Muted>
              {(b.latitude === null || b.longitude === null) && (
                <Text style={{ color: colors.warning, fontSize: 12, marginTop: 4 }}>📍 {t("No map pin yet — players can't find this branch with Near me.")}</Text>
              )}
              {b.courts.length > 0 ? b.courts.slice(0, 10).map((c) => (
                <Text key={c.id} style={{ color: colors.text, fontSize: 13, marginTop: 2 }}>
                  • {c.name}
                  {!c.is_approved && <Text style={{ color: colors.warning, fontSize: 12 }}> ({t('waiting for approval')})</Text>}
                  {c.is_approved && !c.is_active && <Text style={{ color: colors.muted, fontSize: 12 }}> ({t('hidden')})</Text>}
                </Text>
              )) : <Muted style={{ fontSize: 12, marginTop: 4 }}>{t('No courts yet')}</Muted>}
              {b.courts.length > 10 && <Muted style={{ fontSize: 12 }}>{t('+ {n} more — see all', { n: b.courts.length - 10 })}</Muted>}
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                <View style={{ flex: 1 }}><Button small title={t('+ Add court')} onPress={() => router.push(`/owner/court-new/${b.id}`)} /></View>
                <View style={{ flex: 1 }}><Button small variant="ghost" title={t('Edit branch & courts')} onPress={() => router.push(`/owner/branch/${b.id}`)} /></View>
              </View>
              {access.is_owner && <LinkButton danger title={t('Remove branch')} onPress={() => removeBranch(b)} />}
            </View>
          ))}
          <Pager page={page} total={found.length} onChange={setPage} />
        </>
      )}
    </ScrollView>
  );
}
