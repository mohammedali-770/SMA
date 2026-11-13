// account-delete-scheduler — Vault-authenticated scheduler gateway.
//
// The cron job presents a dedicated secret stored only in Supabase Vault. This
// function verifies that secret through a service-role-only RPC, then invokes the
// existing account-delete-process function with the built-in service-role bearer.
// The service-role key never leaves the Edge Function environment.
import { handler } from './handler.ts';

Deno.serve(handler);
