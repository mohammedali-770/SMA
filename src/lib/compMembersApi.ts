/**
 * Comped customers — the console's side of `public.comp_members`.
 *
 * A comped customer orders at no charge, automatically, on every order, with no
 * cap. That makes membership the highest-value write in this console: one row
 * here is unlimited free food, and nothing downstream limits it. Everything is
 * therefore routed through `admin_set_comp_member`, which is SECURITY DEFINER
 * and gated on `is_admin()` — role AND AAL2 — and which refuses to write
 * without a reason. There is deliberately NO client write grant on the table,
 * so this module cannot bypass that path even by accident.
 *
 * Customer search reuses `admin_search_role_candidates` rather than adding a
 * second directory RPC: it already searches every profile by name, email or
 * phone, and it is already admin-gated.
 *
 * Mirrors `staffAccessApi.ts`, which wraps the same shape for role changes.
 */
import { supabase } from './supabase';

export interface CompMember {
  profile_id: string;
  full_name: string | null;
  phone_number: string | null;
  is_active: boolean;
  note: string | null;
  added_at: string;
  updated_at: string;
}

export interface CompAuditEntry {
  id: number;
  target_user_id: string | null;
  target_name: string | null;
  was_active: boolean;
  now_active: boolean;
  reason: string;
  changed_by: string | null;
  changed_at: string;
}

/** A profile that could be made comped. Shape of admin_search_role_candidates. */
export interface CompCandidate {
  id: string;
  full_name: string | null;
  email: string | null;
  phone_number: string | null;
}

function unwrap<T>(result: { data: unknown; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data as T;
}

export const compMembers = {
  async list(): Promise<CompMember[]> {
    return unwrap<CompMember[]>(await supabase.rpc('admin_list_comp_members'));
  },

  async listAudit(limit = 50): Promise<CompAuditEntry[]> {
    return unwrap<CompAuditEntry[]>(
      await supabase.rpc('admin_list_comp_member_audit', { p_limit: limit }),
    );
  },

  async search(query: string, limit = 20): Promise<CompCandidate[]> {
    return unwrap<CompCandidate[]>(
      await supabase.rpc('admin_search_role_candidates', { p_query: query, p_limit: limit }),
    );
  },

  /**
   * Add or remove a customer. `reason` is mandatory server-side (3–500 chars);
   * it is validated here too so the operator is told before a round trip, not
   * after one.
   */
  async set(userId: string, active: boolean, reason: string): Promise<{
    profile_id: string; is_active: boolean; was_active: boolean;
  }> {
    return unwrap(await supabase.rpc('admin_set_comp_member', {
      p_user_id: userId,
      p_active: active,
      p_reason: reason,
    }));
  },
};
