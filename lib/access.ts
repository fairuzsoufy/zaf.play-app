import { supabase } from './supabase';

// What the logged-in person may do on the owner side, the same as the website's lib/access.ts.
// Owners can do everything; co-owners too (money transfers go to the owner); sub-users (role "staff")
// only what their owner ticked. The database enforces all of this too: this only shows or hides screens.
export type Access = {
  role: 'owner' | 'staff' | 'player' | 'admin';
  user_id: string;
  full_name: string;
  is_owner: boolean;
  co_owner?: boolean;
  owner_id?: string;
  owner_name?: string;
  job_title?: string | null;
  status?: 'active' | 'invited' | 'suspended' | 'removed' | 'pending' | 'rejected' | 'frozen';
  reject_reason?: string | null;
  view_bookings?: boolean;
  manage_bookings?: boolean;
  view_finances?: boolean;
  manage_branches?: boolean;
  view_tournaments?: boolean;
  manage_tournaments?: boolean;
  all_branches?: boolean;
  branch_ids?: string[];
  see_transfers?: boolean;
};

export async function getMyAccess(): Promise<Access | null> {
  const { data, error } = await supabase.rpc('my_access');
  if (error || !data) return null;
  return data as Access;
}

export const PERMISSIONS = [
  { key: 'view_bookings', label: 'View bookings', help: 'See upcoming, past and cancelled bookings.' },
  { key: 'manage_bookings', label: 'Manage bookings', help: 'Cancel bookings and block time slots.' },
  { key: 'view_finances', label: 'View finances', help: 'Revenue dashboard, earnings and Zaf Play transfers.' },
  { key: 'manage_branches', label: 'Manage branches & courts', help: 'Edit branch and court details, prices and hours (still approved by Zaf Play).' },
  { key: 'view_tournaments', label: 'View tournaments', help: 'See tournaments and their teams.' },
  { key: 'manage_tournaments', label: 'Manage tournaments', help: 'Create tournaments, change times, close registration, make the schedule and cancel.' },
] as const;

export type PermissionKey = (typeof PERMISSIONS)[number]['key'];

// the branches this person works on: null means all of the owner's branches
export const branchScope = (a: Access) => (a.is_owner || a.all_branches ? null : a.branch_ids || []);
