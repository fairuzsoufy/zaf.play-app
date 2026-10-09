import 'expo-sqlite/localStorage/install';
import { AppState } from 'react-native';
import { createClient } from '@supabase/supabase-js';

// .env is not uploaded to EAS, so store builds fall back to the live project. Both values are public
// (the publishable key only allows what the database's row-level security allows).
const url = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://scqujegkjlzcxlkpzdbu.supabase.co';
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_9-87Ii7cNqw8fb3xOzLUaQ_5O_rtbkv';

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
