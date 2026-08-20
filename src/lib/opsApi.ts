/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { supabase } from './supabase';

/**
 * Branch-operations reads.
 *
 * `staff_branch_assignments` is readable but never writable by a client: the
 * RLS policy exposes only the caller's own row (or everything, to an admin),
 * and there is no insert/update/delete grant at all. An operator therefore
 * cannot move themselves to a different branch — assignment is an admin RPC.
 */
export const opsApi = {
  /** The signed-in operator's pinned branch id, or null when unassigned. */
  async myBranchId(): Promise<string | null> {
    const { data, error } = await supabase
      .from('staff_branch_assignments')
      .select('branch_id')
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data?.branch_id as string | undefined) ?? null;
  },
};
