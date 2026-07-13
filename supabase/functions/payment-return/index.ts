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
 * RENDER FIX (content-type CASE — verified live): the Supabase shared *.functions
 * edge rewrites the exact lowercase token `text/html` to `text/plain` + a
 * `default-src 'none'; sandbox` CSP (an anti-phishing measure on *.supabase.co),
 * which shows the page as RAW SOURCE and blocks its redirect. The cased subtype
 * `text/HTML` is matched case-insensitively by browsers (RFC 2045) yet is NOT
 * caught by that lowercase rewrite — so the page renders as real HTML and the
 * redirect fires. (Same technique the tap-admin-test-return page documents; the
 * inline <script>/meta-refresh/app-scheme were NOT the trigger — the lowercase
 * content-type was.) The body is emitted as explicit UTF-8 bytes so the runtime
 * cannot reinterpret the encoding, and the <meta charset> in the head keeps the
 * Arabic correct even if a downstream charset were dropped. No sensitive data, no
 * confirmation logic. In the in-app WebView (TEST) flow this page is intercepted
 * by the navigation policy and never rendered; this keeps the external-browser /
 * cold-start path correct too.
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
      // Cased subtype avoids the platform's lowercase text/html -> text/plain +
      // sandbox rewrite; browsers still treat it as HTML. See the note above.
      'Content-Type': 'text/HTML; charset=utf-8',
      'Content-Length': String(body.byteLength),
      'Cache-Control': 'no-store',
    },
  });
});
