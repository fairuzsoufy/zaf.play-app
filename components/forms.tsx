import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { supabase } from '@/lib/supabase';
import { colors, radius } from '@/lib/theme';
import { USERNAME_RE } from '@/lib/validate';
import { Field, GradientFill } from './ui';

export type Gender = 'male' | 'female' | '';
export type UsernameStatus = '' | 'checking' | 'ok' | 'taken' | 'bad' | 'limit';

export function GenderField({ value, onChange }: { value: Gender; onChange: (g: Gender) => void }) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={{ color: colors.muted, marginBottom: 6, fontSize: 13 }}>Gender</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {(['male', 'female'] as const).map((g) => (
          <Pressable key={g} onPress={() => onChange(g)} style={{
            flex: 1, paddingVertical: 12, borderRadius: radius.md, alignItems: 'center', borderWidth: 1,
            borderColor: value === g ? 'transparent' : colors.border, backgroundColor: colors.card, overflow: 'hidden',
          }}>
            {value === g && <GradientFill />}
            <Text style={{ color: value === g ? '#fff' : colors.text, fontWeight: '600', textTransform: 'capitalize' }}>{g}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

// "@username" with a live availability check; `current` is the user's own (no check needed)
export function UsernameField({ value, onChange, onStatus, current = '', hint }: {
  value: string; onChange: (v: string) => void; onStatus: (s: UsernameStatus) => void; current?: string; hint?: string;
}) {
  const [status, setStatus] = useState<UsernameStatus>('');
  useEffect(() => {
    const u = value.trim();
    const set = (s: UsernameStatus) => { setStatus(s); onStatus(s); };
    if (!u || u === current) { set(''); return; }
    if (!USERNAME_RE.test(u)) { set('bad'); return; }
    const t = setTimeout(async () => {
      set('checking');
      const { data, error } = await supabase.rpc('username_available', { p_username: u });
      set(error ? 'limit' : data ? 'ok' : 'taken');
    }, 350);
    return () => clearTimeout(t);
  }, [value, current]); // eslint-disable-line react-hooks/exhaustive-deps
  const msg: Record<UsernameStatus, [string, string]> = {
    '': ['', colors.muted], checking: ['Checking...', colors.muted], ok: ['Available ✓', colors.success],
    taken: ['Taken, try another one.', colors.danger], limit: ['Too many checks. Please wait a few minutes.', colors.danger],
    bad: ['3–20 characters: letters, numbers, _ and .', colors.danger],
  };
  return (
    <View>
      <Field label="Username" value={value} onChangeText={(v) => onChange(v.toLowerCase().replace(/[^a-z0-9_.]/g, ''))}
        autoCapitalize="none" autoCorrect={false} maxLength={20} style={{ marginBottom: 0 }} />
      <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>{hint}</Text>
      <Text style={{ color: msg[status][1], fontSize: 12, marginBottom: 14, minHeight: 16 }}>{msg[status][0]}</Text>
    </View>
  );
}
