import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { supabase } from '@/lib/supabase';
import { colors, radius, useTheme } from '@/lib/theme';
import { egp } from '@/lib/format';

// While a refund is due (court or Zaf Play cancelled, a cheaper change, a late screenshot), the player can take it
// as Zaf Play credit right away instead of waiting for the InstaPay transfer (the website's RefundChoice).
export function RefundChoice({ b, onChanged }: { b: any; onChanged?: () => void }) {
  useTheme();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  // a screenshot sent after the hold ran out is checked first, so its credit is added after the check
  const unchecked = (b.payments || []).some((p: { status: string }) => p.status === 'late');
  const dueAmount = Math.round((Number(b.refund_amount || 0) + Number(b.refund_fee || 0)) * 100) / 100;
  if (b.refund_status !== 'due' || !(dueAmount > 0)) return null;

  if (b.refund_as_credit) {
    return <Text style={{ color: colors.muted, marginTop: 10 }}>💳 You chose Zaf Play credit: {egp(dueAmount)} is added to your credit as soon as we have checked your transfer.</Text>;
  }

  async function toCredit() {
    setBusy(true);
    setMsg('');
    const { data, error } = await supabase.rpc('refund_to_credit', { p_booking_id: b.id });
    setBusy(false);
    if (error) return setMsg(`❌ ${error.message}`);
    setMsg(Number(data) > 0 ? `✅ ${egp(Number(data))} was added to your Zaf Play credit. It comes off your next booking.` : '✅ Done. It is added to your credit as soon as we have checked your transfer.');
    onChanged?.();
  }

  return (
    <View style={{ marginTop: 10, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 10, gap: 8 }}>
      <Text style={{ color: colors.text, fontWeight: '700' }}>Waiting for your refund? Choose how to get it:</Text>
      <Pressable onPress={toCredit} disabled={busy} style={{ borderRadius: radius.md, padding: 10, backgroundColor: colors.soft, opacity: busy ? 0.5 : 1 }}>
        <Text style={{ color: colors.text, fontWeight: '700' }}>Add {egp(dueAmount)} to my Zaf Play credit</Text>
        <Text style={{ color: colors.muted, fontSize: 12 }}>{unchecked ? 'Added as soon as we have checked your transfer.' : 'Right now, no InstaPay fee. It comes off your next booking.'}</Text>
      </Pressable>
      <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 10 }}>
        <Text style={{ color: colors.text, fontWeight: '700' }}>Keep the InstaPay refund</Text>
        <Text style={{ color: colors.muted, fontSize: 12 }}>Zaf Play sends it by the end of the day{b.refund_to ? ` to ${b.refund_to}` : ''}. Nothing to do.</Text>
      </View>
      {!!msg && <Text style={{ color: colors.text }}>{msg}</Text>}
    </View>
  );
}
