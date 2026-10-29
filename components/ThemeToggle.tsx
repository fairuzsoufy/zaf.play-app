import { Pressable, View } from 'react-native';
import { Text } from '@/components/AppText';
import { colors, radius, useTheme, type Choice } from '@/lib/theme';
import { Icon } from './Icon';

// Sun / moon button, like the website's top bar: switches between light and dark mode (remembered on this phone).
export function ThemeToggle({ size = 22 }: { size?: number }) {
  const { scheme, setScheme } = useTheme();
  const next = scheme === 'dark' ? 'light' : 'dark';
  return (
    <Pressable
      onPress={() => setScheme(next)}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={`Switch to ${next} mode`}
      style={({ pressed }) => ({
        width: size + 18, height: size + 18, borderRadius: (size + 18) / 2, alignItems: 'center', justifyContent: 'center',
        borderWidth: 1, borderColor: colors.border, backgroundColor: pressed ? colors.cardAlt : colors.card,
      })}
    >
      <Icon name={scheme === 'dark' ? 'sun' : 'moon'} color={colors.text} size={size - 2} />
    </Pressable>
  );
}

// Profile's "Appearance" row: follow the phone, or always light / always dark.
export function ThemePicker() {
  const { choice, setScheme } = useTheme();
  const opts: [Choice, string][] = [['system', 'Phone setting'], ['light', 'Light'], ['dark', 'Dark']];
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={{ color: colors.muted, fontSize: 13, fontWeight: '600', marginBottom: 6 }}>Appearance</Text>
      <View style={{ flexDirection: 'row', backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 4 }}>
        {opts.map(([c, label]) => {
          const on = choice === c;
          return (
            <Pressable key={c} onPress={() => setScheme(c)} accessibilityRole="button" accessibilityState={{ selected: on }}
              style={{ flex: 1, paddingVertical: 10, borderRadius: radius.sm, alignItems: 'center', backgroundColor: on ? colors.soft : 'transparent' }}>
              <Text style={{ color: on ? colors.text : colors.muted, fontWeight: on ? '700' : '500' }}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
