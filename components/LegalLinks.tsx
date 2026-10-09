import { Linking, Text } from 'react-native';
import { SITE_URL } from '@/lib/supabase';
import { colors, useTheme } from '@/lib/theme';

// Terms of Service and Privacy Policy (the same pages as the website). Both stores require them inside the app.
// `lead` adds a sentence in front, e.g. "By creating an account you agree to our".
export function LegalLinks({ lead, style }: { lead?: string; style?: object }) {
  useTheme();
  const link = { color: colors.primaryAlt, fontWeight: '600' as const };
  return (
    <Text style={[{ color: colors.muted, fontSize: 12, lineHeight: 18, textAlign: 'center' }, style]}>
      {lead ? `${lead} ` : ''}
      <Text style={link} accessibilityRole="link" onPress={() => Linking.openURL(`${SITE_URL}/terms`)}>Terms of Service</Text>
      {' and '}
      <Text style={link} accessibilityRole="link" onPress={() => Linking.openURL(`${SITE_URL}/privacy`)}>Privacy Policy</Text>
      .
    </Text>
  );
}
