import { useState } from 'react';
import { View } from 'react-native';
import { Text } from '@/components/AppText';
import { supabase } from '@/lib/supabase';
import { dateTimeText, egp, whenText } from '@/lib/format';
import { isMoved } from '@/lib/refundKind';
import { colors } from '@/lib/theme';
import { LinkButton } from './owner';

// Ported from the website's PlayerHistory (admin).
type Ev = { at: string; icon: string; text: string; tone: 'normal' | 'good' | 'bad' | 'wait'; bookingId: string }

const BOOKING_COLS = `id, created_at, start_time, end_time, status, payment_status, total_price, discount_amount, amount_due,
  credit_amount, credit_used, credit_issued, rescheduled_from, retained_amount, refund_amount, refund_fee, refund_status, refund_to,
  refunded_at, cancelled_at, cancelled_by, cancellation_reason, booking_source, moved_to,
  change_refund_amount, change_refund_fee, change_refund_status, change_refunded_at, booking_extras ( name, qty ),
  court:courts ( name, facility:facilities ( name ) ), sport:sports ( name )`

const n = (v: any) => Number(v || 0)
const extrasOf = (b: { booking_extras?: { name: string; qty: number }[] | null }) =>
  (b.booking_extras || []).map((x) => `${x.name} × ${x.qty}`).join(', ')
const place = (b: any) => `${b.court?.facility?.name || ''} — ${b.court?.name || ''}`.replace(/^ — /, '')

