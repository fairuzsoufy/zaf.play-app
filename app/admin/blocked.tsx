import { Stack } from 'expo-router';
import BlockedPlayers from '@/components/BlockedPlayers';

export default function AdminBlocked() {
  return (
    <>
      <Stack.Screen options={{ title: 'Blocked players' }} />
      <BlockedPlayers mode="admin" />
    </>
  );
}
