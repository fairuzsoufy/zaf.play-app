import { supabase } from '@/lib/supabase';

// What sign-up does with an email that already has something on Zaf Play (the website's lib/signupEmail.ts).
// Supabase never starts a second sign-up for the same email: while the first one waits for its code it only
// re-sends that code, keeping the first role. So the form says so first.
export type SignupEmailCheck = { ok: true } | { ok: false; text: string };

const CO_OWNER_TEXT = "This email was added as a court co-owner on Zaf Play, so it can't be used for a new account. You'll get an invite email once that account is approved. If you think this is a mistake, email us at support@zafplay.com or message us on Instagram @zaf.play.";

export async function checkSignupEmail(email: string, as: 'player' | 'owner'): Promise<SignupEmailCheck> {
  const { data, error } = await supabase.rpc('signup_email_state', { p_email: email.trim() });
  if (error) {
    if (error.message.includes('too_many_requests')) return { ok: false, text: 'Too many tries from this connection. Please wait a few minutes and try again.' };
    return { ok: true }; // the check could not run: Supabase still refuses a confirmed email
  }
  const state = String(data || 'new');
  if (state === 'confirmed') return { ok: false, text: 'This email already has a Zaf Play account. Please log in instead.' };
  if (state === 'co_owner') return { ok: false, text: CO_OWNER_TEXT };
  if (state === 'staff') return { ok: false, text: 'This email was invited to a court owner’s team. Open the invite email to finish setting up that account.' };
  if (state === 'pending_player' || state === 'pending_owner') {
    const other = state === 'pending_owner' ? 'owner' : 'player';
    if (other === as) return { ok: true }; // same kind of account: a new code is sent for it
    return {
      ok: false,
      text: other === 'owner'
        ? 'This email already started a court owner sign-up and is waiting for its code. One email can only have one Zaf Play account. Finish that sign-up on zafplay.com (an owner account can also book courts as a player), or use a different email here.'
        : 'This email already started a player sign-up and is waiting for its code. One email can only have one Zaf Play account, so use a different email for your business, or finish the player sign-up first. Unfinished sign-ups are removed after 24 hours.',
    };
  }
  return { ok: true };
}
