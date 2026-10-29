import { getRandomValues } from 'expo-crypto';
import { gcm } from '@noble/ciphers/aes.js';
import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';

// The same scrambling as the website's lib/passphraseCrypto (AES-256-GCM, key from PBKDF2-SHA256, 310,000 rounds),
// in plain JavaScript because phones have no WebCrypto. Notes sealed on either one open on the other.
const ITERATIONS = 310000;
const enc = new TextEncoder();
const dec = new TextDecoder();

const toB64 = (bytes: Uint8Array) => {
  let s = '';
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s);
};
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export type Sealed = { salt: string; iv: string; data: string };

export const deriveKey = (pass: string, salt: Uint8Array) => pbkdf2Async(sha256, enc.encode(pass), salt, { c: ITERATIONS, dkLen: 32, asyncTick: 20 });

export const newSalt = () => getRandomValues(new Uint8Array(16));

export function seal(text: string, key: Uint8Array, salt: Uint8Array): Sealed {
  const iv = getRandomValues(new Uint8Array(12));
  const cipher = gcm(key, iv).encrypt(enc.encode(text));
  return { salt: toB64(salt), iv: toB64(iv), data: toB64(cipher) };
}

// throws if the passphrase is wrong
export async function open(sealed: Sealed, pass: string): Promise<{ text: string; key: Uint8Array; salt: Uint8Array }> {
  const salt = fromB64(sealed.salt);
  const key = await deriveKey(pass, salt);
  const plain = gcm(key, fromB64(sealed.iv)).decrypt(fromB64(sealed.data));
  return { text: dec.decode(plain), key, salt };
}
