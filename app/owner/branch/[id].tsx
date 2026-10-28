import { useCallback, useState } from 'react';
import { Alert, Linking, ScrollView, View } from 'react-native';
import { Text } from '@/components/AppText';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { canOnBranch } from '@/lib/access';
import { capitalizeWords, ENGLISH_HELP, isEnglishText } from '@/lib/validate';
import { cleanOwnerInstapay, isOwnerInstapay } from '@/lib/payment';
import { searchMatches } from '@/lib/courtTimes';
import { useT } from '@/lib/ownerLang';
import { colors, radius } from '@/lib/theme';
import { Badge, Box, H2, LinkButton, Loading, Muted, Pager, PAGE_SIZE, useOwner } from '@/components/owner';
import { AreaPicker, BranchLocation, CourtForm, ExtrasManager, PhotosManager, PlanBox, type CourtFormValues, type SportOption } from '@/components/ownerCourts';
import { Button, Field, Note } from '@/components/ui';

type Court = {
  id: string; name: string; is_indoor: boolean; surface_type: string | null; maps_url: string | null; late_fee_percent: number; is_active: boolean; is_approved: boolean;
  court_sports: { price_per_hour: number; sport: { id: string; name: string } | null }[];
};
type Change = { id: string; entity_id: string; status: string; reject_reason: string | null };

