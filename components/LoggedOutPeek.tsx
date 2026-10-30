import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Text } from '@/components/AppText';
import { Button } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { colors, fonts, radius, themed, useTheme } from '@/lib/theme';

// Logged-out Bookings: faded sample cards fade into a glowing lock, one line on why, and Log in / Sign up.
// Same look as the website's LoggedOutPeek. Both buttons open the Profile tab, where the login form lives.
const cards = [
  { name: 'Padel · Smash Club', when: 'Thu · 8:00 PM · 1.5 h', chip: 'Confirmed', ok: true, from: '#2D5BFF', to: '#8A4BFF' },
  { name: 'Football 5-a-side', when: 'Sat · 9:30 PM · 1 h', chip: 'On hold', ok: false, from: '#FF3E8A', to: '#8A4BFF' },
  { name: 'Tennis · Court 3', when: 'Mon · 7:00 AM · 1 h', from: '#1FB38A', to: '#2D5BFF' },
];

export function LoggedOutPeek({ onLogin }: { onLogin: () => void }) {
  useTheme();
  const s = useS();
  return (
    <View style={s.wrap}>
      <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {cards.map((c) => (
          <View key={c.name} style={s.card}>
            <LinearGradient colors={[c.from, c.to]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.pic} />
            <View>
              <Text style={s.name}>{c.name}</Text>
              <Text style={s.when}>{c.when}</Text>
              {c.chip && <Text style={[s.chip, { color: c.ok ? colors.success : colors.brandPinkBright, backgroundColor: c.ok ? 'rgba(61,220,151,0.18)' : 'rgba(255,62,138,0.18)' }]}>{c.chip}</Text>}
            </View>
          </View>
        ))}
        <LinearGradient colors={['transparent', colors.bg]} locations={[0, 0.85]} style={s.fade} />
      </View>
      <View style={s.ask}>
        <LinearGradient colors={[colors.brandBlue, colors.brandPink]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.lock}>
          <Icon name="lock" color="#fff" size={24} />
        </LinearGradient>
        <Text style={s.title}>Log in to see your bookings</Text>
        <Text style={s.sub}>Your courts, games and refunds show up here.</Text>
        <View style={{ alignSelf: 'stretch' }}><Button title="Log in" onPress={onLogin} /></View>
        <Text style={s.signup} onPress={onLogin} accessibilityRole="link">New here? <Text style={{ color: colors.primary, fontWeight: '700' }}>Sign up</Text></Text>
      </View>
    </View>
  );
}

const useS = themed(() => StyleSheet.create({
  wrap: { padding: 20 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, marginBottom: 10, borderRadius: radius.lg, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, opacity: 0.55 },
  pic: { width: 56, height: 56, borderRadius: 12 },
  name: { color: colors.text, fontWeight: '700', fontSize: 15 },
  when: { color: colors.muted, fontSize: 12, marginTop: 2 },
  chip: { alignSelf: 'flex-start', fontSize: 11, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, overflow: 'hidden', marginTop: 5 },
  fade: { position: 'absolute', left: -4, right: -4, top: '30%', bottom: -4 },
  ask: { alignItems: 'center', marginTop: -56 },
  lock: { width: 52, height: 52, borderRadius: 16, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', marginBottom: 12, shadowColor: '#FF3E8A', shadowOpacity: 0.6, shadowRadius: 16, shadowOffset: { width: 0, height: 0 }, elevation: 8 },
  title: { color: colors.text, fontFamily: fonts.display, fontSize: 22, textAlign: 'center' },
  sub: { color: colors.muted, textAlign: 'center', marginTop: 6, marginBottom: 18 },
  signup: { color: colors.muted, marginTop: 14, fontSize: 15 },
}));
