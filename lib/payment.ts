// Payment settings, same numbers as the website (lib/payment.ts there) and the database functions.
export const ZAF_INSTAPAY_LINK = 'https://ipn.eg/S/fairuz93/instapay/2wbGDJ';
export const HOLD_MINUTES = 5; // the slot is held this long for the screenshot
export const REVIEW_MINUTES = 15; // Zaf Play checks a screenshot within this time
export const FREE_CHANGE_HOURS = 3;
export const MAX_PROOFS = 2;
export const MAX_PROOF_MB = 5;

// refunds go to the player's InstaPay mobile number: 11 digits, numbers only
export const isEgyptMobile = (v: string) => /^01[0125]\d{8}$/.test(v);
export const isInstapay = (v: string) => isEgyptMobile(v.trim());
export const cleanInstapay = (value: string) => value.replace(/\D/g, '').slice(0, 11);
export const INSTAPAY_HELP = 'The 11-digit mobile number on your InstaPay (01xxxxxxxxx).';

// InstaPay charges the SENDER 0.1% (min 0.50, max 20 EGP), so we send a little less and the receiver pays it.
// Same maths as the database (private.instapay_send_amount / private.instapay_fee).
export const INSTAPAY_FEE_TEXT = '0.1%, min 0.50 EGP, max 20 EGP';
export function instapaySendAmount(total: number) {
  if (!(total > 0.5)) return 0;
  const send = total <= 500.5 ? total - 0.5 : total < 20020 ? Math.floor((total / 1.001) * 100) / 100 : total - 20;
  return Math.round(send * 100) / 100;
}
export function instapayFee(total: number) {
  if (!(total > 0)) return 0;
  return Math.round((total - instapaySendAmount(total)) * 100) / 100;
}
export const isLate = (start: string | Date) => Date.now() > new Date(start).getTime() - FREE_CHANGE_HOURS * 3600 * 1000;

// What a cancellation gives back (same maths as the database): credit paid goes back as credit, the rest by InstaPay.
export function cancelSplitPreview(total: number, feePercent: number, late: boolean, creditUsed = 0) {
  const kept = late ? Math.round(total * feePercent) / 100 : 0;
  const value = Math.round((total - kept) * 100) / 100;
  const creditBack = Math.min(Math.max(creditUsed, 0), value);
  const cash = Math.round((value - creditBack) * 100) / 100;
  const transferFee = instapayFee(cash);
  return { kept, value, creditBack, transferFee, refund: Math.round((cash - transferFee) * 100) / 100, allAsCredit: value };
}

// Moving a booking: what you paid counts toward the new time; a late move (within FREE_CHANGE_HOURS) keeps the court's fee.
export function rescheduleCredit(total: number, feePercent: number, late: boolean) {
  return late ? Math.round(total * (100 - feePercent)) / 100 : total;
}

// after a booking is confirmed, its date/time can be changed for free for this long (even if late) — same as the website
export const FREE_CHANGE_MINUTES = 10;
// Milliseconds left of the free change window: the first FREE_CHANGE_MINUTES after the ORIGINAL booking was confirmed
// (a booking that is itself a change has no new window). Same rule as the database (reschedule_booking). 0 = no window.
export function freeChangeLeftMs(b: { confirmed_at?: string | null; rescheduled_from?: string | null; start_time?: string | null }, nowMs = Date.now()) {
  if (!b.confirmed_at || b.rescheduled_from) return 0;
  if (b.start_time && new Date(b.start_time).getTime() <= nowMs) return 0;
  return Math.max(0, new Date(b.confirmed_at).getTime() + FREE_CHANGE_MINUTES * 60000 - nowMs);
}
