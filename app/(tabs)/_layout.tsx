import { Tabs } from 'expo-router';
import { TabIcon } from '@/components/TabIcon';
import { colors } from '@/lib/theme';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        sceneStyle: { backgroundColor: colors.bg },
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.text,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        tabBarInactiveTintColor: colors.muted,
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Play', headerShown: false, tabBarIcon: ({ focused }) => <TabIcon name="ball" focused={focused} /> }} />
      <Tabs.Screen name="bookings" options={{ title: 'My bookings', tabBarIcon: ({ focused }) => <TabIcon name="calendar" focused={focused} /> }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: ({ focused }) => <TabIcon name="user" focused={focused} /> }} />
    </Tabs>
  );
}
