/**
 * Lazywait catalog matching — PURE name normalization + confidence scoring used
 * by the admin mapping UI to SUGGEST (never auto-apply) Lazywait id matches.
 *
 * Matching is done client-side over already-pulled, non-secret catalog data
 * (names/ids only — no secret ever reaches the browser). A suggestion is only
 * a hint: the admin must click Confirm, and anything below high confidence is
 * flagged as needing manual review.
 *
 * Handles Arabic (alef/hamza/taa-marbuta/tashkeel), Latin diacritics, and
 * Turkish letters (test data is sometimes Turkish-only), and is null-safe.
 */

export type MatchLevel = 'high' | 'medium' | 'low' | 'none';

/** Normalize a display name for comparison. Null/empty -> ''. Never throws. */
export function normalizeName(input: string | null | undefined): string {
  if (input == null) return '';
  let s = String(input);
  if (!s.trim()) return '';
  // Turkish letters -> ascii (do the dotted/dotless I before lowercasing).
  s = s
    .replace(/İ/g, 'i').replace(/I/g, 'i').replace(/ı/g, 'i')
    .replace(/[Şş]/g, 's').replace(/[Ğğ]/g, 'g').replace(/[Çç]/g, 'c')
    .replace(/[Öö]/g, 'o').replace(/[Üü]/g, 'u');
  s = s.toLowerCase();
  // Latin diacritics: decompose then drop combining marks.
  s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  // Arabic normalization.
  s = s
    .replace(/[ؐ-ًؚ-ٰٟۖ-ۭ]/g, '') // tashkeel/harakat
    .replace(/ـ/g, '')                       // tatweel
    .replace(/[آأإٱ]/g, 'ا') // alef variants -> ا
    .replace(/ى/g, 'ي')                 // alef maksura -> ya
    .replace(/ة/g, 'ه')                 // ta marbuta -> ha
    .replace(/ؤ/g, 'و')                 // waw-hamza -> waw
    .replace(/ئ/g, 'ي')                 // ya-hamza -> ya
    .replace(/ء/g, '');                       // lone hamza -> drop
  // Arabic-Indic digits -> ascii.
  s = s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  // Keep letters/numbers/space only, collapse whitespace.
  s = s.replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  return s;
}

function tokens(s: string): string[] {
  return s ? s.split(' ').filter(Boolean) : [];
}

function jaccard(a: string[], b: string[]): number {
  const A = new Set(a), B = new Set(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Similarity of two ALREADY-normalized names in [0,1]. */
export function pairScore(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ja = jaccard(tokens(a), tokens(b));
  let sub = 0;
  if (a.length >= 3 && b.length >= 3 && (a.includes(b) || b.includes(a))) {
    const shorter = Math.min(a.length, b.length);
    const longer = Math.max(a.length, b.length);
    sub = 0.6 + 0.3 * (shorter / longer);
  }
  return Math.max(ja, sub);
}

export function levelForScore(score: number): MatchLevel {
  if (score >= 0.995) return 'high';
  if (score >= 0.6) return 'medium';
  if (score >= 0.3) return 'low';
  return 'none';
}

export interface LocalNamed { nameEn?: string | null; nameAr?: string | null; }
export interface CatalogNamed {
  id?: string; lazywait_id?: string;
  name_en?: string | null; name_ar?: string | null; name_other?: string | null;
}

function localNames(l: LocalNamed): string[] {
  return [normalizeName(l.nameEn), normalizeName(l.nameAr)].filter(Boolean);
}
function catalogNames(c: CatalogNamed): string[] {
  return [normalizeName(c.name_en), normalizeName(c.name_ar), normalizeName(c.name_other)].filter(Boolean);
}

/** Best similarity between a local record and a catalog candidate. */
export function scoreNames(local: LocalNamed, candidate: CatalogNamed): number {
  const ln = localNames(local);
  const cn = catalogNames(candidate);
  let best = 0;
  for (const a of ln) for (const b of cn) best = Math.max(best, pairScore(a, b));
  return best;
}

export interface MatchSuggestion<C extends CatalogNamed = CatalogNamed> {
  candidate: C;
  score: number;
  level: MatchLevel;
  /** true unless the match is high-confidence — the admin should verify first. */
  requiresConfirmation: boolean;
}

/**
 * Best candidate for a local record, or null if nothing is even a weak match.
 * Ties resolve to the first candidate (stable). The result is only a hint — the
 * caller must require an explicit Confirm, especially when requiresConfirmation.
 */
export function suggestBestMatch<C extends CatalogNamed>(
  local: LocalNamed, candidates: C[],
): MatchSuggestion<C> | null {
  let best: MatchSuggestion<C> | null = null;
  for (const c of candidates) {
    const score = scoreNames(local, c);
    if (!best || score > best.score) {
      best = { candidate: c, score, level: levelForScore(score), requiresConfirmation: true };
    }
  }
  if (!best || best.level === 'none') return null;
  best.requiresConfirmation = best.level !== 'high';
  return best;
}
