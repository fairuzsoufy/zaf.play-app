import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { canOnBranch } from '@/lib/access';
import { useT } from '@/lib/ownerLang';
import { H2, LinkButton, Loading, Muted, useOwner } from '@/components/owner';
import { checkHours, DAYS, defaultHours, hoursRows, HoursEditor, type WeekHours } from '@/components/ownerCourts';
import { Button, Note } from '@/components/ui';

// A court's working hours, like the website's /owner/courts/[id]/hours.
export default function CourtHours() {
  const { id: courtId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { access } = useOwner();
  const { t } = useT();
  const [court, setCourt] = useState<any>(undefined);
  const [rules, setRules] = useState<WeekHours>(defaultHours());
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    (async () => {
      const { data: c } = await supabase.from('courts').select('id, name, facility:facilities(id, owner_id)').eq('id', courtId).maybeSingle();
      if (!c || !canOnBranch(access, (c as any).facility, 'manage_branches')) return setCourt(null);
      const { data: r } = await supabase.from('availability_rules').select('day_of_week, open_time, close_time, is_closed').eq('court_id', courtId);
      const map = defaultHours();
      for (const d of DAYS) {
        const x = ((r as any[]) || []).find((y) => y.day_of_week === d.value);
        if (x) map[d.value] = { open_time: x.open_time.slice(0, 5), close_time: x.close_time.slice(0, 5), is_closed: x.is_closed };
      }
      setRules(map);
      setCourt(c);
    })();
  }, [courtId]);

  async function save() {
    setMsg(null);
    const problem = checkHours(rules);
    if (problem) return setMsg({ kind: 'error', text: t(problem) });
    setSaving(true);
    // one row per day, updated in place: a failed save never leaves the court with no hours
    const { error } = await supabase.from('availability_rules').upsert(hoursRows(courtId, rules), { onConflict: 'court_id,day_of_week' });
    setSaving(false);
    setMsg(error ? { kind: 'error', text: error.message } : { kind: 'ok', text: `✅ ${t('Working hours saved.')}` });
  }

  if (court === undefined) return <Loading />;
  if (court === null) return <View style={{ padding: 16 }}><Muted>{t("You don't have access to this court.")}</Muted><LinkButton title={t('Back')} onPress={() => router.back()} /></View>;
  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <H2>{t('Working hours')} — {court.name}</H2>
      <HoursEditor value={rules} onChange={setRules} />
      {msg && <Note kind={msg.kind}>{msg.text}</Note>}
      <Button title={saving ? t('Saving...') : t('Save working hours')} onPress={save} loading={saving} />
    </ScrollView>
  );
}
