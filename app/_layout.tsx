import { DarkTheme, DefaultTheme, Stack, ThemeProvider as NavThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { BricolageGrotesque_800ExtraBold } from '@expo-google-fonts/bricolage-grotesque/800ExtraBold';
import { BricolageGrotesque_700Bold } from '@expo-google-fonts/bricolage-grotesque/700Bold';
import { BricolageGrotesque_600SemiBold } from '@expo-google-fonts/bricolage-grotesque/600SemiBold';
import { Figtree_400Regular } from '@expo-google-fonts/figtree/400Regular';
import { Figtree_500Medium } from '@expo-google-fonts/figtree/500Medium';
import { Figtree_600SemiBold } from '@expo-google-fonts/figtree/600SemiBold';
import { Figtree_700Bold } from '@expo-google-fonts/figtree/700Bold';
import { Figtree_800ExtraBold } from '@expo-google-fonts/figtree/800ExtraBold';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AuthProvider } from '@/lib/auth';
import { Splash } from '@/components/Splash';
import { Toaster } from '@/components/Toast';
import { BookingAlerts } from '@/components/BookingAlerts';
import { colors, fonts, ThemeProvider, useTheme } from '@/lib/theme';

export default function RootLayout() {
  // the website's fonts; the splash covers the first moment while they load
  useFonts({
    [fonts.display]: BricolageGrotesque_800ExtraBold, [fonts.displayBold]: BricolageGrotesque_700Bold, [fonts.displaySemi]: BricolageGrotesque_600SemiBold,
    [fonts.body]: Figtree_400Regular, [fonts.bodyMedium]: Figtree_500Medium, [fonts.bodySemi]: Figtree_600SemiBold,
    [fonts.bodyBold]: Figtree_700Bold, [fonts.bodyHeavy]: Figtree_800ExtraBold,
  });
  return (
    <ThemeProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ThemeProvider>
  );
}

function App() {
  const { scheme } = useTheme();
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const nav = {
    ...base,
    colors: { ...base.colors, background: colors.bg, card: colors.bg, border: colors.border, primary: colors.brandPink, text: colors.text },
  };
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <NavThemeProvider value={nav}>
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.bg },
            headerTintColor: colors.text,
            headerTitleStyle: { fontFamily: fonts.displayBold, fontSize: 19 },
            headerShadowVisible: false,
            contentStyle: { backgroundColor: colors.bg },
            headerBackButtonDisplayMode: 'minimal',
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />
          <Stack.Screen name="admin" options={{ headerShown: false }} />
          <Stack.Screen name="login" options={{ title: 'Log in', presentation: 'modal' }} />
          <Stack.Screen name="signup" options={{ title: 'Create account', presentation: 'modal' }} />
          <Stack.Screen name="signup-owner" options={{ title: 'Court owner sign up', presentation: 'modal' }} />
          <Stack.Screen name="forgot-password" options={{ title: 'Forgot password' }} />
        </Stack>
        <Toaster />
        <BookingAlerts />
        <Splash />
      </NavThemeProvider>
    </GestureHandlerRootView>
  );
}
