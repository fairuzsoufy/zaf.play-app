import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AuthProvider, useAuth } from '@/lib/auth';
import { BrandSplash } from '@/components/Brand';
import { View } from 'react-native';
import { colors } from '@/lib/theme';

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: colors.bg, card: colors.bg, border: colors.border, primary: colors.primary },
};

function Splash() {
  const { loading } = useAuth();
  return <BrandSplash ready={!loading} />;
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <ThemeProvider value={theme}>
      <AuthProvider>
        <StatusBar style="light" />
        <View style={{ flex: 1 }}>
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
          <Stack.Screen name="login" options={{ title: 'Log in', presentation: 'modal' }} />
          <Stack.Screen name="signup" options={{ title: 'Create account', presentation: 'modal' }} />
          <Stack.Screen name="forgot-password" options={{ title: 'Forgot password' }} />
        </Stack>
        <Splash />
        </View>
      </AuthProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
