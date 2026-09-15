/**
 * Build-time rendering of the public legal documents into `legal.html`.
 *
 * WHY THIS EXISTS. `docs/GO_LIVE_READINESS.md` B7 was marked verified on the
 * strength of the page returning HTTP 200 with the right title, and the
 * anonymous PostgREST read behind it succeeding. Both are true and neither is
 * what a store reviewer's tooling looks at. Strip `<script>` from the live
 * response and 253 visible characters remain — a notice saying the documents
 * need JavaScript — in which the word "privacy" does not appear once. Play's
 * policy-URL validation does not execute JavaScript, so a required privacy
 * policy read as absent.
 *
 * The fix is to put the text in the HTML before any script runs. The runtime
 * fetch is unchanged and still authoritative for anyone with JavaScript; this
 * only adds a static copy underneath it.
 *
 * THREE THINGS THIS DELIBERATELY GETS RIGHT, each of which is a way to get it
 * wrong:
 *
 * 1. EVERY interpolated value is HTML-escaped. `main.ts` renders document text
 *    with `textContent` and says why: the bodies are edited by administrators
 *    in the console, so treating them as markup would turn the legal editor
 *    into a stored-XSS surface on the one page designed to be reachable by
 *    anyone. Moving to string concatenation removes that protection unless it
 *    is replaced explicitly, which is what `escapeHtml` is for.
 *
 * 2. The snapshot is a FALLBACK, not the page. It is what a non-JavaScript
 *    client sees; a browser hides it the moment the module boots and renders
 *    live rows. So editing a document in the admin console still updates the
 *    page with no redeploy for every real visitor — the static copy is the only
 *    part that goes stale, and it goes stale into "slightly old policy text",
 *    not "wrong page". It carries its build date so that is visible rather than
 *    implied.
 *
 * 3. A failed fetch at build time must NOT fail the build. Deploys would then
 *    depend on the database being reachable from CI, which is a worse outcome
 *    than the page behaving exactly as it does today. The plugin warns and
 *    leaves the HTML untouched.
 */
import type { PublicLegalDoc } from './legalPage';
import { orderDocs, slugForType } from './legalPage';

/**
 * The region of `legal.html` the build replaces. The source file brackets the
 * existing `<noscript>` notice between these, so a successful render swaps the
 * notice for the documents and a failed one leaves the file byte-identical to
 * what ships today. One replacement, atomic by construction — there is no state
 * where the page claims it needs JavaScript while the text sits above it.
 */
export const PRERENDER_START = '<!--prerender:legal:start-->';
export const PRERENDER_END = '<!--prerender:legal:end-->';

/**
 * Replaces the bracketed region with `block`. Returns null when the markers are
 * absent or out of order, so the caller can warn and leave the file alone
 * rather than emitting a half-substituted page.
 */
export function injectPrerender(html: string, block: string): string | null {
  const start = html.indexOf(PRERENDER_START);
  const end = html.indexOf(PRERENDER_END);
  if (start === -1 || end === -1 || end < start) return null;
  return html.slice(0, start) + block + html.slice(end + PRERENDER_END.length);
}

/**
 * Escapes text for insertion into HTML element content or a double-quoted
 * attribute. Covers the five characters that can break out of either context.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function section(doc: PublicLegalDoc): string {
  const slug = escapeHtml(slugForType(doc.document_type));
  const parts: string[] = [`<article id="doc-${slug}">`];

  // Both languages are emitted, because a scanner does not click a toggle and
  // the Arabic policy is as load-bearing as the English one for a Saudi
  // audience. A browser never sees this block at all.
  for (const [lang, dir, title, body] of [
    ['en', 'ltr', doc.title_en, doc.content_en],
    ['ar', 'rtl', doc.title_ar, doc.content_ar],
  ] as const) {
    if (!body) continue;
    parts.push(`<h2 lang="${lang}" dir="${dir}">${escapeHtml(title ?? doc.document_type)}</h2>`);
    const meta = [doc.version && `v${doc.version}`, doc.effective_date].filter(Boolean).join(' · ');
    if (meta) parts.push(`<p class="meta" lang="${lang}" dir="${dir}">${escapeHtml(meta)}</p>`);
    parts.push(`<div class="body" lang="${lang}" dir="${dir}">${escapeHtml(body)}</div>`);
  }

  parts.push('</article>');
  return parts.join('\n');
}

/**
 * Renders the static fallback block. `builtOn` is passed in rather than read
 * from the clock so the output is a pure function of its inputs and can be
 * asserted in a test.
 */
export function renderStaticLegal(docs: readonly PublicLegalDoc[], builtOn: string): string {
  const usable = orderDocs(docs).filter((d) => d.content_en || d.content_ar);
  if (usable.length === 0) return '';

  return [
    '<div id="prerendered">',
    '<h1>Legal &amp; Policies — Spicy Meal</h1>',
    `<p class="notice">Published documents as of ${escapeHtml(builtOn)}. ` +
      'The current versions are always shown in the Spicy Meal app under Profile → Legal.</p>',
    ...usable.map(section),
    '<p class="contact">Contact: info@spicymeal.com.sa · 9200 31495</p>',
    '</div>',
  ].join('\n');
}
