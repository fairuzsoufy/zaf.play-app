import { useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { uploadPhoto } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { colors, radius, useTheme } from '@/lib/theme';
import { egp } from '@/lib/format';
import { cleanInstapay, INSTAPAY_HELP, isInstapay, MAX_PROOFS, MAX_PROOF_MB, ZAF_INSTAPAY_LINK } from '@/lib/payment';
import { Button, Field, Note } from '@/components/ui';

// "Send X EGP by InstaPay, add the screenshot and your refund InstaPay", like the website's PayBox.
// Used for open-game spots. onSubmit gets the uploaded path(s), comma separated, and returns an error or null.
export function ProofForm({ amount, onSubmit, onFocusRefund }: {
  amount: number;
  onSubmit: (paths: string, refundTo: string) => Promise<string | null>;
  onFocusRefund?: () => void;
}) {
  useTheme();
  const { session } = useAuth();
  const [files, setFiles] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [refundTo, setRefundTo] = useState('');
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function choose() {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: MAX_PROOFS, quality: 0.8 });
    if (!r.canceled) setFiles(r.assets.slice(0, MAX_PROOFS));
  }

  async function send() {
    setErr(null);
    if (!session) return;
    if (files.length === 0) return setErr('Please choose the screenshot of your InstaPay transfer.');
    if (files.some((f) => f.fileSize && f.fileSize > MAX_PROOF_MB * 1024 * 1024)) return setErr(`Each file must be smaller than ${MAX_PROOF_MB} MB.`);
    if (!isInstapay(refundTo)) return setErr(`Please add your InstaPay for refunds: ${INSTAPAY_HELP}`);
    setSending(true);
    const paths: string[] = [];
    for (const f of files) {
      const ext = (f.mimeType?.split('/')[1] || f.uri.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'jpg';
      const path = `${session.user.id}/${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}.${ext}`;
      const upErr = await uploadPhoto('payment-proofs', path, f.uri, f.mimeType || 'image/jpeg');
      if (upErr) { setSending(false); return setErr(`Upload failed: ${upErr}`); }
      paths.push(path);
    }
    const e = await onSubmit(paths.join(','), refundTo.trim());
    setSending(false);
    if (e) setErr(e);
    else setFiles([]);
  }

  return (
    <View style={{ backgroundColor: colors.card, borderRadius: radius.lg, padding: 14, borderWidth: 1, borderColor: colors.border }}>
      <Text style={{ color: colors.muted }}>Amount to send</Text>
      <Text style={{ color: colors.text, fontSize: 30, fontWeight: '800' }}>{egp(amount)}</Text>
      <Text style={{ color: colors.muted, marginTop: 12 }}>1. Send exactly {egp(amount)} to Zaf Play by InstaPay.</Text>
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
        placeholder="e.g. 01012345678" keyboardType="number-pad" maxLength={11} autoCorrect={false} onFocus={onFocusRefund} />
      <Text style={{ color: colors.muted, fontSize: 12, marginTop: -8, marginBottom: 12 }}>If you get a refund, it goes here. {INSTAPAY_HELP}</Text>
      {err && <Note kind="error">{err}</Note>}
      <Button title="Send payment screenshot" onPress={send} loading={sending} />
    </View>
  );
}
