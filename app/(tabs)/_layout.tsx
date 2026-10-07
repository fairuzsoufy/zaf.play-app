import { Tabs } from 'expo-router';
import { View, type ColorValue } from 'react-native';
import { colors, useTheme } from '@/lib/theme';
import { Icon, type IconName } from '@/components/Icon';
import { ThemeToggle } from '@/components/ThemeToggle';

// same line icons as the website's top bar
const icon = (name: IconName) => ({ color, focused }: { color: ColorValue; focused: boolean }) =>
  <Icon name={name} color={color} size={24} strokeWidth={focused ? 2.2 : 1.8} />;

const toggle = () => <View style={{ marginRight: 16 }}><ThemeToggle size={18} /></View>;

export default function TabsLayout() {
  useTheme();
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        headerRight: toggle,
        sceneStyle: { backgroundColor: colors.bg },
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border },
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
