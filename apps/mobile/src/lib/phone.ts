/**
 * Client-side E.164 normalization (KSA-aware), mirroring the server's
 * `_shared/whatsapp.ts` `normalizePhoneE164`. Both `signInWithOtp` and
 * `verifyOtp` must be called with the SAME canonical phone string, and it must
 * match what the Send SMS hook derives from Supabase's payload — so we normalize
 * once, here, before either call. Returns `null` on anything that isn't a clean
 * phone number (fail closed; never pass junk to auth).
 */
export function toE164(input: string | null | undefined): string | null {
  if (!input) return null;
  const raw = String(input).trim();
  // Only phone punctuation is allowed (anti-injection; matches the server).
  if (!/^[\d+\s().-]+$/.test(raw)) return null;
  let d = raw.replace(/[^\d+]/g, '');
  if (d.startsWith('00')) d = '+' + d.slice(2);
  if (!d.startsWith('+')) {
    if (d.startsWith('966')) d = '+' + d;
    else if (d.startsWith('05') && d.length === 10) d = '+966' + d.slice(1);
    else if (d.startsWith('5') && d.length === 9) d = '+966' + d;
    else if (d.length >= 8 && d.length <= 15) d = '+' + d; // assume international
    else return null;
  }
  if (!/^\+[1-9]\d{7,14}$/.test(d)) return null;
  // KSA sanity: +966 must be a 9-digit national part starting with 5.
  if (d.startsWith('+966') && !/^\+9665\d{8}$/.test(d)) return null;
  return d;
}
