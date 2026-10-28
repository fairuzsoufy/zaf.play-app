import { supabase } from './supabase';
import type { Access } from './access';

// The partner agreement an approved owner and each of their co-owners sign, the same as the website's lib/agreement.ts.
// The text of every version lives in the database; owners only see published versions.
export type AgreementVersion = { version: number; body: string; published_at: string | null };
export type AgreementSignature = { full_name: string; signed_at: string; version: number };

// The owner (once approved) and active co-owners sign. Sub-users never do.
export function isAgreementSigner(a: Access | null) {
  if (!a || a.status !== 'active') return false;
  return a.role === 'owner' || !!a.co_owner;
}

export async function loadLatestAgreement(): Promise<AgreementVersion | null> {
  const { data } = await supabase
    .from('owner_agreement_versions')
    .select('version, body, published_at')
    .not('published_at', 'is', null)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as AgreementVersion | null) || null;
}

export async function loadMySignature(userId: string, version: number): Promise<AgreementSignature | null> {
  const { data } = await supabase
    .from('owner_agreement_signatures')
    .select('full_name, signed_at, version')
    .eq('user_id', userId)
    .eq('version', version)
    .maybeSingle();
  return (data as AgreementSignature | null) || null;
}

export function signedDate(iso: string) {
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Africa/Cairo' });
}
