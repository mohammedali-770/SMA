/**
 * The console document's language, kept in step with the console's.
 *
 * WHY. A screen reader picks its pronunciation rules from `<html lang>`. The
 * console ships `lang="en"` in `index.html` and nothing changed it, so with
 * Arabic on, the sign-in screen and the operations consoles were read with
 * English rules (WCAG 3.1.1, Level A). axe cannot see this: `html-has-lang`
 * only asks that the attribute exists.
 *
 * LANG ONLY, NEVER `dir`. Each surface already sets `dir` on its own wrapper,
 * and the admin console's Tailwind layout is written against that wrapper. A
 * root `dir` would change what every `rtl:` variant and logical property
 * resolves against, for every surface at once.
 *
 * Three callers, one per language source: `useOpsLang` (sign-in, access
 * notices, branch and call-centre consoles) and `AdminDashboard` (`adminLang`).
 * Only one of those surfaces is mounted at a time.
 */

/** Both consoles speak these two. */
export type DocumentLang = 'en' | 'ar';

/** The one part of `Document` this touches. */
export interface LangDocument {
  documentElement?: { lang: string } | null;
}

/**
 * Sets `<html lang>` to `lang`. Returns whether it wrote, so a caller can tell
 * a no-op from a change. Never touches `dir`.
 */
export function applyDocumentLang(
  lang: DocumentLang,
  doc: LangDocument | undefined | null = typeof document === 'undefined' ? undefined : document,
): boolean {
  const root = doc?.documentElement;
  if (!root) return false;
  if (root.lang === lang) return false;
  root.lang = lang;
  return true;
}
