// staff-accounts — ADMIN-only provisioning for the branch-operations roles.
//
//   action 'list'           → branch_staff / call_center accounts + pinned branch
//   action 'create'         → create an auth user, assign the role, pin the branch
//   action 'reset_password' → set a new password for one of those accounts
//   action 'delete'         → remove one of those accounts
//
// WHY THIS EXISTS. Staff onboarding was previously "the person signs up
// themselves, then an admin promotes them" (see StaffAccessPanel's own copy:
// "The user must already have an account"). That is workable for a handful of
// office staff and unworkable for shop-floor accounts, which an admin needs to
// hand out and revoke directly.
//
// SECURITY BOUNDARIES — all four matter, none is optional:
//
//  1. verify_jwt = true (supabase/config.toml) AND an explicit
//     profiles.role === 'admin' re-check, matching email-test-config and
//     whatsapp-test-config. The JWT check alone only proves *someone* signed in.
//
//  2. MANAGEABLE_ROLES is an allow-list, not a deny-list. This function can
//     only ever create or touch branch_staff / call_center accounts. It cannot
//     mint an admin, cannot reset an admin's password, and cannot delete an
//     admin or a customer — so compromising it does not escalate to the
//     administrator role or reach customer accounts.
//
//  3. Role and branch assignment go through the existing admin RPCs
//     (admin_set_user_role, admin_set_staff_branch) using the CALLER'S JWT, not
//     the service role. That is deliberate: those RPCs read auth.uid() to write
//     role_change_audit, so the audit records the human who did it. Calling
//     them with the service role would silently attribute every change to
//     nobody.
//
//  4. Passwords are never logged, never echoed back, and never stored anywhere
//     by this function. They exist only in the request body and the GoTrue call.
import { corsHeaders, json } from '../_shared/cors.ts';
import { adminClient, userClient } from '../_shared/supabaseClient.ts';
import {
  MANAGEABLE_ROLES,
  MIN_PASSWORD,
  isAcceptablePassword,
  isManageableRole as isManageable,
  isValidEmail,
  requiresBranch,
  sanitizeError as sanitize,
} from './guards.ts';

function str(v: unknown): string { return typeof v === 'string' ? v : ''; }

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'unauthorized' }, 401);

  const admin = adminClient();
  const caller = userClient(authHeader);

  const { data: { user } } = await caller.auth.getUser();
  if (!user) return json({ error: 'unauthorized' }, 401);

  const { data: profile } = await admin
    .from('profiles').select('role').eq('id', user.id).maybeSingle();
  if (!profile || profile.role !== 'admin') return json({ error: 'forbidden' }, 403);

  let payload: Record<string, unknown>;
  try { payload = await req.json(); } catch { payload = {}; }
  const action = str(payload.action);

  // -------------------------------------------------------------------------
  if (action === 'list') {
    const { data: rows, error } = await admin
      .from('profiles')
      .select('id, full_name, email, role')
      .in('role', MANAGEABLE_ROLES as readonly string[])
      .order('role');
    if (error) return json({ error: sanitize(error.message) }, 500);

    const { data: assignments } = await admin
      .from('staff_branch_assignments').select('user_id, branch_id');
    const branchByUser = new Map(
      (assignments ?? []).map((a) => [a.user_id as string, a.branch_id as string]),
    );

    return json({
      accounts: (rows ?? []).map((r) => ({
        id: r.id,
        fullName: r.full_name,
        email: r.email,
        role: r.role,
        branchId: branchByUser.get(r.id as string) ?? null,
      })),
    }, 200);
  }

  // -------------------------------------------------------------------------
  if (action === 'create') {
    const email = str(payload.email).trim().toLowerCase();
    const password = str(payload.password);
    const fullName = str(payload.fullName).trim();
    const role = payload.role;
    const branchId = str(payload.branchId).trim();
    const reason = str(payload.reason).trim() || 'Operations console account provisioning';

    if (!isValidEmail(email)) return json({ error: 'Enter a valid email address.' }, 400);
    if (!isAcceptablePassword(password)) {
      return json({ error: `Password must be at least ${MIN_PASSWORD} characters.` }, 400);
    }
    if (!isManageable(role)) {
      return json({ error: 'This function can only create branch or call-centre accounts.' }, 400);
    }
    if (requiresBranch(role) && !branchId) {
      return json({ error: 'A branch account must be pinned to a branch.' }, 400);
    }

    // email_confirm: true — these accounts are handed out by an administrator,
    // so there is no inbox round-trip to wait on.
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: fullName ? { full_name: fullName } : {},
    });
    if (createErr || !created?.user) {
      return json({ error: sanitize(createErr?.message ?? 'Could not create the account.') }, 400);
    }
    const newUserId = created.user.id;

    // From here on, any failure leaves a half-provisioned account: an auth user
    // that the on_auth_user_created trigger has given role 'customer'. That is
    // worse than nothing — it is a login with no console and no audit trail —
    // so every failure path below deletes the user again before returning.
    const rollback = async (message: string, status: number) => {
      await admin.auth.admin.deleteUser(newUserId).catch(() => undefined);
      return json({ error: message }, status);
    };

    const { error: roleErr } = await caller.rpc('admin_set_user_role', {
      p_user_id: newUserId, p_role: role, p_reason: reason,
    });
    if (roleErr) return rollback(sanitize(roleErr.message), 400);

    if (requiresBranch(role)) {
      const { error: branchErr } = await caller.rpc('admin_set_staff_branch', {
        p_user_id: newUserId, p_branch_id: branchId,
      });
      if (branchErr) return rollback(sanitize(branchErr.message), 400);
    }

    return json({ id: newUserId, email, role, branchId: branchId || null }, 200);
  }

  // -------------------------------------------------------------------------
  // reset_password and delete share the same target guard: the account must
  // exist AND already hold one of the manageable roles. Without this an admin
  // could pass any uuid and take over a colleague's administrator login.
  if (action === 'reset_password' || action === 'delete') {
    const targetId = str(payload.userId).trim();
    if (!targetId) return json({ error: 'A user id is required.' }, 400);
    if (targetId === user.id) {
      return json({ error: 'Use your own account settings to change your password.' }, 400);
    }

    const { data: target } = await admin
      .from('profiles').select('id, role').eq('id', targetId).maybeSingle();
    if (!target) return json({ error: 'Account not found.' }, 404);
    if (!isManageable(target.role)) {
      return json({ error: 'Only branch and call-centre accounts can be managed here.' }, 403);
    }

    if (action === 'reset_password') {
      const password = str(payload.password);
      if (!isAcceptablePassword(password)) {
        return json({ error: `Password must be at least ${MIN_PASSWORD} characters.` }, 400);
      }
      const { error } = await admin.auth.admin.updateUserById(targetId, { password });
      if (error) return json({ error: sanitize(error.message) }, 400);
      return json({ id: targetId, updated: true }, 200);
    }

    // Deleting the auth user cascades to profiles and, through it, to the
    // branch assignment.
    const { error } = await admin.auth.admin.deleteUser(targetId);
    if (error) return json({ error: sanitize(error.message) }, 400);
    return json({ id: targetId, deleted: true }, 200);
  }

  return json({ error: 'Unknown action' }, 400);
});
