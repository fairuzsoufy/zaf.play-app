import { useEffect, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { canOnBranch } from '@/lib/access';
import { useT } from '@/lib/ownerLang';
import { H2, LinkButton, Loading, Muted, useOwner } from '@/components/owner';
import { CourtForm, emptyCourt, hoursRows, PlanNote, uploadCourtPhotos, type CourtFormValues, type DraftExtra, type PickedPhoto, type SportOption, type WeekHours } from '@/components/ownerCourts';

// Add a court to a branch, with its photos, working hours and extras, like the website's courts/new page.
export default function NewCourt() {
  const { id: facilityId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { access } = useOwner();
  const { t } = useT();
  const [facility, setFacility] = useState<any>(undefined);
  const [sports, setSports] = useState<SportOption[]>([]);

  useEffect(() => {
    (async () => {
      const { data: f } = await supabase.from('facilities').select('id, name, owner_id, is_approved').eq('id', facilityId).maybeSingle();
      if (!f || !canOnBranch(access, f as any, 'manage_branches')) return setFacility(null);
      const { data: sp } = await supabase.from('sports').select('id, name, outdoor_only, indoor_only').eq('is_active', true).order('name', { ascending: true });
      setSports((sp as SportOption[]) || []);
      setFacility(f);
    })();
  }, [facilityId]);

  async function create(values: CourtFormValues, photos: PickedPhoto[], hours: WeekHours | null, extras: DraftExtra[]): Promise<string | null> {
    const { data, error } = await supabase.rpc('save_court', {
      p_court_id: null, p_facility_id: facilityId, p_name: values.name, p_is_indoor: values.is_indoor, p_surface_type: values.surface_type,
      p_maps_url: values.maps_url, p_late_fee_percent: Number(values.late_fee_percent),
      p_sports: Object.entries(values.prices).map(([sport_id, price]) => ({ sport_id, price_per_hour: Number(price) })),
    });
    if (error) return error.message;

    const { data: created } = await supabase.from('courts').select('id').eq('facility_id', facilityId).eq('name', values.name.trim())
      .order('created_at', { ascending: false }).limit(1);
    const newId = (created as any[])?.[0]?.id;
    const missing: string[] = [];
    if (newId) {
      const { error: phoneErr } = await supabase.from('court_contacts').upsert({ court_id: newId, phone: values.phone, updated_at: new Date().toISOString() }, { onConflict: 'court_id' });
      if (phoneErr) missing.push('phone number');
      if (hours) {
        const { error: hoursErr } = await supabase.from('availability_rules').insert(hoursRows(newId, hours));
        if (hoursErr) missing.push('working hours');
      }
      for (const x of extras) {
        const { error: exErr } = await supabase.rpc('owner_save_extra', {
          p_id: null, p_court_id: newId, p_sport_id: x.sport_id || null, p_name: x.name, p_price: Number(x.price), p_max_qty: Number(x.max_qty), p_is_required: x.is_required,
        });
        if (exErr) missing.push(`extra "${x.name}"`);
      }
      if (photos.length > 0) {
        const { error: photoErr } = await uploadCourtPhotos(newId, photos);
        if (photoErr) missing.push('some photos');
      }
    }
    const name = values.name;
    const msg = (data === 'applied'
      ? `✅ ${t('{name} is created and live.', { name })}`
      : facility?.is_approved
        ? `📨 ${t("{name} was added and sent to Zaf Play for approval. Players will see it once it's approved.", { name })}`
        : `📨 ${t('{name} was added. Zaf Play approves your branch first, then this court.', { name })}`)
      + (missing.length ? ` ⚠️ ${t("These weren't saved: {list} — open the court to add them.", { list: missing.join(', ') })}` : '');
    Alert.alert(t('Add a court'), msg, [{ text: 'OK', onPress: () => router.back() }]);
    return null;
  }

  if (facility === undefined) return <Loading />;
  if (facility === null) return <View style={{ padding: 16 }}><Muted>{t("You don't have access to this branch.")}</Muted><LinkButton title={t('Back')} onPress={() => router.back()} /></View>;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <H2>{t('Add a court to {name}', { name: facility.name })}</H2>
      <PlanNote />
      <CourtForm initial={emptyCourt} sports={sports} submitLabel={t('Create Court')} askPhotos askHours askExtras onSubmit={create} onCancel={() => router.back()} />
    </ScrollView>
  );
}
