import React, { createContext, useContext, useEffect, useState } from 'react';
import { Alert, AppState } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

type AuthState = { session: Session | null; loading: boolean };
const AuthContext = createContext<AuthState>({ session: null, loading: true });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Same rules as the website: a login lasts 24 hours, and one account has one login at a time, so logging in
  // on another phone or browser ends this one. Checked every minute and whenever the app comes back to the front.
  useEffect(() => {
    if (!session) return;
    let ended = false;
    async function check() {
      if (ended || !session) return;
      const expired = loginExpired(session);
      let replaced = false;
      if (!expired) {
        const { data, error } = await supabase.rpc('my_login_is_current');
        replaced = !error && data === false;
      }
      if (!expired && !replaced) return;
      ended = true;
      await supabase.auth.signOut({ scope: 'local' });
      Alert.alert("You've been logged out", expired
        ? 'For your safety a login lasts 24 hours. Please log in again.'
        : 'Your account was logged in on another phone or browser, or your password or email changed. Please log in again.');
    }
    check();
    const t = setInterval(check, 60_000);
    const sub = AppState.addEventListener('change', (st) => st === 'active' && check());
    return () => { clearInterval(t); sub.remove(); };
  }, [session?.user.id, session?.access_token]);

  return <AuthContext.Provider value={{ session, loading }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

// when this login started: the access token keeps the original log-in time ("amr") through every refresh
function loginExpired(session: Session) {
  let started: number | null = null;
  try {
    const part = session.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(part.padEnd(part.length + ((4 - (part.length % 4)) % 4), '=')));
    const stamps = (claims.amr || []).map((a: { timestamp?: number }) => Number(a.timestamp)).filter((x: number) => x > 0);
    if (stamps.length) started = Math.min(...stamps) * 1000;
  } catch {}
  return started !== null && Date.now() - started >= 24 * 60 * 60 * 1000;
}

// Same rule as the website: anything with "@" in the middle is an email; anything else
// (with or without a leading "@") is a username that the database turns into an email.
// The database counts wrong tries per username and locks it for 15 minutes after 5.
// Login like the website: the server checks the password and counts wrong tries per account (login_check),
// then gives back the account's email to log in with. An email that is not confirmed yet comes back as
// `confirmEmail` so the login screen can send a fresh code.
export async function signIn(identifier: string, password: string): Promise<{ error?: string; confirmEmail?: string }> {
  const WRONG = 'Wrong email/username or password. Try again or tap "Forgot password?". Signed up with Google? Use "Continue with Google".';
  const id = identifier.trim();
  if (!id || !password) return { error: 'Type your email or username and your password.' };
  const { data, error: checkErr } = await supabase.rpc('login_check', { p_login: id, p_password: password });
  if (checkErr) {
    return { error: checkErr.message.includes('too_many_attempts')
      ? 'Too many wrong tries. Please wait 15 minutes or reset your password.'
      : 'Could not log you in right now. Please try again in a minute.' };
  }
  if (!data) return { error: WRONG };
  const email = data as string;
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (!error) return {};
  if (error.code === 'email_not_confirmed' || /not confirmed/i.test(error.message)) return { confirmEmail: email };
  return { error: error.message === 'Invalid login credentials' ? WRONG : 'Could not log you in right now. Please try again in a minute.' };
}
