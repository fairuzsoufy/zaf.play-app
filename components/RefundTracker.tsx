import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { colors, radius, themed } from '@/lib/theme';
import { countdown, egp } from '@/lib/format';
import { cancelSplitPreview, FREE_CHANGE_HOURS, INSTAPAY_FEE_TEXT } from '@/lib/payment';

export const REFUND_MINUTES = 60; // same as the website: Zaf Play sends a refund within this time after the request

function at(iso: string) {
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Africa/Cairo' })
    .replace(/am|pm/, (x) => x.toUpperCase());
}

type Stage = 'review' | 'sending' | 'sent' | 'none';

// The money side of a cancellation, worked out like the website's RefundTracker. null when no money was involved.
export function refundInfo(b: any) {
  const requestOpen = b.cancel_request_status === 'pending' && ['pending', 'confirmed'].includes(b.status);
  const feePercent = Number(b.court?.late_fee_percent ?? 50);
  let paid = 0, kept = 0, transferFee = 0, back = 0, creditOut = 0, late = false;
  let stage: Stage = 'none';
  let startedAt: string | null = null;
  const byPlayer = requestOpen || b.cancelled_by === 'player';

  if (requestOpen) {
    // a change to a new time that wasn't approved yet: only the extra amount was sent, and there is no late fee
    const isMove = !!b.rescheduled_from && b.payment_status === 'pending_review';
    paid = Number(isMove ? b.amount_due : b.total_price);
    late = isMove ? false : new Date(b.cancel_requested_at).getTime() > new Date(b.start_time).getTime() - FREE_CHANGE_HOURS * 3600 * 1000;
    const p = cancelSplitPreview(paid, feePercent, late, isMove ? 0 : Number(b.credit_used || 0));
    kept = p.kept;
    if (b.cancel_request_as_credit) creditOut = p.allAsCredit;
    else { transferFee = p.transferFee; back = p.refund; creditOut = p.creditBack; }
    stage = 'review';
    startedAt = b.cancel_requested_at;
  } else if (b.status === 'cancelled') {
    kept = Number(b.retained_amount || 0);
    transferFee = Number(b.refund_fee || 0);
    back = Number(b.refund_amount || 0);
    creditOut = Number(b.credit_issued || 0);
    paid = Math.round((kept + transferFee + back + creditOut) * 100) / 100;
    late = kept > 0;
    stage = b.refund_status === 'refunded' ? 'sent' : b.refund_status === 'due' ? 'sending' : 'none';
    startedAt = b.cancelled_at;
  }
  if (!(paid > 0)) return null;
  return { requestOpen, feePercent, paid, kept, transferFee, back, creditOut, late, stage, startedAt, byPlayer };
}

