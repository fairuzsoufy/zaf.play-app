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
