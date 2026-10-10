import 'expo-sqlite/localStorage/install';
import { AppState } from 'react-native';
import { createClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY (copy .env.example to .env).');
}

export const supabase = createClient(url, key, {
  auth: {
    storage: localStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

AppState.addEventListener('change', (state) => {
  if (state === 'active') supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});

export const SITE_URL = process.env.EXPO_PUBLIC_SITE_URL ?? 'https://www.zafplay.com';

// Photos: the website's sample photos start with "/" and are served by the website;
// real uploads are paths inside the public "court-images" bucket.
export function photoUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  if (path.startsWith('/')) return `${SITE_URL}${path}`;
  return supabase.storage.from('court-images').getPublicUrl(path).data.publicUrl;
}

// Uploads a picked photo to Storage. supabase-js sends raw bytes (Blob, ArrayBuffer, typed arrays) from React Native as ~14
// junk bytes, so this posts the file as a multipart part from its uri, which React Native streams natively.
export async function uploadPhoto(bucket: string, path: string, uri: string, mimeType: string): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  const form = new FormData();
  form.append('cacheControl', '3600');
  form.append('file', { uri, name: path.split('/').pop() || 'photo.jpg', type: mimeType } as any);
  const res = await fetch(`${url}/storage/v1/object/${bucket}/${path}`, {
    method: 'POST',
    headers: { apikey: key as string, Authorization: `Bearer ${data.session?.access_token ?? key}`, 'x-upsert': 'false' },
    body: form,
  });
  if (res.ok) return null;
  try { return (await res.json()).message ?? `HTTP ${res.status}`; } catch { return `HTTP ${res.status}`; }
}
