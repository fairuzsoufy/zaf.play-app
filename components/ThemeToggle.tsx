import { Pressable } from 'react-native';
import { colors, useTheme } from '@/lib/theme';
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
