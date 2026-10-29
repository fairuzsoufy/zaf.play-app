import React, { createContext, useContext, useEffect, useState } from 'react';
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

  return <AuthContext.Provider value={{ session, loading }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

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
