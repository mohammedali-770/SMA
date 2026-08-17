/**
 * Spicy Meal brand mark (admin console).
 *
 * Renders the OFFICIAL production logo — the chef-rooster mascot — from
 * `public/logo-mark.png`. That file is derived from the approved master
 * `public/logo.png` by `scripts/build-logo-mark.mjs`, which knocks the white
 * backdrop out of the square so the mark sits on the surface behind it instead
 * of punching a white tile through it. The mobile app renders the same derived
 * file, so the console and the app show the same mark.
 *
 * The master keeps its opaque backdrop because it is also the store icon, and
 * iOS rejects app icons that carry an alpha channel.
 *
 * Do not substitute a redrawn or vector "reinterpretation" of the mascot: the
 * PNG is the approved asset and there is no official SVG in the repo.
 *
 * Consolidates the `<img src="/logo.png">` markup that was duplicated in
 * App.tsx and AuthScreen.tsx.
 */
import React from 'react';

/** Path is served from `public/`, so it is origin-relative and cache-busted by deploy. */
const LOGO_SRC = '/logo-mark.png';

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
