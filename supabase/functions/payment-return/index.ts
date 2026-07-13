import { corsHeaders } from '../_shared/cors.ts';
import { buildReturnDeepLink, escapeHtmlAttr } from './returnLink.ts';

/**
 * payment-return — the HTTPS URL Tap redirects the customer's browser to after
 * checkout (Tap requires a real https redirect target; a raw app scheme is not
 * reliable). This page marks NOTHING paid: it only bounces back into the app via
 * the fixed spicymeal:// deep link so the app can run the authoritative server
 * verification (payment-verify).
 *
 * Open-redirect safe: it only ever navigates to our own fixed scheme + path, and
 * the single `order` / `session` parameter is passed through only after strict
 * UUID validation. Tap's tap_id and any other query params are IGNORED (untrusted).
 *
 * RENDER FIX: the previous version carried an inline <script> that did a
 * window.location redirect. Cloudflare's edge classified that as an active
 * client-side redirect and NEUTRALISED the response — serving it as `text/plain`
 * under a `default-src 'none'; sandbox` CSP, which showed the HTML as raw source
 * AND blocked the redirect. This version uses the same platform-safe shape as
 * tap-admin-test-return: NO inline script (a passive <meta http-equiv="refresh">
 * plus a manual button handle the return), the HTML emitted as explicit UTF-8
 * bytes, and a fixed `text/html; charset=utf-8` Content-Type. No sensitive data,
 * no confirmation logic. In the in-app WebView flow this page is intercepted by
 * the navigation policy and never actually rendered; this keeps the browser
 * fallback / cold-start path correct too.
 */
Deno.serve((req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const url = new URL(req.url);
  const deepLink = buildReturnDeepLink(url.searchParams.get('order'), url.searchParams.get('session'));
  const href = escapeHtmlAttr(deepLink);

  const html = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="refresh" content="0; url=${href}" />
  <title>Spicy Meal — returning to the app</title>
  <style>
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0f0f14;color:#fff;
         display:flex;min-height:100vh;margin:0;align-items:center;justify-content:center;text-align:center;padding:24px}
    .card{max-width:360px}
    h1{font-size:18px;margin:0 0 4px} h2{font-size:14px;font-weight:600;color:#c9c9d4;margin:0 0 12px}
    p{color:#c9c9d4;font-size:14px;line-height:1.6;margin:0 0 20px}
    a.btn{display:inline-block;background:#e11d48;color:#fff;text-decoration:none;font-weight:800;
          padding:12px 22px;border-radius:12px}
    .sub{margin-top:14px;color:#8a8a99;font-size:12px;line-height:1.6}
  </style>
</head>
<body>
  <div class="card">
    <h1>العودة إلى تطبيق Spicy Meal…</h1>
    <h2>Returning to Spicy Meal…</h2>
    <p>إذا لم يفتح التطبيق تلقائياً، اضغط الزر بالأسفل.<br/>If the app doesn’t open automatically, tap the button below.</p>
    <a class="btn" href="${href}">العودة إلى التطبيق · Return to the app</a>
    <div class="sub">يمكنك إغلاق هذه الصفحة بأمان · You can safely close this tab.</div>
  </div>
</body>
</html>`;

  const body = new TextEncoder().encode(html);
  return new Response(body, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': String(body.byteLength),
      'Cache-Control': 'no-store',
    },
  });
});
