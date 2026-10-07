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
export async function signIn(identifier: string, password: string): Promise<string | null> {
  const GENERIC = 'Wrong email, username or password.';
  const id = identifier.trim();
  if (!id || !password) return 'Type your email or username and your password.';
  let email = id;
  if (!id.includes('@') || id.startsWith('@')) {
    const { data, error } = await supabase.rpc('login_email', {
      p_username: id.replace(/^@/, '').toLowerCase(),
      p_password: password,
    });
    if (error?.message.includes('too_many_attempts')) {
      return 'Too many wrong tries. Please wait 15 minutes or reset your password.';
    }
    if (error || !data) return GENERIC;
    email = data as string;
  }
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (!error) return null;
  if (error.code === 'email_not_confirmed' || /not confirmed/i.test(error.message)) {
    return 'Your email is not confirmed yet. Tap the button in the email we sent you.';
  }
  return GENERIC;
}
