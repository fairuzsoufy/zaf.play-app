import { Stack } from 'expo-router';
import { colors, fonts, useTheme } from '@/lib/theme';

// Each tab is its own stack holding the shared player screens (court, book, pay, game...), so the bottom bar
// stays on every page and Back returns inside the tab. The same files serve all four tabs (expo-router shared routes).
export const unstable_settings = {
  play: { initialRouteName: 'index' },
  games: { initialRouteName: 'games' },
  bookings: { initialRouteName: 'bookings' },
  profile: { initialRouteName: 'profile' },
};

export default function TabStack({ segment }: { segment: string }) {
  useTheme();
  const root = segment === '(games)' ? 'games' : segment === '(bookings)' ? 'bookings' : segment === '(profile)' ? 'profile' : 'index';
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerTitleStyle: { fontFamily: fonts.displayBold, fontSize: 19 },
        headerShadowVisible: false,
        headerBackButtonDisplayMode: 'minimal', // just the arrow, never a route name like "(tabs)"
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      {root === 'index' && <Stack.Screen name="index" options={{ headerShown: false }} />}
      {root === 'games' && <Stack.Screen name="games" options={{ title: 'Games', headerTitleStyle: { fontFamily: fonts.display, fontSize: 24 } }} />}
      {root === 'bookings' && <Stack.Screen name="bookings" options={{ title: 'Bookings', headerTitleStyle: { fontFamily: fonts.display, fontSize: 24 } }} />}
      {root === 'profile' && <Stack.Screen name="profile" options={{ title: 'Profile', headerTitleStyle: { fontFamily: fonts.display, fontSize: 24 } }} />}
      <Stack.Screen name="court/[id]" options={{ title: '' }} />
      <Stack.Screen name="book/[courtId]" options={{ title: 'Book a time' }} />
      <Stack.Screen name="game/[id]" options={{ title: 'Open game' }} />
      <Stack.Screen name="tournament/[code]" options={{ title: 'Tournament' }} />
      <Stack.Screen name="appeal" options={{ title: 'Appeal a restriction' }} />
      <Stack.Screen name="pay/[id]" options={{ title: 'Complete your booking' }} />
      <Stack.Screen name="change/[id]" options={{ title: 'Modify booking' }} />
    </Stack>
  );
}
