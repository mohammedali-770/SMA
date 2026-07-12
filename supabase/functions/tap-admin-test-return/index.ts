import { corsHeaders } from '../_shared/cors.ts';

/**
 * tap-admin-test-return - the HTTPS page Tap redirects the admin's browser to
 * after the isolated admin TEST checkout (Tap requires an https redirect target
 * for 3DS). It is purely informational: it shows nothing sensitive and marks
 * NOTHING - the dashboard verifies the result server-side via Retrieve Charge.
 * The tap_id query param is ignored here (untrusted). No order/payment effects.
 *
 * Rendering notes (why this looks slightly unusual):
 *  - Body is pure ASCII: straight quotes, a plain "-" in place of an em dash,
 *    and the HTML entity &middot; in place of a raw middle-dot glyph. Pure-ASCII
 *    source bytes are valid UTF-8 and can never turn into mojibake regardless of
 *    how the charset is interpreted downstream.
 *  - Content-Type is "text/HTML; charset=utf-8". Browsers match media types
 *    case-insensitively (RFC 2045), so this renders as HTML. The exact lowercase
 *    token "text/html" is rewritten by the Supabase shared functions domain to
 *    "text/plain" + a sandbox CSP (anti-phishing on *.supabase.co), which makes
 *    browsers show the raw source and drop the charset. The cased subtype keeps
 *    the platform from neutralizing it while staying a valid HTML content type.
 *  - The body is emitted as explicit UTF-8 bytes (TextEncoder) so the runtime
 *    cannot reinterpret the string encoding.
 */
const PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Spicy Meal - Tap sandbox test complete</title>
  <style>
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0f0f14;color:#fff;
         display:flex;min-height:100vh;margin:0;align-items:center;justify-content:center;text-align:center;padding:24px}
    .card{max-width:380px}
    h1{font-size:18px;margin:0 0 8px} p{color:#c9c9d4;font-size:14px;line-height:1.55;margin:0 0 8px}
    .tag{display:inline-block;background:#78350f;color:#fcd34d;font-weight:800;font-size:11px;
         padding:3px 10px;border-radius:999px;margin-bottom:12px}
  </style>
</head>
<body>
  <div class="card">
    <div class="tag">TAP SANDBOX &middot; TEST</div>
    <h1>Test checkout complete</h1>
    <p>You can close this tab and return to the Spicy Meal admin dashboard, then tap
       <b>"Check test result"</b> to see the verified status.</p>
    <p>This was a sandbox test - no Spicy Meal order was created or charged.</p>
  </div>
</body>
</html>`;

// Encode once to guaranteed-valid UTF-8 bytes.
const PAGE_BYTES = new TextEncoder().encode(PAGE_HTML);

Deno.serve((req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  return new Response(PAGE_BYTES, {
    status: 200,
    headers: {
      ...corsHeaders,
      // Cased subtype: renders as HTML but avoids the platform's lowercase
      // "text/html" -> "text/plain" rewrite. See the rendering notes above.
      'Content-Type': 'text/HTML; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
});
