// Payment settings, same numbers as the website (lib/payment.ts there) and the database functions.
export const ZAF_INSTAPAY_LINK = 'https://ipn.eg/S/fairuz93/instapay/2wbGDJ';
export const HOLD_MINUTES = 5; // the slot is held this long for the screenshot
export const REVIEW_MINUTES = 15; // Zaf Play checks a screenshot within this time
export const FREE_CHANGE_HOURS = 3;
export const MAX_PROOFS = 2;
export const MAX_PROOF_MB = 5;

// an 11-digit Egyptian mobile or an https:// InstaPay link (refunds go there)
export const isEgyptMobile = (v: string) => /^01[0125]\d{8}$/.test(v);
export const isInstapay = (v: string) => isEgyptMobile(v.trim()) || /^https:\/\/\S+$/i.test(v.trim());
export function cleanInstapay(value: string) {
  const v = value.replace(/\s/g, '');
  return /^\d/.test(v) ? v.replace(/\D/g, '').slice(0, 11) : v;
}
export const INSTAPAY_HELP = 'An 11-digit mobile number (01xxxxxxxxx) or your InstaPay link (https://...).';

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

// Moving a paid booking to a new time: the late fee is kept when the change is inside the free-change window.
export function rescheduleCredit(total: number, feePercent: number, late: boolean) {
  return late ? Math.round(total * (100 - feePercent)) / 100 : total;
}