// One branch: its details, map pin and courts, and inside each court its plan, photos and extras.
// Like the website's /owner/branches/[id]/courts.
export default function BranchScreen() {
  const { id: facilityId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { access } = useOwner();
  const { t } = useT();
  const [facility, setFacility] = useState<any>(undefined);
  const [courts, setCourts] = useState<Court[]>([]);
  const [sports, setSports] = useState<SportOption[]>([]);
  const [changes, setChanges] = useState<Change[]>([]);
  const [phones, setPhones] = useState<Record<string, string>>({});

  const [editingDetails, setEditingDetails] = useState(false);
  const [editName, setEditName] = useState('');
  const [editCity, setEditCity] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editInstapay, setEditInstapay] = useState('');
  const [detailsSaving, setDetailsSaving] = useState(false);
  const [detailsMsg, setDetailsMsg] = useState('');

  const [editingCourtId, setEditingCourtId] = useState<string | null>(null);
  const [courtMsg, setCourtMsg] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    const { data: f } = await supabase.from('facilities').select('id, name, city, address, instapay_link, owner_id, is_approved, latitude, longitude').eq('id', facilityId).maybeSingle();
    if (!f || !canOnBranch(access, f as any, 'manage_branches')) return setFacility(null);
    setFacility(f);
    const [c, s, ch] = await Promise.all([
      supabase.from('courts').select('id, name, is_indoor, surface_type, maps_url, late_fee_percent, is_active, is_approved, court_sports ( price_per_hour, sport:sports ( id, name, sort_order ) )')
        .eq('facility_id', facilityId).order('created_at', { ascending: true }),
      supabase.from('sports').select('id, name, outdoor_only, indoor_only').eq('is_active', true).order('name', { ascending: true }),
      supabase.from('change_requests').select('id, entity_type, entity_id, status, reject_reason, created_at, reviewed_at').eq('facility_id', facilityId).order('created_at', { ascending: false }).limit(50),
    ]);
    const list = (c.data as any as Court[]) || [];
    setCourts(list);
    setSports((s.data as SportOption[]) || []);
    setChanges((ch.data as Change[]) || []);
    if (list.length) {
      const { data: p } = await supabase.from('court_contacts').select('court_id, phone').in('court_id', list.map((x) => x.id));
      setPhones(Object.fromEntries(((p as any[]) || []).map((r) => [r.court_id, r.phone])));
    }
  }, [facilityId, access]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  function startEditingDetails() {
    setEditName(facility?.name || '');
    setEditCity(facility?.city || '');
    setEditAddress(facility?.address || '');
    setEditInstapay(facility?.instapay_link || '');
    setDetailsMsg('');
    setEditingDetails(true);
  }

  async function saveDetails() {
    setDetailsMsg('');
    if (!editName.trim() || !editCity || !editAddress.trim()) return setDetailsMsg(t('Please fill in the branch name, area and address.'));
    if (!isEnglishText(editName) || !isEnglishText(editAddress)) return setDetailsMsg(`${t('Branch name and address:')} ${t(ENGLISH_HELP)}`);
    if (!isOwnerInstapay(editInstapay)) return setDetailsMsg(t('InstaPay: an 11-digit mobile number (01xxxxxxxxx) or your InstaPay link (https://...).'));
    setDetailsSaving(true);
    const { data, error } = await supabase.rpc('update_facility', {
      p_facility_id: facilityId, p_name: capitalizeWords(editName), p_city: editCity, p_address: capitalizeWords(editAddress), p_instapay_link: editInstapay.trim(),
    });
    setDetailsSaving(false);
    if (error) return setDetailsMsg(error.message);
    setEditingDetails(false);
    setDetailsMsg(data === 'pending' ? `📨 ${t('Sent to Zaf Play for approval. Players keep seeing the current details until it is approved.')}` : `✅ ${t('Branch details saved.')}`);
    load();
  }

  async function savePhone(courtId: string, phone: string) {
    if (phones[courtId] === phone) return null;
    const { error } = await supabase.from('court_contacts').upsert({ court_id: courtId, phone, updated_at: new Date().toISOString() }, { onConflict: 'court_id' });
    return error ? error.message : null;
  }

  // edits an existing court (new courts are added on their own screen)
  async function saveCourt(courtId: string, values: CourtFormValues): Promise<string | null> {
    const current = courts.find((c) => c.id === courtId);
    if (current) {
      // only the phone changed? save it without sending the court for approval
      const cur: Record<string, number> = Object.fromEntries(current.court_sports.map((cs) => [cs.sport?.id, Number(cs.price_per_hour)]));
      const curKeys = Object.keys(cur).sort();
      const newKeys = Object.keys(values.prices).sort();
      const samePrices = curKeys.join(',') === newKeys.join(',') && curKeys.every((k) => cur[k] === Number(values.prices[k]));
      const same = current.name === values.name && current.is_indoor === values.is_indoor && (current.surface_type || '') === values.surface_type
        && (current.maps_url || '') === values.maps_url && samePrices;
      if (same) {
        const phoneErr = await savePhone(courtId, values.phone);
        if (phoneErr) return phoneErr;
        setEditingCourtId(null);
        setCourtMsg(`✅ ${t('Court phone number saved.')}`);
        load();
        return null;
      }
    }
    const { data, error } = await supabase.rpc('save_court', {
      p_court_id: courtId, p_facility_id: facilityId, p_name: values.name, p_is_indoor: values.is_indoor, p_surface_type: values.surface_type,
      p_maps_url: values.maps_url, p_late_fee_percent: Number(values.late_fee_percent),
      p_sports: Object.entries(values.prices).map(([sport_id, price]) => ({ sport_id, price_per_hour: Number(price) })),
    });
    if (error) return error.message;
    // the phone is saved straight away (no approval needed)
    const phoneErr = await savePhone(courtId, values.phone);
    if (phoneErr) return `${t("Court saved, but the phone number wasn't:")} ${phoneErr}`;
    setEditingCourtId(null);
    setCourtMsg(data === 'pending' ? `📨 ${t('Changes sent to Zaf Play for approval. Players keep seeing the current version until then.')}` : `✅ ${t('Court details saved.')}`);
    load();
    return null;
  }

  // only a court with no bookings can be deleted (the database checks this and explains why not)
  function deleteCourt(c: Court) {
    Alert.alert(t('Delete {name}?', { name: c.name }), t("The court, its photos, hours and extras are removed for good. A court that already has bookings can't be deleted — use Disable instead."), [
      { text: t('Cancel'), style: 'cancel' },
      {
        text: t('Delete court'), style: 'destructive', onPress: async () => {
          const { error } = await supabase.rpc('owner_delete_court', { p_court_id: c.id });
          setCourtMsg(error ? `❌ ${error.message}` : `🗑️ ${t('"{name}" was deleted.', { name: c.name })}`);
          load();
        },
      },
    ]);
  }

  async function setActive(c: Court, on: boolean) {
    const { error } = await supabase.from('courts').update({ is_active: on }).eq('id', c.id);
    if (error) setCourtMsg(`❌ ${error.message}`);
    load();
  }
  function toggleActive(c: Court) {
    if (!c.is_active) return setActive(c, true);
    Alert.alert(t('Disable'), t('Hide this court from players with no end date? Nobody can book it until you enable it again, and bookings already made stay booked.\n\nTo close it for a set time, or to cancel the bookings in that time with a full refund, use "Block slots / Freeze" instead.'), [
      { text: t('Cancel'), style: 'cancel' },
      { text: t('Disable'), style: 'destructive', onPress: () => setActive(c, false) },
    ]);
  }

  function changeBadge(entityId: string) {
    const c = changes.find((x) => x.entity_id === entityId);
    if (c?.status === 'pending') return <Badge tone="warn" text={`📨 ${t('Your latest changes are waiting for Zaf Play approval')}`} />;
    if (c?.status === 'rejected') return <Badge tone="bad" text={`✖ ${t('Your last changes were not approved')}${c.reject_reason ? `: ${c.reject_reason}` : ''}`} />;
    return null;
  }

  if (facility === undefined) return <Loading />;
  if (facility === null) {
    return <View style={{ padding: 16 }}><Muted>{t("You don't have access to this branch.")}</Muted><LinkButton title={t('Back')} onPress={() => router.back()} /></View>;
  }

  const sportsOf = (c: Court) => c.court_sports.filter((cs) => cs.sport).map((cs) => ({ id: cs.sport!.id, name: cs.sport!.name }));
  const found = courts.filter((c) => searchMatches(search, [c.name, ...c.court_sports.map((cs) => cs.sport?.name || '')].join(' ')));
  const shown = found.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const label = (s: string) => <Text style={{ color: colors.muted }}>{s} </Text>;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <H2>{facility.name}</H2>
      <Muted style={{ marginBottom: 12 }}>{facility.city} · {facility.is_approved ? t('Approved') : t('Pending Approval')}</Muted>

      <Box>
        {!editingDetails ? (
          <>
            <Text style={{ color: colors.text, fontWeight: '800', marginBottom: 4 }}>{t('Branch details')}</Text>
            <Text style={{ color: colors.text }}>{label(t('Name:'))}{facility.name}</Text>
            <Text style={{ color: colors.text }}>{label(t('Area:'))}{facility.city}</Text>
            <Text style={{ color: colors.text }}>{label(t('Address:'))}{facility.address}</Text>
            <Text style={{ color: colors.text }}>{label(t('InstaPay for earnings:'))}{facility.instapay_link}</Text>
            {changeBadge(facilityId)}
            <View style={{ marginTop: 8 }}><Button small variant="ghost" title={`✏️ ${t('Edit branch')}`} onPress={startEditingDetails} /></View>
          </>
        ) : (
          <>
            <Text style={{ color: colors.text, fontWeight: '800', marginBottom: 8 }}>{t('Edit branch details')}</Text>
            <Field label={t('Branch Name')} value={editName} onChangeText={setEditName} />
            <AreaPicker value={editCity} onChange={setEditCity} />
            <Field label={t('Address')} value={editAddress} onChangeText={setEditAddress} />
            <Field label={t("InstaPay for this branch's earnings")} value={editInstapay} autoCapitalize="none" autoCorrect={false}
              onChangeText={(v) => setEditInstapay(cleanOwnerInstapay(v))} placeholder="01xxxxxxxxx or https://ipn.eg/..." />
            {facility.is_approved && <Muted style={{ fontSize: 12, marginBottom: 8 }}>{t('This branch is approved, so your changes will be sent to Zaf Play for approval first.')}</Muted>}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}><Button small title={detailsSaving ? t('Saving...') : t('Save branch')} onPress={saveDetails} loading={detailsSaving} /></View>
              <View style={{ flex: 1 }}><Button small variant="ghost" title={t('Cancel')} onPress={() => setEditingDetails(false)} /></View>
            </View>
          </>
        )}
        {!!detailsMsg && <Text style={{ color: colors.text, marginTop: 8 }}>{detailsMsg}</Text>}
      </Box>

      <BranchLocation key={`${facility.id}-${facility.city}`} facilityId={facilityId} area={facility.city}
        initial={facility.latitude !== null && facility.longitude !== null ? { lat: Number(facility.latitude), lng: Number(facility.longitude) } : null} />

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, marginBottom: 8 }}>
        <H2>{t('Courts')}</H2>
        <LinkButton title={t('+ Add Court')} onPress={() => router.push(`/owner/court-new/${facilityId}`)} />
      </View>
      {!!courtMsg && <Text style={{ color: colors.text, marginBottom: 8 }}>{courtMsg}</Text>}

      {courts.length === 0 ? <Muted>{t('No courts yet. Click "+ Add Court" to create your first one.')}</Muted> : (
        <>
          <Field label={t('Search courts by name or sport')} value={search} onChangeText={(v) => { setSearch(v); setPage(1); }} />
          {found.length === 0 && <Muted>{t('No courts match.')}</Muted>}
          {shown.map((court) => (
            <View key={court.id} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: 14, marginBottom: 12, backgroundColor: colors.card }}>
              {editingCourtId === court.id ? (
                <>
                  <Text style={{ color: colors.text, fontWeight: '800', marginBottom: 8 }}>{t('Edit {name}', { name: court.name })}</Text>
                  <CourtForm
                    initial={{
                      name: court.name, is_indoor: court.is_indoor, surface_type: court.surface_type || '', maps_url: court.maps_url || '',
                      late_fee_percent: String(court.late_fee_percent ?? 50), phone: phones[court.id] || '',
                      prices: Object.fromEntries(court.court_sports.filter((cs) => cs.sport).map((cs) => [cs.sport!.id, String(cs.price_per_hour)])),
                    }}
                    sports={sports} submitLabel={t('Save court')} onSubmit={(values) => saveCourt(court.id, values)} onCancel={() => setEditingCourtId(null)}
                  />
                </>
              ) : (
                <>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                    <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16 }}>{court.name}</Text>
                    <Badge text={court.is_indoor ? `🏠 ${t('Indoor')}` : `☀️ ${t('Outdoor')}`} />
                    {!court.is_approved && <Badge tone="warn" text={t('Waiting for approval')} />}
                  </View>
                  <Muted style={{ fontSize: 12 }}>{t('Late change/cancel fee: {n}% (set by Zaf Play)', { n: Number(court.late_fee_percent) })}</Muted>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>
                    {t('Court phone:')} {phones[court.id] || <Text style={{ color: colors.danger }}>{t('missing — press Edit to add it')}</Text>}
                  </Text>
                  {!!court.surface_type && <Muted style={{ fontSize: 12 }}>{t('Surface:')} {t(court.surface_type)}</Muted>}
                  {[...court.court_sports].sort((a, b) => String(a.sport?.name ?? '').localeCompare(String(b.sport?.name ?? ''))).map((cs) => (
                    <Text key={cs.sport?.id} style={{ color: colors.text, fontSize: 13 }}>{cs.sport?.name} — {cs.price_per_hour} {t('EGP/hour')}</Text>
                  ))}
                  {!!court.maps_url && <Text style={{ color: colors.primaryAlt, marginTop: 4 }} onPress={() => Linking.openURL(court.maps_url!)}>📍 {t('View on Google Maps')}</Text>}
                  {changeBadge(court.id)}
                  <Text style={{ fontSize: 12, marginTop: 4, color: !court.is_active ? colors.muted : !facility.is_approved || !court.is_approved ? colors.warning : colors.success }}>
                    {!court.is_active ? t('Disabled') : !facility.is_approved ? t('Waiting — the branch needs Zaf Play approval first') : !court.is_approved ? t('Waiting for Zaf Play approval') : t('Active')}
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 }}>
                    <LinkButton title={`✏️ ${t('Edit')}`} onPress={() => { setEditingCourtId(court.id); setCourtMsg(''); }} />
                    <LinkButton title={t('Hours')} onPress={() => router.push(`/owner/hours/${court.id}`)} />
                    <LinkButton title={t('Block slots / Freeze')} onPress={() => router.push(`/owner/block/${court.id}`)} />
                    <LinkButton title={court.is_active ? t('Disable') : t('Enable')} onPress={() => toggleActive(court)} />
                    <LinkButton danger title={t('Delete')} onPress={() => deleteCourt(court)} />
                  </View>
                </>
              )}
              <View style={{ borderTopWidth: 1, borderColor: colors.border, paddingTop: 10, marginTop: 10 }}>
                <PlanBox facilityIds={[facilityId]} courtId={court.id} />
              </View>
              <View style={{ borderTopWidth: 1, borderColor: colors.border, paddingTop: 10, marginTop: 10 }}>
                <PhotosManager courtId={court.id} />
              </View>
              <View style={{ borderTopWidth: 1, borderColor: colors.border, paddingTop: 10, marginTop: 10 }}>
                <ExtrasManager courtId={court.id} sports={sportsOf(court)} />
              </View>
            </View>
          ))}
          <Pager page={page} total={found.length} onChange={setPage} />
        </>
      )}
    </ScrollView>
  );
}
