import { corsHeaders } from '../_shared/cors.ts';

/**
 * payment-admin-test-return - the HTTPS page the admin's browser lands on after
 * the isolated sandbox test in payment-test-config (`test_checkout`). The test
 * invoice uses it as both its success_url and its back_url, because the hosted
 * checkout needs a real https target to send the browser back to. It is purely
 * informational: it shows nothing sensitive and marks NOTHING paid - the
 * dashboard verifies the result server-side (`test_checkout_result`). Every
 * query parameter appended to the URL is ignored as untrusted. No order or
 * payment effects.
 *
 * Renamed from tap-admin-test-return on 2026-11-11, when Moyasar became the
 * only payment provider. The page itself names no provider.
 *
 * Rendering notes (why this looks slightly unusual):
 *  - Content-Type is "text/HTML; charset=utf-8". Browsers match media types
 *    case-insensitively (RFC 2045), so this renders as HTML. The exact lowercase
 *    token "text/html" is rewritten by the Supabase shared functions domain to
 *    "text/plain" + a sandbox CSP (anti-phishing on *.supabase.co), which makes
 *    browsers show the raw source and drop the charset. The cased subtype keeps
 *    the platform from neutralizing it while staying a valid HTML content type.
 *    payment-return relies on the same technique.
 *  - The body is emitted as explicit UTF-8 bytes (TextEncoder) so the runtime
 *    cannot reinterpret the string encoding, and the <meta charset> keeps the
 *    Arabic correct even if a downstream charset were dropped.
 */
const PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Spicy Meal - sandbox test complete</title>
  <style>
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0f0f14;color:#fff;
         display:flex;min-height:100vh;margin:0;align-items:center;justify-content:center;text-align:center;padding:24px}
    .card{max-width:380px}
    h1{font-size:18px;margin:0 0 8px} p{color:#c9c9d4;font-size:14px;line-height:1.55;margin:0 0 8px}
    .tag{display:inline-block;background:#78350f;color:#fcd34d;font-weight:800;font-size:11px;
         padding:3px 10px;border-radius:999px;margin-bottom:12px}
    .ar{margin-top:20px}
  </style>
</head>
<body>
  <div class="card">
    <div class="tag">SANDBOX &middot; TEST</div>
    <h1>Test checkout complete</h1>
    <p>You can close this tab and return to the Spicy Meal admin dashboard, then check the test result there.</p>
    <p>This was a sandbox test: no Spicy Meal order was created and no money was charged.</p>
    <div class="ar" lang="ar" dir="rtl">
      <h1>اكتمل اختبار الدفع</h1>
      <p>يمكنك إغلاق هذه الصفحة والعودة إلى لوحة تحكم Spicy Meal، ثم التحقق من نتيجة الاختبار هناك.</p>
      <p>كان هذا اختباراً في البيئة التجريبية: لم يُنشأ أي طلب في Spicy Meal ولم يُخصم أي مبلغ.</p>
    </div>
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
