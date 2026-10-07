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

// Same rule as the website: anything with "@" is an email, anything else is a username
// that the database turns into an email (and counts wrong tries per username + IP).
export async function signIn(identifier: string, password: string): Promise<string | null> {
  const GENERIC = 'Wrong email, username or password.';
  const id = identifier.trim();
  if (!id || !password) return GENERIC;
  let email = id;
  if (!id.includes('@')) {
    const { data, error } = await supabase.rpc('login_email', {
      p_username: id.replace(/^@/, '').toLowerCase(),
      p_password: password,
    });
    if (error || !data) return GENERIC;
    email = data as string;
  }
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return error ? GENERIC : null;
}
