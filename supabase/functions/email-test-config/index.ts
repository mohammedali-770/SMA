// email-test-config — ADMIN-only (verify_jwt=true + is_admin check).
//   action 'status'    → readiness booleans for the SMTP config (no secret values).
//   action 'test_send' → send a test email via the stored SMTP settings.
// The SMTP password is read server-side from integration_settings.secret_config
// and never returned to the browser; errors are sanitized before returning.
import { corsHeaders, json } from '../_shared/cors.ts';
import { adminClient, userClient } from '../_shared/supabaseClient.ts';
import { getProviderConfig } from '../_shared/secrets.ts';
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';

function has(v: unknown): boolean { return typeof v === 'string' && v.trim().length > 0; }
function str(v: unknown): string { return typeof v === 'string' ? v : ''; }
function sanitize(msg: string): string {
  // Never echo anything secret-shaped back to the browser.
  return String(msg).replace(/(password|pass|auth)\s*[:=]?\s*\S+/gi, '$1 ***').slice(0, 300);
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'unauthorized' }, 401);

  const admin = adminClient();
  const { data: { user } } = await userClient(authHeader).auth.getUser();
  if (!user) return json({ error: 'unauthorized' }, 401);
  const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle();
  if (!profile || profile.role !== 'admin') return json({ error: 'forbidden' }, 403);

  let payload: { action?: string; to?: string };
  try { payload = await req.json(); } catch { payload = {}; }

  const cfg = await getProviderConfig(admin, 'email');
  const pub = (cfg?.publicConfig ?? {}) as Record<string, unknown>;
  const sec = (cfg?.secretConfig ?? {}) as Record<string, unknown>;

  if (payload.action === 'test_send') {
    const host = str(pub.host).trim();
    const port = Number(str(pub.port) || '587');
    const secure = pub.secure === true;
    const username = str(pub.username).trim();
    const password = str(sec.password);
    const fromEmail = str(pub.from_email).trim();
    const fromName = str(pub.from_name).trim() || 'Spicy Meal';
    const replyTo = str(pub.reply_to).trim();
    const to = str(payload.to).trim();

    if (!host || !fromEmail) return json({ ok: false, message: 'Email server is not fully configured (host + from email required).' }, 200);
    if (!EMAIL_RE.test(to)) return json({ ok: false, message: 'Enter a valid recipient email address.' }, 200);
    if (!Number.isFinite(port) || port <= 0) return json({ ok: false, message: 'Invalid SMTP port.' }, 200);

    let client: SMTPClient | null = null;
    try {
      client = new SMTPClient({
        connection: {
          hostname: host,
          port,
          tls: secure,
          auth: username ? { username, password } : undefined,
        },
      });
      await client.send({
        from: `${fromName} <${fromEmail}>`,
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
      return json({ ok: false, message: `Send failed — ${sanitize(e instanceof Error ? e.message : String(e))}` }, 200);
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
