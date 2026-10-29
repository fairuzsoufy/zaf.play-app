// Court plans: every court runs on a plan period (Trial period or Official partner).
// The numbers themselves live in the database table court_plans (read them with loadPlans()).
import { supabase } from './supabase';

export type Plan = { id: 'trial' | 'partner'; name: string; commission_percent: number; months: number }

export type Period = {
  id: string
  court_id: string
  plan: 'trial' | 'partner'
  commission_percent: number
  starts_at: string
  ends_at: string
  ended_at: string | null
  end_reason: string | null
  created_at: string
}

export type PlanRequest = {
  id: string
  court_id: string
  kind: 'renew' | 'stop'
  plan: 'trial' | 'partner' | null
  note: string | null
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn'
  reject_reason: string | null
  created_at: string
  reviewed_at: string | null
}

export const PLAN_NAMES: Record<string, string> = { trial: 'Trial period', partner: 'Official partner' }

// show "ends soon" warnings this many days before a court's last period ends
const ENDING_SOON_DAYS = 14

export async function loadPlans(): Promise<Record<string, Plan>> {
  const { data } = await supabase.from('court_plans').select('id, name, commission_percent, months').order('sort_order')
  const map: Record<string, Plan> = {}
  ;((data as Plan[]) || []).forEach((p) => (map[p.id] = { ...p, commission_percent: Number(p.commission_percent) }))
  return map
}

export function planDate(iso: string | null | undefined) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Cairo' })
}

// when a period really stopped (early stop wins over the planned end)
export function effectiveEnd(p: Period) {
  return p.ended_at && new Date(p.ended_at) < new Date(p.ends_at) ? p.ended_at : p.ends_at
}

export type PeriodState = 'current' | 'upcoming' | 'finished' | 'stopped' | 'cancelled'

export function periodState(p: Period, now = Date.now()): PeriodState {
  const start = new Date(p.starts_at).getTime()
  const end = new Date(p.ends_at).getTime()
  if (p.ended_at) {
    const stoppedAt = new Date(p.ended_at).getTime()
    if (stoppedAt <= start) return 'cancelled'
    if (stoppedAt < end) return 'stopped'
  }
  if (now < start) return 'upcoming'
  if (now >= end) return 'finished'
  return 'current'
}

export const STATE_LABEL: Record<PeriodState, string> = {
  current: 'Running now',
  upcoming: 'Starts next',
  finished: 'Finished',
  stopped: 'Stopped early',
  cancelled: 'Cancelled',
}

// a short summary of where a court stands, from its periods
export function courtPlanSummary(periods: Period[], now = Date.now()) {
  const sorted = [...periods].sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())
  const current = sorted.find((p) => periodState(p, now) === 'current') || null
  const upcoming = sorted.find((p) => periodState(p, now) === 'upcoming') || null
  const live = sorted.filter((p) => ['current', 'upcoming'].includes(periodState(p, now)))
  const until = live.length > 0 ? live[live.length - 1].ends_at : null
  const daysLeft = until ? Math.ceil((new Date(until).getTime() - now) / 86400000) : 0
  const history = sorted.filter((p) => !['current', 'upcoming'].includes(periodState(p, now))).reverse()
  return {
    current,
    upcoming,
    until, // players can book games until this moment
    isLive: !!current,
    daysLeft,
    endingSoon: !!current && !upcoming && daysLeft <= ENDING_SOON_DAYS,
    history,
  }
}
