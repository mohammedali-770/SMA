import { corsHeaders } from '../_shared/cors.ts';

/**
 * payment-return — the HTTPS URL Tap redirects the customer's browser to after
 * checkout (Tap requires a real https redirect target; a raw app scheme is not
 * reliable). This page marks NOTHING paid: it only bounces back into the app via
 * the fixed spicymeal:// deep link so the app can run the authoritative server
 * verification (payment-verify).
 *
 * Open-redirect safe: it only ever navigates to our own fixed scheme + path, and
 * the single `order` parameter is passed through only after strict UUID
 * validation. Tap's tap_id and any other query params are IGNORED here (untrusted).
 */
Deno.serve((req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const url = new URL(req.url);
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const rawOrder = url.searchParams.get('order') ?? '';
  const rawSession = url.searchParams.get('session') ?? '';
  const order = uuidRe.test(rawOrder) ? rawOrder : '';
  const session = uuidRe.test(rawSession) ? rawSession : '';
  // New flow passes `session`; legacy passes `order`. Only ever our own scheme.
  const deepLink = session
    ? `spicymeal://payment/return?session=${encodeURIComponent(session)}`
    : order
      ? `spicymeal://payment/return?order=${encodeURIComponent(order)}`
      : 'spicymeal://payment/return';
  // JSON-encode for safe embedding inside the inline <script> string literal.
  const deepJs = JSON.stringify(deepLink);

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="refresh" content="0; url=${deepLink.replace(/"/g, '&quot;')}" />
  <title>Spicy Meal — returning to the app</title>
  <style>
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0f0f14;color:#fff;
         display:flex;min-height:100vh;margin:0;align-items:center;justify-content:center;text-align:center;padding:24px}
    .card{max-width:360px}
    h1{font-size:18px;margin:0 0 8px} p{color:#c9c9d4;font-size:14px;line-height:1.5;margin:0 0 20px}
    a.btn{display:inline-block;background:#e11d48;color:#fff;text-decoration:none;font-weight:800;
          padding:12px 22px;border-radius:12px}
    .sub{margin-top:14px;color:#8a8a99;font-size:12px}
  </style>
</head>
<body>
  <div class="card">
    <h1>Returning to Spicy Meal…</h1>
    <p>العودة إلى تطبيق Spicy Meal…<br/>If the app doesn't open automatically, tap the button below.</p>
    <a class="btn" id="back" href="${deepLink.replace(/"/g, '&quot;')}">Return to the app</a>
    <div class="sub">You can safely close this tab.</div>
  </div>
  <script>
    (function () {
      try { window.location.replace(${deepJs}); } catch (e) {}
      setTimeout(function () { try { window.location.href = ${deepJs}; } catch (e) {} }, 400);
    })();
  </script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
});
