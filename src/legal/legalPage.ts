/**
 * Pure logic for the PUBLIC legal page (`/legal`), kept out of the DOM module so
 * it can be tested directly — the same split as
 * `src/components/admin/view/branches/workingHours.ts`.
 *
 * WHY THIS PAGE EXISTS AT ALL. Both App Store Connect and Play Console require a
 * privacy-policy URL that a reviewer can open in a browser with no account and no
 * login. An in-app screen does not satisfy that, and until now every path on this
 * domain rewrote to the admin console shell, so no such URL existed.
 *
 * It deliberately shares the canonical registry in `src/lib/legal.ts` rather than
 * restating the document list: a public page that disagreed with the app about
 * which documents exist would be worse than no page.
 */
import { LEGAL_DOC_TITLES, legalDocOrder, type LegalDocumentType } from '../lib/legal';

export type Lang = 'en' | 'ar';

/** One active document as the public page needs it. */
export interface PublicLegalDoc {
  document_type: string;
  title_en: string | null;
  title_ar: string | null;
  content_en: string | null;
  content_ar: string | null;
  version: string | null;
  effective_date: string | null;
}

/** URL slug for a document type: `privacy_policy` -> `privacy-policy`. */
export function slugForType(type: string): string {
  return type.replace(/_/g, '-').toLowerCase();
}

/**
 * `decodeURIComponent` that returns null instead of throwing.
 *
 * A stale or mistyped link carrying an incomplete escape — `/legal/privacy%` —
 * raises URIError, and this runs on the render path AFTER the fetch resolves, so
 * an uncaught throw leaves the page on "Loading…" forever. To a store reviewer
 * that is indistinguishable from a broken policy URL, which is the one outcome
 * this whole page exists to prevent.
 */
function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/** What a pathname asks for: the index, or one document identified by slug. */
export type PathRequest = { kind: 'index' } | { kind: 'doc'; slug: string };

/**
 * Which document a pathname asks for.
 *
 * It resolves to a SLUG rather than to a registered document type, and that is
 * the point: `orderDocs` deliberately keeps a row whose type this build has never
 * heard of, and `renderIndex` links to it. Resolving against the static registry
 * here made those links bounce straight back to the index — a visible document
 * that could not be opened. Matching happens against the FETCHED rows instead,
 * in `findBySlug`.
 *
 * Accepts `/legal`, `/legal/`, `/legal/privacy-policy` and the aliases
 * `/privacy`, `/terms` and `/support` that go into the store listings, because a
 * listing URL is pasted once and is then effectively permanent.
 */
export function requestFromPath(pathname: string): PathRequest {
  const path = pathname.replace(/\/+$/, '').toLowerCase();
  const alias: Record<string, LegalDocumentType> = {
    '/privacy': 'privacy_policy',
    '/terms': 'terms_conditions',
    '/support': 'contact_support',
  };
  if (alias[path]) return { kind: 'doc', slug: slugForType(alias[path]) };
  const match = /^\/legal\/(.+)$/.exec(path);
  if (!match) return { kind: 'index' };
  const decoded = safeDecode(match[1]);
  return decoded === null ? { kind: 'index' } : { kind: 'doc', slug: decoded.trim() };
}

/**
 * The fetched document a slug names, or undefined.
 *
 * Matching against the fetched rows is what keeps an unknown-but-published
 * document reachable. An unmatched slug still returns undefined and the caller
 * falls through to the index, so a bad link never renders a confidently wrong
 * policy — the property the registry lookup used to provide.
 */
export function findBySlug<T extends { document_type: string }>(
  docs: readonly T[],
  slug: string,
): T | undefined {
  const wanted = slug.toLowerCase();
  return docs.find((d) => slugForType(d.document_type) === wanted);
}

/**
 * Preferred language from the browser. Arabic only when the browser actually asks
 * for it: a store reviewer's machine is almost always English, and showing them a
 * document they cannot read is the failure mode that matters here.
 */
export function preferredLang(languages: readonly string[] | undefined): Lang {
  const first = (languages ?? []).find((l) => typeof l === 'string' && l.length > 0);
  return first?.toLowerCase().startsWith('ar') ? 'ar' : 'en';
}

/**
 * Pick a localised field, falling back to the other language when the preferred
 * one is missing or blank. A half-translated row must still render something —
 * an empty privacy policy is a rejected submission.
 */
export function pickText(en: string | null, ar: string | null, lang: Lang): string {
  const primary = (lang === 'ar' ? ar : en) ?? '';
  if (primary.trim().length > 0) return primary;
  const fallback = (lang === 'ar' ? en : ar) ?? '';
  return fallback;
}

/** The display title for a document, preferring the row's own title. */
export function docTitle(doc: PublicLegalDoc, lang: Lang): string {
  const stored = pickText(doc.title_en, doc.title_ar, lang);
  if (stored.trim().length > 0) return stored;
  const canonical = LEGAL_DOC_TITLES[doc.document_type as LegalDocumentType];
  return canonical ? canonical[lang] : doc.document_type;
}

/**
 * Documents in canonical display order. Rows whose type the registry does not
 * know are kept rather than dropped — a document published from the admin console
 * that this build has not heard of should still be readable.
 */
export function orderDocs<T extends { document_type: string }>(rows: readonly T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      legalDocOrder(a.document_type) - legalDocOrder(b.document_type) ||
      a.document_type.localeCompare(b.document_type),
  );
}

/** The metadata line under a document, or '' when the row carries neither field. */
export function metaLine(doc: PublicLegalDoc, lang: Lang): string {
  const parts: string[] = [];
  if (doc.version) parts.push(`${lang === 'ar' ? 'الإصدار' : 'Version'} ${doc.version}`);
  if (doc.effective_date) {
    parts.push(`${lang === 'ar' ? 'ساري من' : 'Effective'} ${doc.effective_date}`);
  }
  return parts.join(' · ');
}
