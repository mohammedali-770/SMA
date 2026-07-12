import { corsHeaders } from '../_shared/cors.ts';

/**
 * tap-admin-test-return — the HTTPS page Tap redirects the admin's browser to
 * after the isolated admin TEST checkout (Tap requires an https redirect target
 * for 3DS). It is purely informational: it shows nothing sensitive and marks
 * NOTHING — the dashboard verifies the result server-side via Retrieve Charge.
 * The tap_id query param is ignored here (untrusted). No order/payment effects.
 */
Deno.serve((req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Spicy Meal — Tap sandbox test complete</title>
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
    <div class="tag">TAP SANDBOX · TEST</div>
    <h1>Test checkout complete</h1>
    <p>You can close this tab and return to the Spicy Meal admin dashboard, then tap
       <b>“Check test result”</b> to see the verified status.</p>
    <p>This was a sandbox test — no Spicy Meal order was created or charged.</p>
  </div>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
});
