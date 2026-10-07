import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, Text, View } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { colors, radius } from '@/lib/theme';
import { countdown, egp } from '@/lib/format';
import { cleanInstapay, HOLD_MINUTES, INSTAPAY_HELP, isInstapay, MAX_PROOFS, MAX_PROOF_MB, REVIEW_MINUTES, ZAF_INSTAPAY_LINK } from '@/lib/payment';
import { Button, Field, Note } from '@/components/ui';
import { dateLabel, timeLabel } from '@/lib/format';

export default function Pay() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { session, loading: authLoading } = useAuth();
  const [b, setB] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [files, setFiles] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [refundTo, setRefundTo] = useState('');
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('bookings')
      .select(`id,start_time,end_time,status,payment_status,total_price,amount_due,credit_amount,credit_used,hold_expires_at,rescheduled_from,
        cancellation_reason,discount_amount,booking_extras(name,qty,amount),payments(created_at,status),sport:sports(name),
        court:courts(id,name,is_indoor,facility:facilities(name,city))`)
      .eq('id', id).maybeSingle();
    setB(data);
    setLoading(false);
  }, [id]);

  useEffect(() => { if (session) load(); else if (!authLoading) setLoading(false); }, [session, authLoading, load]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  // while the screenshot is being checked, look again every 15 seconds
  useEffect(() => {
    if (b?.payment_status !== 'pending_review') return;
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [b?.payment_status, load]);
  // live update the moment Zaf Play approves or rejects it
  useEffect(() => {
    if (!session) return;
    const ch = supabase.channel(`pay-${id}`)
      .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'bookings', filter: `id=eq.${id}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [id, session, load]);

  async function choose() {
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: MAX_PROOFS, quality: 0.8,
    });
    if (!r.canceled) setFiles(r.assets.slice(0, MAX_PROOFS));
  }

  async function submit() {
    setErr(null);
    if (!session) return;
    if (files.length === 0) return setErr('Please choose the screenshot of your InstaPay transfer.');
    if (!isInstapay(refundTo)) return setErr(`Please add your InstaPay for refunds: ${INSTAPAY_HELP}`);
    setSending(true);
    const paths: string[] = [];
    for (const f of files) {
      const body = await (await fetch(f.uri)).arrayBuffer();
      if (body.byteLength > MAX_PROOF_MB * 1024 * 1024) { setSending(false); return setErr(`Each file must be smaller than ${MAX_PROOF_MB} MB.`); }
      const ext = (f.mimeType?.split('/')[1] || f.uri.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'jpg';
      const rand = `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;
      const path = `${session.user.id}/${id}-${rand}.${ext}`;
      const { error } = await supabase.storage.from('payment-proofs').upload(path, body, { contentType: f.mimeType || 'image/jpeg' });
      if (error) { setSending(false); return setErr(`Upload failed: ${error.message}`); }
      paths.push(path);
    }
    const { error } = await supabase.rpc('submit_payment_proof', { p_booking_id: id, p_proof_path: paths.join(','), p_refund_to: refundTo.trim() });
    setSending(false);
    if (error) { setErr(error.message); load(); return; }
    setFiles([]);
    load();
  }

  if (loading) return <ActivityIndicator style={{ marginTop: 60 }} color={colors.primary} />;
  if (!session) return <Text style={{ color: colors.muted, margin: 40, textAlign: 'center' }}>Please log in to pay for your booking.</Text>;
  if (!b) return <Text style={{ color: colors.muted, margin: 40, textAlign: 'center' }}>Booking not found.</Text>;

  const holdLeft = b.hold_expires_at ? new Date(b.hold_expires_at).getTime() - now : null;
  const expired = b.status === 'cancelled' || (holdLeft !== null && holdLeft <= 0 && b.payment_status === 'unpaid');
  const sentAt = (b.payments ?? []).filter((p: any) => p.status === 'pending').map((p: any) => new Date(p.created_at).getTime()).sort((x: number, y: number) => y - x)[0];
  const reviewLeft = sentAt ? sentAt + REVIEW_MINUTES * 60000 - now : null;
  const isChange = !!b.rescheduled_from;
  const extrasSum = (b.booking_extras ?? []).reduce((a: number, x: any) => a + Number(x.amount), 0);

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: isChange ? 'Pay for your change' : 'Complete your booking' }} />
      <Text style={{ color: colors.text, fontSize: 18, fontWeight: '800' }}>{b.court?.name} · {b.sport?.name}</Text>
      <Text style={{ color: colors.muted, marginTop: 4 }}>{b.court?.facility?.name}, {b.court?.facility?.city}</Text>
      <Text style={{ color: colors.muted, marginBottom: 16 }}>{dateLabel(b.start_time)} · {timeLabel(b.start_time)} – {timeLabel(b.end_time)}</Text>

      {b.payment_status === 'paid' && b.status !== 'cancelled' && (
        <Note kind="ok">✅ Payment approved, you are booked! The court's phone number shows in My bookings 30 minutes before your game.</Note>
      )}

      {b.payment_status === 'pending_review' && b.status !== 'cancelled' && (
        <View>
          <Note kind="ok">
            ⏳ Payment received. We check your InstaPay screenshot within {REVIEW_MINUTES} minutes. Your time is reserved meanwhile.
          </Note>
          <Text style={{ color: colors.muted, marginBottom: 14 }}>
            {reviewLeft !== null && reviewLeft > 0 ? `Approval expected within ${countdown(reviewLeft)}` : 'Taking a little longer than usual, we are on it.'} This page updates by itself.
          </Text>
          <Button title="🔄 Refresh status" variant="ghost" onPress={load} />
        </View>
      )}

      {expired && (
        <View>
          <Note kind="error">{b.cancellation_reason || `The ${HOLD_MINUTES} minutes to send the payment have passed, so the time was released.`}</Note>
          <Button title="Book again" onPress={() => router.replace({ pathname: '/court/[id]', params: { id: b.court?.id } })} />
        </View>
      )}

      {b.payment_status === 'unpaid' && !expired && (
        <View>
          {holdLeft !== null && (
            <View style={{ backgroundColor: colors.card, borderColor: colors.warning, borderWidth: 1, borderRadius: radius.lg, padding: 14, flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 }}>
              <Text style={{ color: colors.warning }}>Your time is held for</Text>
              <Text style={{ color: colors.warning, fontWeight: '800', fontSize: 20 }}>{countdown(holdLeft)}</Text>
            </View>
          )}
          <View style={{ backgroundColor: colors.card, borderRadius: radius.lg, padding: 14, borderWidth: 1, borderColor: colors.border }}>
            {isChange ? (
              <Text style={{ color: colors.muted, marginBottom: 8 }}>New time costs {egp(b.total_price)} − {egp(b.credit_amount)} carried over from your old booking.</Text>
            ) : (
              <>
                <Text style={{ color: colors.muted }}>Court: {egp(Number(b.total_price) - extrasSum)}</Text>
                {(b.booking_extras ?? []).map((x: any) => <Text key={x.name} style={{ color: colors.muted }}>Extra: {x.name} × {x.qty}: {egp(x.amount)}</Text>)}
                {Number(b.discount_amount) > 0 && <Text style={{ color: colors.success }}>Referral discount: − {egp(b.discount_amount)}</Text>}
                {Number(b.credit_used) > 0 && <Text style={{ color: colors.success }}>Zaf Play credit used: − {egp(b.credit_used)}</Text>}
              </>
            )}
            <Text style={{ color: colors.muted, marginTop: 10 }}>Amount to send</Text>
            <Text style={{ color: colors.text, fontSize: 30, fontWeight: '800' }}>{egp(b.amount_due)}</Text>

            <Text style={{ color: colors.muted, marginTop: 12 }}>1. Send exactly {egp(b.amount_due)} to Zaf Play by InstaPay.</Text>
            <View style={{ marginVertical: 10 }}><Button title="Open InstaPay to pay →" onPress={() => Linking.openURL(ZAF_INSTAPAY_LINK)} /></View>
            <Text style={{ color: colors.muted }}>2. Take a screenshot of the successful transfer.</Text>
            <Text style={{ color: colors.muted, marginBottom: 10 }}>3. Add it here and press Send.</Text>

            {files.length > 0 && (
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
                {files.map((f) => <Image key={f.uri} source={{ uri: f.uri }} style={{ width: 90, height: 120, borderRadius: radius.sm }} contentFit="cover" />)}
              </View>
            )}
            <Button title={files.length ? 'Choose other screenshots' : `Choose screenshot (up to ${MAX_PROOFS})`} variant="ghost" onPress={choose} />

            <View style={{ height: 14 }} />
            <Field label="Your InstaPay for refunds" value={refundTo} onChangeText={(v) => setRefundTo(cleanInstapay(v))}
              placeholder="e.g. 01012345678" autoCapitalize="none" autoCorrect={false} />
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: -8, marginBottom: 12 }}>
              If this booking is ever cancelled, your money goes back here. {INSTAPAY_HELP}
            </Text>
            {err && <Note kind="error">{err}</Note>}
            <Button title="Send payment screenshot" onPress={submit} loading={sending} />
          </View>
        </View>
      )}
    </ScrollView>
  );
}
