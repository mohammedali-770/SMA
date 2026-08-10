import { supabase } from './supabase';

export type StaffRole = 'customer' | 'admin' | 'accountant';

export interface StaffAccount {
  id: string;
  full_name: string | null;
  email: string | null;
  phone_number: string | null;
  role: StaffRole;
  created_at: string;
  updated_at?: string | null;
}

export interface RoleAuditEntry {
  id: number;
  target_user_id: string | null;
  target_name: string | null;
  target_email: string | null;
  target_phone: string | null;
  old_role: StaffRole;
  new_role: StaffRole;
  reason: string;
  changed_by: string | null;
  changed_by_name: string | null;
  changed_by_email: string | null;
  changed_at: string;
}

function unwrap<T>(result: { data: unknown; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data as T;
}

export const staffAccess = {
  async listStaff(): Promise<StaffAccount[]> {
    return unwrap<StaffAccount[]>(await supabase.rpc('admin_list_staff'));
  },

  async searchCandidates(query: string, limit = 20): Promise<StaffAccount[]> {
    return unwrap<StaffAccount[]>(await supabase.rpc('admin_search_role_candidates', {
      p_query: query,
      p_limit: limit,
    }));
  },

  async setRole(userId: string, role: StaffRole, reason: string): Promise<{ id: string; role: StaffRole; changed: boolean }> {
    return unwrap(await supabase.rpc('admin_set_user_role', {
      p_user_id: userId,
      p_role: role,
      p_reason: reason,
    }));
  },

  async listAudit(limit = 50): Promise<RoleAuditEntry[]> {
    return unwrap<RoleAuditEntry[]>(await supabase.rpc('admin_list_role_change_audit', { p_limit: limit }));
  },
};
