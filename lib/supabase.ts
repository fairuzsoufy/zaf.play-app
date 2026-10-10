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

// Uploads a picked photo to Storage. In Expo the global fetch() is Expo's own, which sends picked photos as ~14 junk bytes
// and rejects React Native file parts ("Unsupported FormDataPart implementation"). React Native's own XMLHttpRequest
// streams a { uri, name, type } multipart part straight from the file, so the upload goes through that.
export async function uploadPhoto(bucket: string, path: string, uri: string, mimeType: string): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  const form = new FormData();
  form.append('cacheControl', '3600');
  form.append('file', { uri, name: path.split('/').pop() || 'photo.jpg', type: mimeType } as any);
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${url}/storage/v1/object/${bucket}/${path}`);
    xhr.setRequestHeader('apikey', key as string);
    xhr.setRequestHeader('Authorization', `Bearer ${data.session?.access_token ?? key}`);
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve(null);
      try { resolve(JSON.parse(xhr.responseText).message ?? `HTTP ${xhr.status}`); } catch { resolve(`HTTP ${xhr.status}`); }
    };
    xhr.onerror = () => resolve('Network error, please try again.');
    xhr.send(form);
  });
}
