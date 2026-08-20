/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { supabase } from './supabase';

/**
 * Client for the admin-only `staff-accounts` Edge Function.
 *
 * The function is the only path that creates an auth user for a branch or
 * call-centre operator. Authorization lives there and in the database, never
 * here: this module just shapes requests and surfaces the server's message.
 *
 * Passwords travel in the request body and are never stored, cached or logged
 * on the client.
 */
export type OpsAccountRole = 'branch_staff' | 'call_center';

export interface OpsAccount {
  id: string;
  fullName: string | null;
  email: string | null;
  role: OpsAccountRole;
  branchId: string | null;
}

/**
 * Edge Function errors arrive as a generic "non-2xx status" message with the
 * useful text in the response body, so unwrap it the same way the other
 * function clients in src/lib/api.ts do.
 */
async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('staff-accounts', { body });
  if (error) {
    let msg = error.message;
    const ctx = (error as { context?: { json?: () => Promise<{ error?: string }> } }).context;
    try { const b = ctx?.json ? await ctx.json() : null; if (b?.error) msg = b.error; } catch { /* keep msg */ }
    throw new Error(msg);
  }
  return data as T;
}

export const staffAccounts = {
  async list(): Promise<OpsAccount[]> {
    const data = await invoke<{ accounts: OpsAccount[] }>({ action: 'list' });
    return data.accounts ?? [];
  },

  async create(input: {
    email: string;
    password: string;
    fullName: string;
    role: OpsAccountRole;
    branchId: string | null;
    reason: string;
  }): Promise<OpsAccount> {
    return invoke<OpsAccount>({ action: 'create', ...input });
  },

  async resetPassword(userId: string, password: string): Promise<void> {
    await invoke({ action: 'reset_password', userId, password });
  },

  async remove(userId: string): Promise<void> {
    await invoke({ action: 'delete', userId });
  },
};
