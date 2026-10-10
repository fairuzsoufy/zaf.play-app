import { DarkTheme, DefaultTheme, Stack, ThemeProvider as NavThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { Saira_800ExtraBold_Italic } from '@expo-google-fonts/saira/800ExtraBold_Italic';
import { Saira_700Bold_Italic } from '@expo-google-fonts/saira/700Bold_Italic';
import { Saira_600SemiBold_Italic } from '@expo-google-fonts/saira/600SemiBold_Italic';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AuthProvider } from '@/lib/auth';
import { Splash } from '@/components/Splash';
import { Toaster } from '@/components/Toast';
import { colors, fonts, ThemeProvider, useTheme } from '@/lib/theme';

export default function RootLayout() {
  // the website's display font; the splash covers the first moment while it loads
  useFonts({ [fonts.display]: Saira_800ExtraBold_Italic, [fonts.displayBold]: Saira_700Bold_Italic, [fonts.displaySemi]: Saira_600SemiBold_Italic });
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
