import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { Stack } from 'expo-router';
import { Text } from '@/components/AppText';
import { supabase } from '@/lib/supabase';
import { signedDate, type AgreementVersion } from '@/lib/agreement';
import { colors } from '@/lib/theme';
import AgreementText from '@/components/AgreementText';
import { Card, Line } from '@/components/admin';
import { H2, LinkButton, Loading, Muted } from '@/components/owner';

type Signature = { user_id: string; version: number; full_name: string; signed_at: string };
type Person = { user_id: string; name: string; email: string; business: string; as: 'owner' | 'co_owner' };

// Owner agreements, like the website's admin page: publish a version to owners, and see who signed it
// (owner and co-owners) and when.
export default function AdminAgreements() {
  const [versions, setVersions] = useState<AgreementVersion[] | null>(null);
  const [signatures, setSignatures] = useState<Signature[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [preview, setPreview] = useState<number | null>(null);
  const [confirming, setConfirming] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [v, s, o, c] = await Promise.all([
      supabase.from('owner_agreement_versions').select('version, body, published_at').order('version', { ascending: false }),
      supabase.from('owner_agreement_signatures').select('user_id, version, full_name, signed_at').order('signed_at', { ascending: false }),
      supabase.from('users').select('id, full_name, email').eq('role', 'owner').eq('owner_status', 'approved').order('full_name'),
      supabase.from('owner_staff').select('user_id, owner_id, full_name, email').eq('is_co_owner', true).eq('status', 'active'),
    ]);
    setVersions((v.data as AgreementVersion[]) || []);
    setSignatures((s.data as Signature[]) || []);
    const owners = (o.data as { id: string; full_name: string | null; email: string }[]) || [];
    const list: Person[] = [];
    owners.forEach((x) => {
      const business = x.full_name || x.email;
      list.push({ user_id: x.id, name: business, email: x.email, business, as: 'owner' });
      ((c.data as any[]) || []).filter((co) => co.owner_id === x.id && co.user_id)
        .forEach((co) => list.push({ user_id: co.user_id, name: co.full_name || co.email, email: co.email, business, as: 'co_owner' }));
    });
    setPeople(list);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function publish(version: number) {
    setBusy(true);
    setMessage('');
    const { error } = await supabase.rpc('admin_publish_owner_agreement', { p_version: version });
    setBusy(false);
    setConfirming(null);
    if (error) return setMessage(error.message);
    setMessage(`Version ${version} is live. Approved owners and co-owners were emailed and will be asked to sign it on their dashboard.`);
    load();
  }

  const live = (versions || []).find((v) => v.published_at);
  const signedLive = (p: Person) => signatures.find((s) => s.user_id === p.user_id && s.version === live?.version);
  const waiting = live ? people.filter((p) => !signedLive(p)).length : 0;

  return (
    <>
      <Stack.Screen options={{ title: 'Owner agreements' }} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
        {!!message && <Text style={{ color: colors.text, marginBottom: 10 }}>{message}</Text>}
        <H2>Versions</H2>
        {versions === null ? <Loading /> : versions.map((v) => (
          <Card key={v.version}>
            <Line bold size={15}>Version {v.version}</Line>
            <Line muted>{v.published_at ? `Live since ${signedDate(v.published_at)}` : 'Draft: owners don’t see it yet'}</Line>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 }}>
              <LinkButton title={preview === v.version ? 'Hide text' : 'Read text'} onPress={() => setPreview(preview === v.version ? null : v.version)} />
              {!v.published_at && (confirming === v.version ? (
                <>
                  <LinkButton title={busy ? 'Publishing...' : 'Yes, publish and email owners'} onPress={() => publish(v.version)} disabled={busy} />
                  <LinkButton title="Cancel" onPress={() => setConfirming(null)} />
                </>
              ) : <LinkButton title="Publish to owners" onPress={() => setConfirming(v.version)} />)}
            </View>
            {confirming === v.version && <Line muted>Every approved owner and co-owner gets an email and must sign this version before using their dashboard. This can’t be undone.</Line>}
            {preview === v.version && <View style={{ marginTop: 12, borderTopWidth: 1, borderColor: colors.border, paddingTop: 12 }}><AgreementText body={v.body} /></View>}
          </Card>
        ))}

        <H2>Who signed {live ? `version ${live.version}` : ''}</H2>
        {!live ? <Muted>No version is live yet.</Muted> : (
          <>
            <Muted>{waiting === 0 ? 'Everyone has signed. 🎉' : `${waiting} still to sign.`}</Muted>
            {people.map((p) => {
              const s = signedLive(p);
              return (
                <Card key={p.user_id}>
                  <Line bold>{p.name} <Text style={{ color: colors.muted, fontWeight: '400' }}>· {p.as === 'owner' ? 'Owner' : `Co-owner of ${p.business}`}</Text></Line>
                  <Line muted>{p.email}</Line>
                  {s ? <Text style={{ color: colors.success, marginTop: 4 }}>✓ Signed as “{s.full_name}” · {signedDate(s.signed_at)}</Text>
                    : <Text style={{ color: colors.warning, marginTop: 4 }}>Not signed yet</Text>}
                </Card>
              );
            })}
          </>
        )}
      </ScrollView>
    </>
  );
}
