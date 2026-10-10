import { Tabs } from 'expo-router';
import { View, type ColorValue } from 'react-native';
import { colors, fonts, useTheme } from '@/lib/theme';
import { Icon, type IconName } from '@/components/Icon';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemeToggle } from '@/components/ThemeToggle';

// same line icons as the website's top bar
// the chosen tab sits on a soft pill with a small gradient bar under it
const icon = (name: IconName) => ({ color, focused }: { color: ColorValue; focused: boolean }) => (
  <View style={{ alignItems: 'center' }}>
    <View style={{ paddingHorizontal: 14, paddingVertical: 4, borderRadius: 999, backgroundColor: focused ? colors.soft : 'transparent' }}>
      <Icon name={name} color={color} size={23} strokeWidth={focused ? 2.3 : 1.8} />
    </View>
  </View>
);

const toggle = () => <View style={{ marginRight: 16 }}><ThemeToggle size={18} /></View>;

export default function TabsLayout() {
  useTheme();
  // Android draws under the system buttons: lift the tab bar above them
  const insets = useSafeAreaInsets();
  const bottom = Math.max(insets.bottom, 8);
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        headerTitleStyle: { fontFamily: fonts.display, fontSize: 24 },
        tabBarLabelStyle: { fontFamily: fonts.displaySemi, fontSize: 12 },
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border, paddingTop: 6, paddingBottom: bottom, height: 56 + bottom },
        headerRight: toggle,
        sceneStyle: { backgroundColor: colors.bg },
        tabBarActiveTintColor: colors.brandPink,
        tabBarInactiveTintColor: colors.muted,
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Play', headerShown: false, tabBarIcon: icon('ball') }} />
      <Tabs.Screen name="bookings" options={{ title: 'My bookings', tabBarIcon: icon('calendar') }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: icon('user') }} />
    </Tabs>
  );
}
