// Input checks, same rules as the website (lib/validate.ts there).
export function isFullName(value: string) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  return words.length >= 2 && words.every((w) => /^[A-Za-z؀-ۿ'’-]{2,}$/.test(w));
}
export const FULL_NAME_HELP = 'Please enter your first and last name (letters only).';
export const onlyDigits = (v: string, max = 11) => v.replace(/\D/g, '').slice(0, max);
export const isEgyptMobile = (v: string) => /^01[0125]\d{8}$/.test(v);
export const PHONE_HELP = 'Please enter an 11-digit mobile number, e.g. 01012345678.';
export const USERNAME_RE = /^[a-z0-9_.]{3,20}$/;

export function capitalizeWords(value: string) {
  return value.trim().replace(/\s+/g, ' ').replace(/(^|[\s\-/(])([a-z])/g, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

// "Ahmed Hassan" -> ahmedhassan, then ahmedhassan1, 2, ... until one is free
export function usernameBase(fullName: string) {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  const clean = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  let base = clean(words[0]) + (words.length > 1 ? clean(words[words.length - 1]) : '');
  if (base.length < 3) base = 'player' + base;
  return base.slice(0, 20);
}

// same password rule as the website (lib/validate.ts there)
const PASSWORD_MIN = 8;
export function passwordProblem(value: string): string {
  if (value.length < PASSWORD_MIN) return `Your password needs at least ${PASSWORD_MIN} characters.`;
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) return 'Your password needs at least one letter and one number.';
  if (/^(.)\1+$/.test(value) || /^(?:12345678|password1|qwerty12|abc12345|zafplay1)/i.test(value)) return 'This password is too easy to guess. Please choose another one.';
  return '';
}

// owner text (branch, court, extras) is English only, the same as the website
export const isEnglishText = (value: string) => /^[A-Za-z0-9\s.,'’&()\-\/#:+!?@]*$/.test(value);
export const ENGLISH_HELP = 'Please write this in English (letters A–Z, numbers and simple punctuation).';

// A rental extra or fixed fee: same rules as the database (owner_save_extra and the court_extras price check).
const MAX_EXTRA_PRICE = 5000;
export const cleanExtraName = (value: string) => value.replace(/[’‘`]/g, "'").replace(/\s+/g, ' ').trim();
export function extraProblem(name: string, price: string): string | null {
  const n = cleanExtraName(name);
  if (!/^[A-Za-z0-9 .,'&()\/+-]{2,40}$/.test(n))
    return `Extras: "${n || 'the extra'}" needs a name in English, 2 to 40 letters (letters, numbers and . , ' & ( ) / + - only).`;
  if (!/^\d+(\.\d{1,2})?$/.test(price.trim()) || !(Number(price) > 0) || Number(price) > MAX_EXTRA_PRICE)
    return `Extras: the price of "${n}" must be a number above 0 and up to ${MAX_EXTRA_PRICE} EGP.`;
  return null;
}
