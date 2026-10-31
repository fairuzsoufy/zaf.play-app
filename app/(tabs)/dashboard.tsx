import { Redirect } from 'expo-router';

// The owner / staff "Dashboard" tab. Pressing the tab opens /owner on top of the tabs (see the tabs layout);
// this only catches a direct link to the tab.
export default function DashboardTab() {
  return <Redirect href="/owner" />;
}