// Shown on My bookings for a cancellation that involves money: where the refund is (request under review → on its way →
// sent + the transfer receipt), what was paid, what was deducted and why, and what comes back.
export function RefundTracker({ b, now, proofUrl, onWithdraw }: { b: any; now: number; proofUrl?: string; onWithdraw?: () => void }) {
  const s = useS();
  const r = refundInfo(b);
  if (!r) return null;
  const { stage, back, creditOut, paid, kept, transferFee, late, feePercent, byPlayer } = r;
  const expectedBy = r.startedAt ? new Date(r.startedAt).getTime() + REFUND_MINUTES * 60000 : null;
  const left = expectedBy ? expectedBy - now : null;
  const who = b.cancelled_by === 'owner' ? 'the court owner' : 'Zaf Play';
  const isPdf = (b.refund_proof_path || '').toLowerCase().endsWith('.pdf');

  const steps = byPlayer
    ? [
        { label: 'Request sent', detail: b.cancel_requested_at ? at(b.cancel_requested_at) : undefined, done: true, current: false },
        { label: 'Reviewed by Zaf Play', detail: stage === 'review' ? 'In progress' : b.cancelled_at ? at(b.cancelled_at) : undefined, done: stage !== 'review', current: stage === 'review' },
        { label: back > 0 ? 'Refund sent' : 'Closed', detail: stage === 'sent' && b.refunded_at ? at(b.refunded_at) : undefined, done: stage === 'sent' || (stage === 'none' && back === 0), current: stage === 'sending' },
      ]
    : [
        { label: `Cancelled by ${who}`, detail: b.cancelled_at ? at(b.cancelled_at) : undefined, done: true, current: false },
        { label: 'Refund sent', detail: stage === 'sent' && b.refunded_at ? at(b.refunded_at) : stage === 'sending' ? 'On its way' : undefined, done: stage === 'sent', current: stage === 'sending' },
      ];

  return (
    <View style={s.box}>
      {/* where the money is */}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}>
          {stage === 'review' && (
            <>
              <Text style={s.head}>🕓 Cancellation request received, pending review</Text>
              <Text style={s.body}>
                {back === 0 && creditOut > 0
                  ? `Zaf Play checks it, then ${egp(creditOut)} is added to your credit. It is taken off your next booking automatically.`
                  : `Zaf Play checks it and sends your refund by InstaPay. Expect it within 1 hour of your request.${creditOut > 0 ? ` ${egp(creditOut)} (the part you paid with credit) goes back to your credit.` : ''}`}
              </Text>
            </>
          )}
          {stage === 'sending' && (
            <>
              <Text style={s.head}>⏳ Refund on its way</Text>
              <Text style={s.body}>Expect it within 1 hour of the cancellation.</Text>
            </>
          )}
          {stage === 'sent' && (
            <>
              <Text style={[s.head, { color: colors.success }]}>✅ Refund sent{b.refunded_at ? ` on ${at(b.refunded_at)}` : ''}</Text>
              <Text style={s.body}>{egp(back)}{b.refund_to ? ` to ${b.refund_to}` : ''}. Check your InstaPay app.</Text>
            </>
          )}
          {stage === 'none' && back === 0 && creditOut > 0 && (
            <>
              <Text style={[s.head, { color: colors.success }]}>✅ {egp(creditOut)} added to your Zaf Play credit</Text>
              <Text style={s.body}>It is taken off your next booking automatically.</Text>
            </>
          )}
          {stage === 'none' && back === 0 && creditOut === 0 && (
            <Text style={s.head}>No refund, the whole amount was kept as the late cancellation fee.</Text>
          )}
        </View>
        {(stage === 'review' || stage === 'sending') && left !== null && (
          <View style={{ alignItems: 'flex-end' }}>
            {left > 0 ? (
              <>
                <Text style={{ color: colors.muted, fontSize: 11 }}>expected within</Text>
                <Text style={s.timer}>{countdown(left)}</Text>
              </>
            ) : (
              <Text style={{ color: colors.muted, fontSize: 12, maxWidth: 110, textAlign: 'right' }}>Taking a little longer, it's on its way</Text>
            )}
          </View>
        )}
      </View>

      {/* steps */}
      <View style={{ marginTop: 12, gap: 8 }}>
        {steps.map((st, i) => (
          <View key={st.label} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
            <View style={[s.dot, st.done ? s.dotDone : st.current ? s.dotNow : null]}>
              <Text style={{ fontSize: 11, fontWeight: '800', color: st.done ? colors.success : st.current ? colors.warning : colors.muted }}>{st.done ? '✓' : i + 1}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: st.done || st.current ? colors.text : colors.muted, fontWeight: '700', fontSize: 13 }}>{st.label}</Text>
              {st.detail && <Text style={{ color: colors.muted, fontSize: 12 }}>{st.detail}</Text>}
            </View>
          </View>
        ))}
      </View>

      {/* the money */}
      <View style={s.money}>
        <Row l="You paid" r={egp(paid)} />
        <Row l="Cancellation fee" r={kept > 0 ? `− ${egp(kept)}` : egp(0)}
          note={!byPlayer
            ? `None, the booking was cancelled by ${who}, so you get a full refund.`
            : late
              ? `${feePercent}% of the booking is kept because the cancellation came less than ${FREE_CHANGE_HOURS} hours before the game.`
              : `Free, you cancelled more than ${FREE_CHANGE_HOURS} hours before the game.`} />
        {(transferFee > 0 || (byPlayer && creditOut === 0)) && (
          <Row l="InstaPay transfer fee" r={transferFee > 0 ? `− ${egp(transferFee)}` : egp(0)}
            note={`InstaPay charges ${INSTAPAY_FEE_TEXT} to send money back; it comes out of the refund.`} />
        )}
        {(back > 0 || creditOut === 0) && <Row l={stage === 'sent' ? 'You got back' : 'You get back'} r={egp(back)} total />}
        {creditOut > 0 && <Row l={stage === 'review' ? 'Goes to your credit' : 'Added to your credit'} r={egp(creditOut)} total={back === 0} bold />}
        {(b.refund_to || b.cancel_request_refund_to) && back > 0 && (
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>To your InstaPay: {b.refund_to || b.cancel_request_refund_to}</Text>
        )}
      </View>

      {/* photo of the transfer */}
      {stage === 'sent' && b.refund_proof_path && (
        <View style={{ marginTop: 12 }}>
          <Text style={[s.head, { marginBottom: 6 }]}>Transfer receipt</Text>
          {!proofUrl ? (
            <Text style={s.body}>Loading the receipt...</Text>
          ) : isPdf ? (
            <Pressable hitSlop={10} onPress={() => Linking.openURL(proofUrl)}><Text style={s.link}>📄 Open the receipt (PDF)</Text></Pressable>
          ) : (
            <Pressable onPress={() => Linking.openURL(proofUrl)} accessibilityLabel="Open the refund receipt full size">
              <Image source={{ uri: proofUrl }} style={s.receipt} contentFit="cover" />
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>Tap to open full size</Text>
            </Pressable>
          )}
        </View>
      )}

      {stage === 'review' && onWithdraw && (
        <Text style={{ color: colors.muted, fontSize: 12, marginTop: 12 }}>
          Changed your mind? <Text onPress={onWithdraw} style={s.link}>Withdraw the request</Text> and keep your booking.
        </Text>
      )}
    </View>
  );
}

