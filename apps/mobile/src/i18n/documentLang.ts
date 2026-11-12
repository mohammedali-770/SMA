/**
 * The web document's language, kept in step with the app's.
 *
 * WHY. A screen reader picks its pronunciation rules from `<html lang>`. The
 * web export ships `lang="en"` in its HTML and nothing changed it, so with
 * Arabic on, every Arabic word was read with English rules or skipped (WCAG
 * 3.1.1, Level A). axe cannot see this: `html-has-lang` only asks that the
 * attribute exists.
 *
 * LANG ONLY, NEVER `dir`. The layout already mirrors itself per component
 * (`rtlRow` is `row-reverse` in Arabic). `dir="rtl"` on the root would make
 * every CSS flex row run right-to-left as well, flipping those rows a second
 * time and putting them back to front.
 *
 * Framework-free so it is unit-tested under Node; the caller decides whether
 * there is a document at all (`Platform.OS === 'web'`).
 */
import type { Lang } from './strings';

/** The one part of `Document` this touches. */
export interface LangDocument {
  documentElement?: { lang: string } | null;
}

/**
 * Sets `<html lang>` to `lang`. Returns whether it wrote, so a caller can tell
 * a no-op from a change. Never touches `dir`.
 */
export function applyDocumentLang(lang: Lang, doc: LangDocument | undefined | null): boolean {
  const root = doc?.documentElement;
  if (!root) return false;
  if (root.lang === lang) return false;
  root.lang = lang;
  return true;
}
