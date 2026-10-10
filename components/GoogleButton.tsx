import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { colors, radius, useTheme } from '@/lib/theme';

WebBrowser.maybeCompleteAuthSession();

// the key=value pairs after "?" and "#" of the address Google sends back
function params(url: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of url.split(/[?#]/).slice(1).join('&').split('&')) {
    const [k, v = ''] = part.split('=');
    if (k) out[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' '));
  }
  return out;
}

// "Continue with Google", like the website: Google gives us the email and full name; the mobile number, gender
// and username are asked right after (on the profile), the same as the website's /complete-profile.
export function GoogleButton({ label = 'Continue with Google', onDone }: { label?: string; onDone?: () => void }) {
  useTheme();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function go() {
    setBusy(true);
    setError('');
    try {
      // where Google sends the player back: exp://…/--/auth/google in Expo Go, zafplay://auth/google in the app
      const redirectTo = Linking.createURL('auth/google');
      const { data, error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo, skipBrowserRedirect: true } });
      if (error || !data?.url) throw new Error('start');
      const res = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      if (res.type !== 'success') { setBusy(false); return; } // closed the window
      // the tokens come back after the "#" (or an error after "?")
      const back = params(res.url);
      const failed = back.error_description || back.error;
      const { access_token, refresh_token } = back;
      if (failed || !access_token || !refresh_token) throw new Error('return');
      const { data: s, error: e2 } = await supabase.auth.setSession({ access_token, refresh_token });
      if (e2 || !s.session) throw new Error('session');

      const { data: profile } = await supabase.from('users').select('role,phone,gender,username').eq('id', s.session.user.id).single();
      setBusy(false);
      onDone?.();
      if ((profile as any)?.role === 'player' && (!(profile as any)?.phone || !(profile as any)?.gender || !(profile as any)?.username)) {
        router.replace({ pathname: '/profile', params: { edit: '1', complete: '1' } });
      } else if (router.canGoBack()) router.back();
      else router.replace('/');
    } catch (e: any) {
      setBusy(false);
      setError(e?.message === 'start' ? 'Could not start Google sign-in. Please try again.' : 'Google sign-in was cancelled or did not work. Please try again.');
    }
  }

  return (
    <View style={{ marginBottom: 18 }}>
      <Pressable onPress={go} disabled={busy} accessibilityRole="button"
        style={({ pressed }) => ({
          flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 14, borderRadius: radius.md,
          borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: pressed ? colors.cardAlt : colors.card, opacity: busy ? 0.6 : 1,
        })}>
        <Svg width={18} height={18} viewBox="0 0 48 48">
          <Path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
          <Path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" />
          <Path fill="#FBBC05" d="M10.5 28.7a14.5 14.5 0 0 1 0-9.4l-7.9-6.1a24 24 0 0 0 0 21.6l7.9-6.1z" />
          <Path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
        </Svg>
        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 16 }}>{busy ? 'Opening Google...' : label}</Text>
      </Pressable>
      {error ? <Text style={{ color: colors.danger, marginTop: 8 }}>{error}</Text> : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 18 }}>
        <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
        <Text style={{ color: colors.muted, fontSize: 12 }}>or with your email</Text>
        <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
      </View>
    </View>
  );
}
