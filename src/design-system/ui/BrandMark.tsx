/**
 * Spicy Meal brand mark (admin console).
 *
 * Renders the OFFICIAL production logo — `public/logo.png`, the chef-rooster
 * mascot. That exact file is also the iOS/Android app icon and the mobile
 * splash image (`assets/icon.png` and `apps/mobile/assets/icon.png` are
 * byte-identical to it), so the console and the app show the same mark.
 *
 * Do not substitute a redrawn or vector "reinterpretation" of the mascot: the
 * PNG is the approved asset and there is no official SVG in the repo.
 *
 * Consolidates the `<img src="/logo.png">` markup that was duplicated in
 * App.tsx and AuthScreen.tsx.
 */
import React from 'react';

/** Path is served from `public/`, so it is origin-relative and cache-busted by deploy. */
const LOGO_SRC = '/logo.png';

export function BrandMark({
  className = '',
  alt = 'Spicy Meal logo',
}: {
  className?: string;
  /** Pass an empty string when an adjacent wordmark already names the brand. */
  alt?: string;
}) {
  return (
    <img
      src={LOGO_SRC}
      alt={alt}
      // Decorative when the caller supplies an adjacent text label.
      aria-hidden={alt === '' ? true : undefined}
      className={className}
    />
  );
}
