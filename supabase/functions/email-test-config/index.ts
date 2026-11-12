// email-test-config — ADMIN-only (verify_jwt=true + is_admin check).
//   action 'status'    → readiness booleans for the SMTP config (no secret values).
//   action 'test_send' → send a test email via the stored SMTP settings.
// The SMTP password is read server-side from integration_settings.secret_config
// and never returned to the browser.
//
// THE ENDPOINT IS VALIDATED BEFORE ANYTHING CONNECTS, by the guard the alert
// dispatcher uses (_shared/smtpTarget.ts). Until 2026-11-11 this function
// handed the stored host and port straight to SMTPClient and returned up to 300
// characters of the connection error, so the button could reach the cloud
// metadata address or loopback, on any port, and report what answered there.
// A failure now comes back as a reason code and a fixed sentence, never as the
// error's text, because denomailer builds that text out of whatever the far end
// said. Detail: docs/OPERATIONS_ALERTS_DIGEST.md.
import { corsHeaders, json } from '../_shared/cors.ts';
import { decideAdminAuthorization } from '../_shared/adminAuth.ts';
import { adminClient, userClient } from '../_shared/supabaseClient.ts';
import { getProviderConfig } from '../_shared/secrets.ts';
import { classifySmtpFailure, describeSmtpRefusal, parseSmtpTarget } from '../_shared/smtpTarget.ts';
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';

function has(v: unknown): boolean { return typeof v === 'string' && v.trim().length > 0; }
function str(v: unknown): string { return typeof v === 'string' ? v : ''; }
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Pin for the SMTP relay, comma-separated, matched by suffix. Edge Function
// secrets are project-wide, so this is the same value operations-alert-dispatch
// reads. Unset means "any public hostname on a mail port", which still admits a
// public NAME that resolves into private space; only this pin refuses that.
const SMTP_ALLOWED_HOSTS = Deno.env.get('SMTP_ALLOWED_HOSTS') ?? null;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'unauthorized' }, 401);

  const admin = adminClient();

  // Admin gate: resolve the caller and confirm their profile role is 'admin'.
  const caller = userClient(authHeader);
  const { data: { user } } = await caller.auth.getUser();
  if (!user) return json({ error: 'unauthorized' }, 401);
  // Admin AND AAL2 — asked of Postgres as the CALLER so the assurance level is
  // evaluated by the same SQL every RLS policy uses. See _shared/adminAuth.ts.
  // Placed after getUser() on purpose: a failed session refresh makes
  // supabase-js send the anon key, and gating earlier would report that as
  // "two-factor required" instead of the truthful "unauthorized".
  const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle();
  const { data: isAdmin, error: adminErr } = await caller.rpc('is_admin');
  const gate = decideAdminAuthorization({ data: isAdmin, error: adminErr }, profile?.role);
  if (!gate.allowed) return json({ error: gate.error, code: gate.code }, gate.status);

  let payload: { action?: string; to?: string };
  try { payload = await req.json(); } catch { payload = {}; }

  const cfg = await getProviderConfig(admin, 'email');
  const pub = (cfg?.publicConfig ?? {}) as Record<string, unknown>;
  const sec = (cfg?.secretConfig ?? {}) as Record<string, unknown>;

  if (payload.action === 'test_send') {
    // Host, port, TLS, username and sender all come from the guard, which
    // refuses an IP literal, an internal name, a malformed host, a port that is
    // not a mail port, and a host outside SMTP_ALLOWED_HOSTS when that is set.
    const target = parseSmtpTarget(pub, SMTP_ALLOWED_HOSTS);
    if (target.reason !== null) {
      console.error('email test: smtp endpoint refused', { reason: target.reason });
      return json({
        ok: false,
        reason: target.reason,
        message: `${describeSmtpRefusal(target.reason)} (${target.reason})`,
      }, 200);
    }

    const to = str(payload.to).trim();
    if (!EMAIL_RE.test(to)) return json({ ok: false, message: 'Enter a valid recipient email address.' }, 200);
    const password = str(sec.password);
    const replyTo = str(pub.reply_to).trim();

    let client: SMTPClient | null = null;
    try {
      client = new SMTPClient({
        connection: {
          hostname: target.host,
          port: target.port,
          tls: target.tls,
          auth: target.username ? { username: target.username, password } : undefined,
        },
      });
      await client.send({
        from: `${target.fromName} <${target.fromEmail}>`,
        to,
        replyTo: replyTo || undefined,
        subject: 'Spicy Meal — SMTP test email',
        content: 'This is a test email from your Spicy Meal admin dashboard. If you received it, your SMTP settings are working.',
        html: '<p>This is a test email from your <b>Spicy Meal</b> admin dashboard.</p><p>If you received it, your SMTP settings are working. ✅</p>',
      });
      await client.close();
      return json({ ok: true, message: 'Test email sent.' }, 200);
    } catch (e) {
      try { await client?.close(); } catch { /* ignore */ }
      const failure = classifySmtpFailure(e, target.port);
      // The error's NAME only. Its message is built from what the far end said.
      console.error('email test: send failed', {
        reason: failure.reason,
        error: e instanceof Error ? e.name : 'unknown',
      });
      return json({
        ok: false,
        reason: failure.reason,
        message: `Send failed. ${failure.message} (${failure.reason})`,
      }, 200);
    }
  }

  // Default: status booleans (never any secret values).
  return json({
    status: 'ok',
    enabled: Boolean(cfg?.enabled),
    provider: 'smtp',
    host_set: has(pub.host),
    port: has(pub.port) ? str(pub.port) : null,
    secure: pub.secure === true,
    username_set: has(pub.username),
    from_email_set: has(pub.from_email),
    from_name: has(pub.from_name) ? str(pub.from_name) : null,
    reply_to_set: has(pub.reply_to),
    password_set: has(sec.password),
  }, 200);
});