// Everything this player did, newest first: bookings, time changes (and the difference paid or refunded),
// screenshots and how each one was reviewed, cancellations, refunds and credit.
// `currentBookingId` = the booking in the card the admin is looking at (its lines are marked).
export function PlayerHistory({ userId, bookingId, name, currentBookingId }: { userId?: string; bookingId?: string; name: string; currentBookingId?: string }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [events, setEvents] = useState<Ev[] | null>(null)
  const [totals, setTotals] = useState({ bookings: 0, changes: 0, cancelled: 0, paid: 0 })
  const [shown, setShown] = useState(15)
  const [mine, setMine] = useState<Set<string>>(new Set())

  async function load() {
    setLoading(true)
    setError('')
    let uid = userId || ''
    if (!uid && bookingId) {
      const { data: one }: { data: any } = await supabase.from('bookings').select('user_id').eq('id', bookingId).single()
      uid = one?.user_id || ''
    }
    if (!uid) {
      setLoading(false)
      setError('Could not find this player.')
      return
    }
    const { data: bk, error: e1 }: { data: any; error: { message: string } | null } = await supabase
      .from('bookings')
      .select(BOOKING_COLS)
      .eq('user_id', uid)
      .order('created_at', { ascending: false })
      .limit(60)
    if (e1) {
      setLoading(false)
      setError(`Could not load the history: ${e1.message}`)
      return
    }
    const rows: any[] = bk || []
    const ids = rows.map((b) => b.id)
    const { data: pay }: { data: any } = ids.length
      ? await supabase.from('payments').select('id, booking_id, amount, kind, status, created_at, reviewed_at, reject_reason').in('booking_id', ids)
      : { data: [] }
    const byId: Record<string, any> = Object.fromEntries(rows.map((b) => [b.id, b]))

    // the booking in the card + every earlier version of it
    const chain = new Set<string>()
    let cur = currentBookingId ? byId[currentBookingId] : null
    while (cur && !chain.has(cur.id)) {
      chain.add(cur.id)
      cur = cur.rescheduled_from ? byId[cur.rescheduled_from] : null
    }
    // ...and every later version (time changes made after it)
    let grew = true
    while (grew) {
      grew = false
      for (const b of rows) if (b.rescheduled_from && chain.has(b.rescheduled_from) && !chain.has(b.id)) { chain.add(b.id); grew = true }
    }
    setMine(chain)

    const ev: Ev[] = []
    let paid = 0
    for (const b of rows) {
      const when = whenText(b.start_time, b.end_time)
      const parent = b.rescheduled_from ? byId[b.rescheduled_from] : null
      if (b.booking_source && b.booking_source !== 'player') continue // owner-made bookings aren't the player's own

      const dropped = !!b.rescheduled_from && b.payment_status === 'unpaid' && b.status === 'cancelled'
      if (dropped) {
        ev.push({
          at: b.created_at,
          icon: '⌛',
          bookingId: b.id,
          tone: 'normal',
          text: `Started a change to ${when} (${place(b)}) but didn't pay the difference in time. The booking stayed as it was.`,
        })
        continue
      }
      if (parent || b.rescheduled_from) {
        const extra = n(b.amount_due)
        // after a cancellation the booking's own refund fields hold the cancellation; the change refund is kept aside
        const back = b.status === 'cancelled' && !isMoved(b) ? n(b.change_refund_amount) : n(b.refund_amount)
        const same = parent && parent.start_time === b.start_time && parent.end_time === b.end_time
        const ex = extrasOf(b)
        const exChanged = parent && extrasOf(parent) !== ex
        ev.push({
          at: b.created_at,
          icon: '🔁',
          bookingId: b.id,
          tone: 'normal',
          text:
            (same
              ? `Changed the extras only (same time, ${when}, ${place(b)})${ex ? `: now ${ex}` : ': removed them'}. `
              : `Changed the time${parent ? ` from ${whenText(parent.start_time, parent.end_time)}` : ''} to ${when} (${place(b)})${exChanged ? `, extras now ${ex || 'none'}` : ''}. `) +
            `New price ${egp(n(b.total_price))}, ${egp(n(b.credit_amount))} carried over from the old booking` +
            (extra > 0 ? `, ${egp(extra)} extra to pay.` : back > 0 ? `, ${egp(back)} of the difference goes back to the player.` : ', nothing extra to pay.'),
        })
        if (b.change_refund_status === 'refunded' && n(b.change_refund_amount) > 0) {
          ev.push({
            at: b.change_refunded_at || b.created_at,
            icon: '💸',
            bookingId: b.id,
            tone: 'good',
            text: `Refund of the difference ${egp(n(b.change_refund_amount))} sent${b.refund_to ? ` to ${b.refund_to}` : ''} · ${when}`,
          })
        }
      } else {
        ev.push({
          at: b.created_at,
          icon: '🆕',
          bookingId: b.id,
          tone: 'normal',
          text:
            `Booked ${place(b)} · ${b.sport?.name || ''} · ${when} · ${egp(n(b.total_price) - n(b.discount_amount))}` +
            (n(b.credit_used) > 0 ? ` (${egp(n(b.credit_used))} paid with credit)` : ''),
        })
      }

      if (b.status === 'cancelled' && !isMoved(b)) {
        const unpaid = b.payment_status !== 'paid' && !(pay || []).some((p: any) => p.booking_id === b.id && p.status === 'approved')
        ev.push({
          at: b.cancelled_at || b.created_at,
          icon: '✖',
          bookingId: b.id,
          tone: 'bad',
          text:
            `Cancelled ${place(b)} · ${when}` +
            (b.cancelled_by ? ` (by ${b.cancelled_by})` : '') +
            (b.cancellation_reason ? `: ${b.cancellation_reason}` : unpaid ? ': never paid' : '') +
            (n(b.retained_amount) > 0 ? ` · ${egp(n(b.retained_amount))} kept as late fee` : '') +
            (n(b.credit_issued) > 0 ? ` · ${egp(n(b.credit_issued))} added to credit` : ''),
        })
      }
      if (b.status === 'no_show') {
        ev.push({ at: b.end_time, icon: '🚫', bookingId: b.id, tone: 'bad', text: `Marked as a no-show: ${place(b)} · ${when}` })
      }
      if (n(b.refund_amount) > 0 && b.refund_status === 'refunded') {
        ev.push({
          at: b.refunded_at || b.created_at,
          icon: '💸',
          bookingId: b.id,
          tone: 'good',
          text:
            `Refund of ${egp(n(b.refund_amount))} sent${b.refund_to ? ` to ${b.refund_to}` : ''}${n(b.refund_fee) > 0 ? ` (after ${egp(n(b.refund_fee))} InstaPay fee)` : ''} · ${when}` +
            (b.change_refund_status === 'merged' ? ` · one transfer that also covers ${egp(n(b.change_refund_amount))} from the earlier change` : ''),
        })
      } else if (n(b.refund_amount) > 0 && b.refund_status === 'due') {
        ev.push({
          at: b.cancelled_at || b.created_at,
          icon: '⏳',
          bookingId: b.id,
          tone: 'wait',
          text: `Refund of ${egp(n(b.refund_amount))} still to send${b.refund_to ? ` to ${b.refund_to}` : ''} · ${when}`,
        })
      }
    }

    for (const p of pay || []) {
      const b = byId[p.booking_id]
      if (!b || (b.booking_source && b.booking_source !== 'player')) continue
      const what = p.kind === 'reschedule' ? 'extra payment for a time change' : 'booking payment'
      ev.push({
        at: p.created_at,
        icon: '📎',
        bookingId: b.id,
        tone: p.status === 'pending' ? 'wait' : 'normal',
        text: `Sent a screenshot of ${egp(n(p.amount))} (${what}) · ${whenText(b.start_time, b.end_time)}${p.status === 'pending' ? ' — waiting for review' : ''}`,
      })
      if (p.status === 'approved' && p.reviewed_at) {
        paid += n(p.amount)
        ev.push({ at: p.reviewed_at, icon: '✓', bookingId: b.id, tone: 'good', text: `Payment of ${egp(n(p.amount))} approved (${what})` })
      } else if (p.status === 'rejected' && p.reviewed_at) {
        ev.push({
          at: p.reviewed_at,
          icon: '✖',
          bookingId: b.id,
          tone: 'bad',
          text: `Payment of ${egp(n(p.amount))} rejected (${what})${p.reject_reason ? `: ${p.reject_reason}` : ''}`,
        })
      }
    }

    ev.sort((a, c) => new Date(c.at).getTime() - new Date(a.at).getTime())
    // opened from a booking card: only that booking's own history (Fairuz, 17 Oct)
    setEvents(currentBookingId ? ev.filter((e) => chain.has(e.bookingId)) : ev)
    setTotals({
      bookings: rows.filter((b) => !b.rescheduled_from && (!b.booking_source || b.booking_source === 'player')).length,
      changes: rows.filter((b) => b.rescheduled_from && !(b.payment_status === 'unpaid' && b.status === 'cancelled')).length,
      cancelled: rows.filter((b) => b.status === 'cancelled' && !isMoved(b) && ['paid', 'refunded'].includes(b.payment_status)).length,
      paid,
    })
    setLoading(false)
  }

  function toggle() {
    const next = !open
    setOpen(next)
    if (next && events === null && !loading) load()
  }

  const toneColor = (t: Ev['tone']) => (t === 'bad' ? colors.danger : t === 'good' ? colors.success : t === 'wait' ? colors.warning : colors.text)
  return (
    <View style={{ marginTop: 6 }}>
      <LinkButton title={`${open ? '▾' : '▸'} ${currentBookingId ? `History of this booking (${name})` : `History of ${name}`}`} onPress={toggle} />
      {open && (
        <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 10, marginTop: 4 }}>
          {loading && <Text style={{ color: colors.muted }}>Loading...</Text>}
          {!!error && <Text style={{ color: colors.danger }}>{error}</Text>}
          {events && (
            <>
              {!currentBookingId && (
                <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 6 }}>
                  {totals.bookings} booking{totals.bookings === 1 ? '' : 's'} · {totals.changes} time change{totals.changes === 1 ? '' : 's'} · {totals.cancelled} cancelled after paying · {egp(totals.paid)} approved in total
                </Text>
              )}
              {events.length === 0 ? <Text style={{ color: colors.muted }}>Nothing yet.</Text> : events.slice(0, shown).map((e, i) => (
                <View key={i} style={{ flexDirection: 'row', gap: 6, marginBottom: 6, opacity: mine.has(e.bookingId) || !currentBookingId ? 1 : 0.7 }}>
                  <Text style={{ width: 20, textAlign: 'center' }}>{e.icon}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: toneColor(e.tone), fontSize: 13 }}>{e.text}</Text>
                    <Text style={{ color: colors.muted, fontSize: 11 }}>{dateTimeText(e.at)}</Text>
                  </View>
                </View>
              ))}
              {events.length > shown && <LinkButton title="Show more" onPress={() => setShown(shown + 15)} />}
            </>
          )}
        </View>
      )}
    </View>
  )
}
