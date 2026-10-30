import { Tabs } from 'expo-router';
import { View, type ColorValue } from 'react-native';
import { Text } from '@/components/AppText';
import { colors, fonts, useTheme } from '@/lib/theme';
import { Icon, type IconName } from '@/components/Icon';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// same line icons as the website's top bar
// the chosen tab sits on a soft pill with a small gradient bar under it
const icon = (name: IconName) => ({ color, focused }: { color: ColorValue; focused: boolean }) => (
  <View style={{ alignItems: 'center' }}>
    <View style={{ paddingHorizontal: 14, paddingVertical: 4, borderRadius: 999, backgroundColor: focused ? colors.soft : 'transparent' }}>
      <Icon name={name} color={color} size={23} strokeWidth={focused ? 2.3 : 1.8} />
    </View>
  </View>
);

// The label drawn by us: the slanted font is wider than Android measures it, so the default label gets cut to "Pro..."
// and short words lose their last letter on Samsung ("Pla"): a trailing space and a minimum width keep it whole
const label = (text: string) => ({ color }: { color: ColorValue }) => (
  <Text allowFontScaling={false} numberOfLines={1} style={{ color, fontFamily: fonts.displaySemi, fontSize: 12, marginTop: 2, paddingHorizontal: 6, minWidth: 64, textAlign: 'center' }}>{text}{' '}</Text>
);

export default function TabsLayout() {
  useTheme();
  // Android draws under the system buttons: lift the tab bar above them, with some breathing room
  const insets = useSafeAreaInsets();
  const bottom = insets.bottom + 10;
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        headerTitleStyle: { fontFamily: fonts.display, fontSize: 24, paddingRight: 6 },
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border, paddingTop: 8, paddingBottom: bottom, height: 60 + bottom },
        sceneStyle: { backgroundColor: colors.bg },
        tabBarActiveTintColor: colors.brandPink,
        tabBarInactiveTintColor: colors.muted,
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Play', headerShown: false, tabBarIcon: icon('ball'), tabBarLabel: label('Play') }} />
      <Tabs.Screen name="games" options={{ title: 'Games', tabBarIcon: icon('users'), tabBarLabel: label('Games') }} />
      <Tabs.Screen name="bookings" options={{ title: 'Bookings', tabBarIcon: icon('calendar'), tabBarLabel: label('Bookings') }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: icon('user'), tabBarLabel: label('Profile') }} />
    </Tabs>
  );
}
