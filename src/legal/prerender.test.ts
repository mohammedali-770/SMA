import { describe, expect, it } from 'vitest';

import type { PublicLegalDoc } from './legalPage';
import { PRERENDER_END, PRERENDER_START, escapeHtml, injectPrerender, renderStaticLegal } from './prerender';

function doc(over: Partial<PublicLegalDoc> = {}): PublicLegalDoc {
  return {
    document_type: 'privacy_policy',
    title_en: 'Privacy Policy',
    title_ar: 'سياسة الخصوصية',
    content_en: 'We collect your phone number.',
    content_ar: 'نجمع رقم هاتفك.',
    version: '2.1',
    effective_date: '2026-09-08',
    ...over,
  };
}

describe('escapeHtml — the whole reason this module can use string concatenation', () => {
  it('escapes all five characters that break out of content or a quoted attribute', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });

  it('escapes the ampersand first, so an escape is never double-processed', () => {
    // Naive ordering turns < into &lt; and then the & into &amp;lt;
    expect(escapeHtml('<')).toBe('&lt;');
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });

  it('leaves ordinary text, including Arabic, untouched', () => {
    expect(escapeHtml('نجمع رقم هاتفك.')).toBe('نجمع رقم هاتفك.');
  });
});

describe('renderStaticLegal — admin-authored text is data, never markup', () => {
  it('neutralises a script tag in a document body', () => {
    const html = renderStaticLegal([doc({ content_en: '<script>alert(1)</script>' })], '2026-09-15');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('neutralises an img/onerror payload in a TITLE, not just a body', () => {
    const html = renderStaticLegal([doc({ title_en: '<img src=x onerror=alert(1)>' })], '2026-09-15');
    // The property is that no TAG is produced, not that the characters vanish:
    // `onerror=alert(1)` survives as inert text inside an escaped &lt;img…&gt;,
    // which is correct and is what the first version of this test got wrong.
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toMatch(/<[a-zA-Z][^>]*\son\w+=/);
  });

  it('neutralises a quote that would otherwise escape the id attribute', () => {
    const html = renderStaticLegal([doc({ document_type: 'a"onload="x' })], '2026-09-15');
    expect(html).not.toMatch(/id="doc-[^"]*"[^>]*onload/);
  });

  it('emits both languages, because a scanner does not click the toggle', () => {
    const html = renderStaticLegal([doc()], '2026-09-15');
    expect(html).toContain('We collect your phone number.');
    expect(html).toContain('نجمع رقم هاتفك.');
    expect(html).toContain('dir="rtl"');
  });

  it('carries the build date so the snapshot does not read as live', () => {
    expect(renderStaticLegal([doc()], '2026-09-15')).toContain('2026-09-15');
  });

  it('skips a language that has no content rather than emitting an empty body', () => {
    const html = renderStaticLegal([doc({ content_ar: null })], '2026-09-15');
    expect(html).toContain('We collect your phone number.');
    expect(html).not.toContain('lang="ar"');
  });

  it('returns empty when nothing usable came back, so the caller can fail open', () => {
    expect(renderStaticLegal([], '2026-09-15')).toBe('');
    expect(renderStaticLegal([doc({ content_en: null, content_ar: null })], '2026-09-15')).toBe('');
  });

  it('contains the word a policy scanner looks for', () => {
    // The literal defect B7 recorded: the served page had no such word in it.
    expect(renderStaticLegal([doc()], '2026-09-15').toLowerCase()).toContain('privacy');
  });
});

describe('injectPrerender — atomic, or not at all', () => {
  const page = `<body><main id="app"></main>\n${PRERENDER_START}\n<noscript>needs JS</noscript>\n${PRERENDER_END}\n</body>`;

  it('replaces the whole bracketed region, removing the JavaScript notice', () => {
    const out = injectPrerender(page, '<div id="prerendered">text</div>');
    expect(out).not.toBeNull();
    expect(out).not.toContain('needs JS');
    expect(out).not.toContain(PRERENDER_START);
    expect(out).toContain('<div id="prerendered">text</div>');
    expect(out).toContain('<main id="app"></main>');
  });

  it('returns null when a marker is missing, so the caller leaves the file alone', () => {
    expect(injectPrerender('<body>no markers</body>', 'x')).toBeNull();
    expect(injectPrerender(`<body>${PRERENDER_START}</body>`, 'x')).toBeNull();
  });

  it('returns null when the markers are inverted rather than emitting a broken page', () => {
    expect(injectPrerender(`<body>${PRERENDER_END}...${PRERENDER_START}</body>`, 'x')).toBeNull();
  });
});