function Row({ l, r, note, total, bold }: { l: string; r: string; note?: string; total?: boolean; bold?: boolean }) {
  const s = useS();
  return (
    <View style={[{ flexDirection: 'row', justifyContent: 'space-between', gap: 10, marginTop: 6 }, total && s.total]}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text, fontWeight: total || bold ? '800' : '400' }}>{l}</Text>
        {note && <Text style={{ color: colors.muted, fontSize: 12 }}>{note}</Text>}
      </View>
      <Text style={{ color: colors.text, fontWeight: total || bold ? '800' : '600', fontVariant: ['tabular-nums'] }}>{r}</Text>
    </View>
  );
}

const useS = themed(() => StyleSheet.create({
  box: { marginTop: 12, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.cardAlt, padding: 12 },
  head: { color: colors.text, fontWeight: '700' },
  body: { color: colors.muted, fontSize: 13, marginTop: 2, lineHeight: 18 },
  timer: { color: colors.warning, fontWeight: '800', fontSize: 18, fontVariant: ['tabular-nums'] },
  dot: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  dotDone: { borderColor: colors.success, backgroundColor: 'rgba(46,211,160,0.12)' },
  dotNow: { borderColor: colors.warning, backgroundColor: 'rgba(255,184,77,0.12)' },
  money: { marginTop: 12, borderRadius: radius.md, backgroundColor: colors.card, padding: 10 },
  total: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8, marginTop: 8 },
  link: { color: colors.primaryAlt, fontWeight: '600', textDecorationLine: 'underline' },
  receipt: { width: 140, height: 190, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
}));
