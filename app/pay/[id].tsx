import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, KeyboardAvoidingView, Linking, Platform, ScrollView, View } from 'react-native';
import { Text } from '@/components/AppText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { supabase, uploadPhoto } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { colors, radius, useTheme } from '@/lib/theme';
import { cairoDayMinutes, countdown, egp } from '@/lib/format';
import { savedRefundInstapay } from '@/lib/bookPrefs';
import { cleanInstapay, HOLD_MINUTES, INSTAPAY_HELP, isInstapay, MAX_PROOFS, MAX_PROOF_MB, REVIEW_MINUTES, ZAF_INSTAPAY_LINK } from '@/lib/payment';
import { Button, Field, Note } from '@/components/ui';
import { toast } from '@/components/Toast';
import { askToNotify } from '@/components/BookingAlerts';
import { PolicyNotice } from '@/components/PolicyNotice';
import { dateLabel, timeLabel } from '@/lib/format';
import { useRequestId } from '@/lib/requestId';
import { RefundChoice } from '@/components/RefundChoice';
import { BookingTicket } from '@/components/BookingTicket';

const LATE_PAY_MINUTES = 60; // must match submit_payment_proof: a screenshot can still come this long after the hold

// why a screenshot sent after the hold ran out became a refund: the database saves the true reason
function lateReason(reason: string | null | undefined) {
  const r = (reason || '').replace(/\s*Full refund due\.?$/, '').trim();
  if (!r || /already taken/.test(r)) return `Your ${HOLD_MINUTES} minutes ran out before the screenshot arrived, so the booking was not kept.`;
  return r.replace('the 5 minutes', `the ${HOLD_MINUTES} minutes`);
}

