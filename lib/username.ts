import { supabase } from './supabase';
import { usernameBase } from './validate';

export async function suggestUsername(fullName: string): Promise<string> {
  const base = usernameBase(fullName);
  if (!base) return '';
  const candidates = [base];
  for (let n = 1; n <= 60; n++) candidates.push(base.slice(0, 20 - String(n).length) + n);
  for (let i = 0; i < candidates.length; i += 6) {
    const batch = candidates.slice(i, i + 6);
    const answers = await Promise.all(batch.map(async (c) => (await supabase.rpc('username_available', { p_username: c })).data === true));
    const hit = answers.findIndex(Boolean);
    if (hit >= 0) return batch[hit];
  }
  return '';
}
