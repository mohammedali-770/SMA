/**
 * The banner fetch must be owned by the SCREEN, not by the carousel.
 *
 * WHY THIS IS A TEST AND NOT A COMMENT. `BannerCarousel` used to fetch its own
 * rows on mount, which was correct while it was fixed chrome: the component
 * mounted with the screen, so its request ran concurrently with the menu load
 * and had usually resolved before the list appeared.
 *
 * PR #280 moved it to the `SectionList`'s `ListHeaderComponent`. A header does
 * not exist until the menu has loaded AND rendered, so a fetch owned by the
 * carousel starts only then — the two requests serialise. The header sits at
 * zero height (it returns null while there are no rows), then expands by
 * `width * 6/16` when they arrive and shoves the visible menu down. Worse, the
 * `headerHeight` ref that `onScrollToIndexFailed` relies on is populated by
 * `onLayout`, so during that window a category-chip tap falling through to the
 * fallback path computes its offset with a zero-height header — the exact bug
 * `headerHeight` was added to fix.
 *
 * Review caught it; no test did. The comments in both files explain the
 * reasoning, and a comment cannot fail. This can.
 *
 * The assertions are deliberately source-level, following
 * `IntegrationCard.test.ts` and `integrityRuleParity.test.ts`: the property is
 * about which module performs I/O, which is a structural fact rather than a
 * rendered output, and these components need a native runtime to render.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const CAROUSEL = new URL('./BannerCarousel.tsx', import.meta.url);
const SCREEN = new URL('./HomeMenuScreen.tsx', import.meta.url);

const carousel = readFileSync(CAROUSEL, 'utf8');
const screen = readFileSync(SCREEN, 'utf8');

/** Strip block and line comments so prose about the fetch cannot satisfy a check. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

const carouselCode = stripComments(carousel);
const screenCode = stripComments(screen);

describe('banner fetch ownership', () => {
  it('the carousel component does not fetch — it receives rows as a prop', () => {
    // The hook lives in this file too, so scope the check to the component body.
    const componentStart = carouselCode.indexOf('export function BannerCarousel');
    expect(componentStart).toBeGreaterThan(-1);
    const componentBody = carouselCode.slice(componentStart);
    expect(componentBody).not.toMatch(/catalog\s*\.?\s*\n?\s*\.banners\s*\(/);
    expect(componentBody).toMatch(/banners\s*:\s*HomeBanner\[\]/);
  });

  it('exposes the fetch as a hook the screen can call at mount', () => {
    expect(carouselCode).toMatch(/export function useHomeBanners\s*\(/);
    const hookStart = carouselCode.indexOf('export function useHomeBanners');
    const hookBody = carouselCode.slice(hookStart, carouselCode.indexOf('export function BannerCarousel'));
    expect(hookBody).toMatch(/\.banners\s*\(/);
  });

  it('the screen owns the fetch, so it starts before the list header exists', () => {
    expect(screenCode).toMatch(/useHomeBanners\s*\(\s*\)/);
    // Called at component scope, not inside the JSX that renders the list.
    const hookCall = screenCode.indexOf('useHomeBanners()');
    const returnIdx = screenCode.indexOf('return <View');
    expect(hookCall).toBeGreaterThan(-1);
    expect(returnIdx).toBeGreaterThan(-1);
    expect(hookCall).toBeLessThan(returnIdx);
  });

  it('every carousel usage is handed the rows — none can fall back to fetching', () => {
    const usages = [...screenCode.matchAll(/<BannerCarousel\b[^>]*>/g)].map((m) => m[0]);
    expect(usages.length).toBeGreaterThanOrEqual(3);
    for (const usage of usages) expect(usage).toMatch(/banners=\{banners\}/);
  });

  it('the list header still measures its height for the scroll fallback', () => {
    // Companion to the above: with the fetch hoisted the header has its real
    // height on first layout, which is what makes headerHeight trustworthy.
    expect(screenCode).toMatch(/headerHeight\.current\s*=\s*e\.nativeEvent\.layout\.height/);
    expect(screenCode).toMatch(/headerHeight\.current\s*\+\s*info\.averageItemLength/);
  });
});
