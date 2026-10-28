import { egp } from './format'

// What kind of refund a booking has: full, partial (late fee kept), partial (booking shortened) or none.
// Used by the admin and owner screens so both can tell at a glance. Amounts come from the booking row.
export type RefundKind = 'full' | 'partial_late' | 'partial_shortened' | 'none'

export type RefundInfo = {
  kind: RefundKind
  label: string
  tone: 'green' | 'amber' | 'red'
  detail: string
  refund: number
  fee: number // InstaPay transfer fee taken out of the refund
  kept: number // late cancellation fee kept
  sent: boolean
  due: boolean
}

type BookingLike = {
  status?: string
  cancelled_by?: string | null
  cancellation_reason?: string | null
  retained_amount?: number | string | null
  refund_amount?: number | string | null
  refund_fee?: number | string | null
  refund_status?: string | null
  rescheduled_from?: string | null
  moved_to?: string | null
}

// The old version of a booking the player changed (new time or extras): it lives on inside the new booking's
// history and is never a cancellation of its own.
export function isMoved(b: BookingLike): boolean {
  return b.status === 'cancelled' && (!!b.moved_to || /^(Rescheduled|Extended|Extras changed)/.test(b.cancellation_reason || ''))
}

const n = (v: unknown) => Number(v || 0)

export function refundInfo(b: BookingLike): RefundInfo | null {
  const refund = n(b.refund_amount)
  const fee = n(b.refund_fee)
  const kept = n(b.retained_amount)
  const sent = b.refund_status === 'refunded'
  const due = b.refund_status === 'due'

  // the player moved to a cheaper time: the booking stays, only the difference is refunded
  if (b.rescheduled_from && b.status !== 'cancelled') {
    if (refund <= 0) return null
    return {
      kind: 'partial_shortened',
      label: 'Partial refund · booking shortened',
      tone: 'amber',
      detail: `The player changed to a shorter/cheaper time. Only the difference is refunded (${egp(refund + fee)} before the InstaPay fee). The booking itself stays.`,
      refund, fee, kept, sent, due,
    }
  }

  if (b.status !== 'cancelled' || isMoved(b)) return null

  if (refund <= 0) {
    if (kept <= 0) return null
    return {
      kind: 'none',
      label: 'No refund',
      tone: 'red',
      detail: `The whole amount (${egp(kept)}) was kept as the late cancellation fee.`,
      refund, fee, kept, sent, due,
    }
  }
  if (kept > 0) {
    return {
      kind: 'partial_late',
      label: 'Partial refund · late cancellation',
      tone: 'amber',
      detail: `${egp(kept)} kept as the late cancellation fee. The rest is refunded.`,
      refund, fee, kept, sent, due,
    }
  }
  return {
    kind: 'full',
    label: 'Full refund',
    tone: 'green',
    detail:
      b.cancelled_by === 'owner'
        ? 'Nothing kept. The court owner cancelled, so the player gets everything back (the InstaPay fee is charged to the owner).'
        : b.cancelled_by === 'admin'
        ? `Nothing kept. ${cancelReasonText(b) || 'Zaf Play cancelled this booking'}, so the player gets everything back.`
        : 'Nothing kept. The player gets everything back (minus the InstaPay transfer fee).',
    refund, fee, kept, sent, due,
  }
}

const BLOCK_PREFIX = 'Your account was restricted: '

// Why the booking was cancelled, worded for admin and owner screens (the stored reason is written to the player).
// e.g. "Zaf Play cancelled it because the player was blocked (Missed bookings (no-shows))".
export function cancelReasonText(b: BookingLike): string {
  const reason = (b.cancellation_reason || '').trim()
  if (b.status !== 'cancelled' || !reason || isMoved(b)) return ''
  const by = b.cancelled_by === 'owner' ? 'The branch' : b.cancelled_by === 'player' ? 'The player' : 'Zaf Play'
  if (reason.startsWith(BLOCK_PREFIX)) {
    return `${by} cancelled it because the player was blocked (${reason.slice(BLOCK_PREFIX.length)})`
  }
  return `${by} cancelled it: ${reason}`
}

const who = (by?: string | null) => (by === 'owner' ? 'the court owner' : by === 'player' ? 'the player' : by === 'admin' ? 'Zaf Play' : 'the system')

// One plain sentence with the booking's status, worded the same for admin and owner.
export function bookingStatusText(b: BookingLike & { payment_status?: string; end_time?: string; cancel_request_status?: string | null }) {
  if (b.status === 'cancelled') {
    return isMoved(b) ? 'Changed (see the new version)' : `Cancelled by ${who(b.cancelled_by)}`
  }
  if (b.cancel_request_status === 'pending') return 'Cancellation requested — waiting for Zaf Play'
  if (b.status === 'pending' && b.payment_status === 'unpaid') return 'Awaiting payment'
  if (b.status === 'pending' && b.payment_status === 'pending_review') return 'Payment under review'
  if (b.status === 'no_show') return 'No-show'
  const played = b.status === 'completed' || (b.status === 'confirmed' && !!b.end_time && new Date(b.end_time).getTime() <= Date.now())
  if (played) return b.rescheduled_from ? 'Played (time was changed)' : 'Played'
  if (b.status === 'confirmed') return b.rescheduled_from ? 'Confirmed (time was changed)' : 'Confirmed'
  return b.status || ''
}
