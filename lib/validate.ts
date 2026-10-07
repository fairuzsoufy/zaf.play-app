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
