import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text, TextInput } from '@/components/AppText';
import { supabase } from '@/lib/supabase';
import { colors, radius, useTheme } from '@/lib/theme';

export type FoundPlayer = { id: string; full_name: string; username: string | null };

// Find another player by @username, email or phone number (exact email / phone, a username can be its start), like the website.
export function PlayerSearch({ onPick, exclude = [] }: { onPick: (p: FoundPlayer) => void; exclude?: string[] }) {
  const { scheme } = useTheme();
  const [q, setQ] = useState('');
  const [found, setFound] = useState<{ term: string; list: FoundPlayer[] } | null>(null);
  const skip = exclude.join(',');
  const term = q.trim();
  const results = found && found.term === term ? found.list : [];
  const searching = term.length >= 3 && !(found && found.term === term);

  useEffect(() => {
    if (term.length < 3) return;
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc('find_players', { p_query: term });
      setFound({ term, list: ((data as FoundPlayer[]) || []).filter((p) => !skip.split(',').includes(p.id)) });
    }, 300);
    return () => clearTimeout(t);
  }, [term, skip]);

  return (
    <View>
      <TextInput value={q} onChangeText={setQ} placeholder="@username, email or phone" placeholderTextColor={colors.muted} autoCapitalize="none"
        autoCorrect={false} keyboardAppearance={scheme} accessibilityLabel="Search for a player"
        style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, color: colors.text }} />
      {term.length >= 3 && (
        <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, marginTop: 4 }}>
          {searching && <Text style={{ color: colors.muted, padding: 10 }}>Searching...</Text>}
          {!searching && results.length === 0 && <Text style={{ color: colors.muted, padding: 10 }}>No player found. Emails and phone numbers must match exactly.</Text>}
          {results.map((p) => (
            <Pressable key={p.id} onPress={() => { onPick(p); setQ(''); }} style={{ padding: 10, borderTopWidth: 1, borderTopColor: colors.border }}>
              <Text style={{ color: colors.text }}>{p.full_name} {p.username ? <Text style={{ color: colors.muted }}>@{p.username}</Text> : null}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}
