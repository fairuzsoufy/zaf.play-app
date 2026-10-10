import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts, radius, themed } from '@/lib/theme';
import { FREE_CHANGE_HOURS, FREE_CHANGE_MINUTES, HOLD_MINUTES, INSTAPAY_FEE_TEXT, REVIEW_MINUTES } from '@/lib/payment';

// The booking / change / cancellation policy in plain words (same text as the website's PolicyNotice),
// shown when booking, paying, changing and cancelling.
export function PolicyNotice({ feePercent, showPayment = true }: { feePercent: number; showPayment?: boolean }) {
  const s = useS();
  const keep = 100 - feePercent;
  const rows: { icon: string; title: string; text: string }[] = [];
  if (showPayment) {
    rows.push({
      icon: '💳', title: `Pay within ${HOLD_MINUTES} minutes`,
      text: `We hold your time for ${HOLD_MINUTES} minutes. Pay by InstaPay and upload the screenshot before the timer ends, otherwise the time goes back to other players. We confirm your payment within about ${REVIEW_MINUTES} minutes.`,
    });
  }
  rows.push(
    { icon: '🛡️', title: `Free changes up to ${FREE_CHANGE_HOURS} hours before`, text: `Change the day or time, or cancel and get all your money back, as long as it's more than ${FREE_CHANGE_HOURS} hours before you play.` },
    { icon: '⏱', title: `Free change in the first ${FREE_CHANGE_MINUTES} minutes`, text: `For ${FREE_CHANGE_MINUTES} minutes after your booking is confirmed you can change its day or time for free, even if you play in less than ${FREE_CHANGE_HOURS} hours. My bookings shows a timer. (Cancelling follows the rules below.)` },
    { icon: '🕒', title: `Less than ${FREE_CHANGE_HOURS} hours before`, text: `The court was kept for you, so ${feePercent}% of what you paid is kept as a late fee. If you cancel you get ${keep}% back. If you move to another time, the ${keep}% counts toward the new booking.` },
    { icon: '↩️', title: 'How refunds arrive', text: `We send refunds by InstaPay. InstaPay charges a small transfer fee (${INSTAPAY_FEE_TEXT}), which comes out of the refund.` },
    { icon: 'ℹ️', title: 'If the court cancels', text: 'If the court or Zaf Play has to cancel your game, you get 100% back.' },
  );
  return (
    <View style={s.card}>
      <Text style={s.title}>Booking policy</Text>
      {rows.map((r) => (
        <View key={r.title} style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
          <View style={s.chip}><Text style={{ fontSize: 14 }}>{r.icon}</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14 }}>{r.title}</Text>
            <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 2 }}>{r.text}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const useS = themed(() => StyleSheet.create({
  card: {
    backgroundColor: colors.card, borderRadius: radius.lg, padding: 14, marginVertical: 14,
    borderWidth: 1, borderColor: colors.border, borderLeftWidth: 4, borderLeftColor: colors.brandPurple,
  },
  title: { color: colors.text, fontFamily: fonts.displayBold, fontSize: 17 },
  chip: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.soft, alignItems: 'center', justifyContent: 'center' },
}));