export default function Pay() {
  const insets = useSafeAreaInsets();
  useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { session, loading: authLoading } = useAuth();
  const [b, setB] = useState<any>(null);
  const [group, setGroup] = useState<any[]>([]); // separate times booked together, paid with one transfer
  const req = useRequestId();
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [files, setFiles] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [refundTo, setRefundTo] = useState('');
  const [editRefund, setEditRefund] = useState(false); // a remembered refund number shows as one line until "Change"
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const scroll = useRef<ScrollView>(null);
  const typingRefund = useRef(false);

  // the InstaPay field is near the bottom: once the keyboard is up, bring it (and the Send button) right above it
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidShow', () => { if (typingRefund.current) scroll.current?.scrollToEnd({ animated: true }); });
    return () => sub.remove();
  }, []);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('bookings')
      .select(`id,start_time,end_time,status,payment_status,total_price,amount_due,credit_amount,credit_used,hold_expires_at,rescheduled_from,
        cancellation_reason,cancelled_by,group_id,refund_to,refund_status,refund_amount,refund_fee,refund_as_credit,discount_amount,booking_extras(name,qty,amount),payments(created_at,status),sport:sports(name,slug),
        court:courts(id,name,is_indoor,late_fee_percent,maps_url,facility:facilities(name,city,latitude,longitude))`)
      .eq('id', id).maybeSingle();
    if ((data as any)?.group_id) {
      const { data: g } = await supabase.from('bookings').select('id,start_time,end_time,status,payment_status,amount_due')
        .eq('group_id', (data as any).group_id).order('start_time');
      setGroup((g as any[]) || []);
    } else setGroup([]);
    setB(data);
    setLoading(false);
  }, [id]);

  useEffect(() => { if (session) load(); else if (!authLoading) setLoading(false); }, [session, authLoading, load]);
  // the refund InstaPay used last time (or the account mobile) is filled in, so it is typed once, not on every booking
  useEffect(() => {
    if (!session) return;
    let off = false;
    savedRefundInstapay(session.user.id).then((v) => { if (!off && v) setRefundTo((cur) => cur || v); }).catch(() => {});
    return () => { off = true; };
  }, [session]);
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
    const ch = supabase.channel(`pay-${id}-${Date.now()}`)
      .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'bookings', filter: `id=eq.${id}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [id, session, load]);

  // one photo per pick: tapping it in the gallery is enough (a multi-pick needs an extra Add tap on iPhone);
  // a second screenshot is added with "Add another"
  async function choose(add = false) {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (!r.canceled) setFiles((f) => [...(add ? f : []), ...r.assets].slice(0, MAX_PROOFS));
  }
  async function copyAmount(v: number) {
    await Clipboard.setStringAsync(String(v));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function submit() {
    setErr(null);
    if (!session) return;
    if (files.length === 0) return setErr('Please choose the screenshot of your InstaPay transfer.');
    if (!b?.refund_to && !isInstapay(refundTo)) return setErr(`Please add your InstaPay for refunds: ${INSTAPAY_HELP}`);
    setSending(true);
    const paths: string[] = [];
    for (const f of files) {
      if (f.fileSize && f.fileSize > MAX_PROOF_MB * 1024 * 1024) { setSending(false); return setErr(`Each file must be smaller than ${MAX_PROOF_MB} MB.`); }
      const ext = (f.mimeType?.split('/')[1] || f.uri.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'jpg';
      const rand = `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;
      const path = `${session.user.id}/${id}-${rand}.${ext}`;
      const upErr = await uploadPhoto('payment-proofs', path, f.uri, f.mimeType || 'image/jpeg');
      if (upErr) { setSending(false); return setErr(`Upload failed: ${upErr}`); }
      paths.push(path);
    }
    const refund = b?.refund_to ? null : refundTo.trim();
    const { error } = b?.group_id
      ? await supabase.rpc('submit_group_payment_proof', { p_request_id: req.get(), p_group_id: b.group_id, p_proof_path: paths.join(','), p_refund_to: refund })
      : await supabase.rpc('submit_payment_proof', { p_request_id: req.get(), p_booking_id: id, p_proof_path: paths.join(','), p_refund_to: refund });
    setSending(false);
    if (error) { setErr(error.message); load(); return; }
    req.done();
    setFiles([]);
    askToNotify();
    toast("Payment sent! We'll confirm it shortly.");
    router.replace('/bookings');
  }

  if (loading) return <ActivityIndicator style={{ marginTop: 60 }} color={colors.primary} />;
  if (!session) return <Text style={{ color: colors.muted, margin: 40, textAlign: 'center' }}>Please log in to pay for your booking.</Text>;
  if (!b) return <Text style={{ color: colors.muted, margin: 40, textAlign: 'center' }}>Booking not found.</Text>;

  const holdLeft = b.hold_expires_at ? new Date(b.hold_expires_at).getTime() - now : null;
  const expired = b.status === 'cancelled' || (holdLeft !== null && holdLeft <= 0 && b.payment_status === 'unpaid');
  const sentAt = (b.payments ?? []).filter((p: any) => p.status === 'pending').map((p: any) => new Date(p.created_at).getTime()).sort((x: number, y: number) => y - x)[0];
  const reviewLeft = sentAt ? sentAt + REVIEW_MINUTES * 60000 - now : null;
  const isChange = !!b.rescheduled_from;
  // the hold ran out while the player was paying: for an hour they can still send the screenshot.
  // If the time is still free the booking comes back; if not, the database records a full refund.
  const lateRefund = (b.payments ?? []).some((p: any) => p.status === 'late');
  const expiredByTimer = b.payment_status === 'unpaid' && !!b.hold_expires_at && (b.status === 'pending' || (b.status === 'cancelled' && b.cancelled_by === 'system'));
  const latePayable = expired && expiredByTimer && !lateRefund && now - new Date(b.hold_expires_at).getTime() < LATE_PAY_MINUTES * 60000;
  const groupUnpaid = group.filter((g) => g.payment_status === 'unpaid' && g.status !== 'cancelled');
  const amountDue = b.group_id && b.payment_status === 'unpaid' ? groupUnpaid.reduce((a, g) => a + Number(g.amount_due), 0) || Number(b.amount_due) : Number(b.amount_due);
  // book again opens the booking screen on the same court, sport and time, already picked
  const again = (() => {
    const { date, minutes } = cairoDayMinutes(b.start_time);
    const dur = Math.round((new Date(b.end_time).getTime() - new Date(b.start_time).getTime()) / 60000);
    return { courtId: b.court?.id, sport: b.sport?.slug, date, start: String(minutes), dur: String(dur) };
  })();
  const bookAgain = () => router.replace({ pathname: '/book/[courtId]', params: again });
  const proofPicker = (
    <>
      {files.length > 0 && (
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
          {files.map((f) => <Image key={f.uri} source={{ uri: f.uri }} style={{ width: 90, height: 120, borderRadius: radius.sm }} contentFit="cover" />)}
        </View>
      )}
      {files.length === 0 ? (
        <Button title="Choose screenshot" variant="ghost" onPress={() => choose()} />
      ) : (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {files.length < MAX_PROOFS && <View style={{ flex: 1 }}><Button title="Add another" variant="ghost" small onPress={() => choose(true)} /></View>}
          <View style={{ flex: 1 }}><Button title="Remove" variant="ghost" small onPress={() => setFiles([])} /></View>
        </View>
      )}
      <View style={{ height: 14 }} />
      {b.refund_to ? (
        <Text style={{ color: colors.muted, marginBottom: 12 }}>Refunds go to {b.refund_to}.</Text>
      ) : isInstapay(refundTo) && !editRefund ? (
        <Text style={{ color: colors.muted, marginBottom: 12 }}>
          Refunds go to <Text style={{ color: colors.text, fontWeight: '700' }}>{refundTo}</Text> ·{' '}
          <Text accessibilityRole="button" onPress={() => setEditRefund(true)} style={{ color: colors.accent, fontWeight: '700' }}>Change</Text>
        </Text>
      ) : (
        <>
          <Field label="Your InstaPay for refunds" value={refundTo} onChangeText={(v) => setRefundTo(cleanInstapay(v))}
            placeholder="e.g. 01012345678" keyboardType="number-pad" maxLength={11} autoCorrect={false}
            onFocus={() => { typingRefund.current = true; setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 300); }}
            onBlur={() => { typingRefund.current = false; }} />
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: -8, marginBottom: 12 }}>
            If this booking is ever cancelled, your money goes back here. {INSTAPAY_HELP}
          </Text>
        </>
      )}
      {err && <Note kind="error">{err}</Note>}
    </>
  );
  // booked or waiting for approval: the ticket screen, like the website
  const ticket = (b.payment_status === 'paid' || b.payment_status === 'pending_review') && b.status !== 'cancelled';
  const extrasSum = (b.booking_extras ?? []).reduce((a: number, x: any) => a + Number(x.amount), 0);

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior="padding" keyboardVerticalOffset={insets.top + (Platform.OS === 'ios' ? 44 : 56)}>
    <ScrollView ref={scroll} style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: ticket ? 'Your booking' : isChange ? 'Pay for your change' : 'Complete your booking' }} />
      {!ticket && (
        <>
          <Text style={{ color: colors.text, fontSize: 18, fontWeight: '800' }}>{b.court?.name} · {b.sport?.name}</Text>
          <Text style={{ color: colors.muted, marginTop: 4 }}>{b.court?.facility?.name}, {b.court?.facility?.city}</Text>
          <Text style={{ color: colors.muted, marginBottom: 16 }}>{dateLabel(b.start_time)} · {timeLabel(b.start_time)} – {timeLabel(b.end_time)}</Text>
        </>
      )}

      {(b.payment_status === 'paid' || b.payment_status === 'pending_review') && b.status !== 'cancelled' && (
        <BookingTicket b={b} mode={b.payment_status === 'paid' ? 'booked' : 'waiting'} now={now} reviewLeft={reviewLeft} isChange={isChange} />
      )}

      {expired && lateRefund && (
        <View>
          <Note kind="ok">
            We got your screenshot. {lateReason(b.cancellation_reason)} So we'll send {egp(b.refund_amount)} back to your InstaPay{b.refund_to ? ` (${b.refund_to})` : ''} in full by the end of the day, once we've checked the transfer.
          </Note>
          <RefundChoice b={b} onChanged={load} />
          <View style={{ height: 12 }} />
          <Button title="Pick another time" onPress={bookAgain} />
        </View>
      )}

      {expired && !lateRefund && !latePayable && (
        <View>
          <Note kind="error">{b.cancellation_reason || `The ${HOLD_MINUTES} minutes to send the payment have passed, so the time was released.`}</Note>
          {expiredByTimer && <Text style={{ color: colors.muted, marginBottom: 12 }}>Already sent the money? Message us on Instagram @zaf.play with your screenshot and we'll refund you.</Text>}
          <Button title="Book again" onPress={bookAgain} />
        </View>
      )}

      {latePayable && (
        <View>
          <Text style={{ fontSize: 40, textAlign: 'center' }}>⏱️</Text>
          <Text style={{ color: colors.text, fontSize: 20, fontWeight: '800', textAlign: 'center' }}>Your {HOLD_MINUTES} minutes ran out</Text>
          <Text style={{ color: colors.muted, textAlign: 'center', marginBottom: 14 }}>The time may still be free.</Text>
          <Button title="Hold it again" onPress={bookAgain} />
          <View style={{ backgroundColor: colors.card, borderRadius: radius.lg, padding: 14, borderWidth: 1, borderColor: colors.border, marginTop: 14 }}>
            <Text style={{ color: colors.text, fontWeight: '700' }}>Already sent the money?</Text>
            <Text style={{ color: colors.muted, marginBottom: 10 }}>Add the screenshot. If the time was taken, you get it all back.</Text>
            {proofPicker}
            {files.length > 0 && <Button title="Send" onPress={submit} loading={sending} />}
          </View>
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
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Text style={{ color: colors.text, fontSize: 30, fontWeight: '800' }}>{egp(amountDue)}</Text>
              <Text accessibilityRole="button" onPress={() => copyAmount(amountDue)} style={{ color: colors.accent, fontWeight: '700', paddingVertical: 8 }}>{copied ? 'Copied ✓' : 'Copy'}</Text>
            </View>
            {groupUnpaid.length > 1 && <Text style={{ color: colors.muted }}>One transfer for {groupUnpaid.length} times booked together.</Text>}

            <Text style={{ color: colors.muted, marginTop: 12 }}>1. Send exactly {egp(amountDue)} to Zaf Play by InstaPay.</Text>
            <View style={{ marginVertical: 10 }}><Button title="Open InstaPay to pay →" onPress={() => Linking.openURL(ZAF_INSTAPAY_LINK)} /></View>
            <Text style={{ color: colors.muted }}>2. Take a screenshot of the successful transfer.</Text>
            <Text style={{ color: colors.muted, marginBottom: 10 }}>3. Add it here and press Send.</Text>

            {proofPicker}
            {files.length > 0 && <Button title="Send payment screenshot" onPress={submit} loading={sending} />}
          </View>
          <PolicyNotice feePercent={Number(b.court?.late_fee_percent ?? 50)} />
        </View>
      )}
    </ScrollView>
    </KeyboardAvoidingView>
  );
}
