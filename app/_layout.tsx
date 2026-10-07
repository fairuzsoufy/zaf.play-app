import { DarkTheme, DefaultTheme, Stack, ThemeProvider as NavThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AuthProvider } from '@/lib/auth';
import { Splash } from '@/components/Splash';
import { Toaster } from '@/components/Toast';
import { colors, ThemeProvider, useTheme } from '@/lib/theme';

export default function RootLayout() {
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
            contentStyle: { backgroundColor: colors.bg },
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />
          <Stack.Screen name="court/[id]" options={{ title: '' }} />
          <Stack.Screen name="book/[courtId]" options={{ title: 'Book a time' }} />
          <Stack.Screen name="pay/[id]" options={{ title: 'Complete your booking' }} />
          <Stack.Screen name="change/[id]" options={{ title: 'Modify booking' }} />
          <Stack.Screen name="login" options={{ title: 'Log in', presentation: 'modal' }} />
          <Stack.Screen name="signup" options={{ title: 'Create account', presentation: 'modal' }} />
          <Stack.Screen name="forgot-password" options={{ title: 'Forgot password' }} />
        </Stack>
        <Toaster />
        <Splash />
      </NavThemeProvider>
    </GestureHandlerRootView>
  );
}
