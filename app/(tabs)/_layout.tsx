import { Tabs } from 'expo-router';
import type { ColorValue } from 'react-native';
import { colors } from '@/lib/theme';
import { Icon, type IconName } from '@/components/Icon';

// same line icons as the website's top bar
const icon = (name: IconName) => ({ color, focused }: { color: ColorValue; focused: boolean }) =>
  <Icon name={name} color={color} size={24} strokeWidth={focused ? 2.2 : 1.8} />;

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
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
