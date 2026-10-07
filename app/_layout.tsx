import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AuthProvider } from '@/lib/auth';
import { colors } from '@/lib/theme';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <AuthProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.bg },
            headerTintColor: colors.text,
            contentStyle: { backgroundColor: colors.bg },
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="court/[id]" options={{ title: '' }} />
          <Stack.Screen name="login" options={{ title: 'Log in', presentation: 'modal' }} />
          <Stack.Screen name="forgot-password" options={{ title: 'Forgot password' }} />
        </Stack>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}
