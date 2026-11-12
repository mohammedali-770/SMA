import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/*
 * The brand mark is the LCP element of the launch intro and of the order-type
 * chooser. expo-image on web defaults `loading` to "lazy" and sets no fetch
 * priority, so on a throttled cold load it queued behind ~700 KB of fonts and
 * the menu photos and finished at 70.7 s. Those two first-screen marks are eager
 * and high priority; every later one keeps the default so it cannot compete with
 * them. Read from source because these files import React Native.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

/** The JSX of every <Image …/> whose source is the brand mark. */
function markElements(src: string): string[] {
  return [...src.matchAll(/<Image\b[\s\S]*?\/>/g)]
    .map((m) => m[0])
    .filter((el) => el.includes('logo-mark.png') || /source=\{MARK\}/.test(el));
}

describe('first-screen brand marks load eagerly at high priority', () => {
  it.each([
    ['launch intro', '../../app/index.tsx'],
    ['order-type chooser', './LaunchOrderTypeModal.tsx'],
  ])('%s', (_label, path) => {
    const marks = markElements(read(path));
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatch(/\spriority="high"/);
    expect(marks[0]).toMatch(/\sloading="eager"/);
  });
});

describe('later marks keep the default, so they do not compete', () => {
  it.each([
    ['home header', '../menu/HomeMenuScreen.tsx'],
    ['logo lockup', '../../components/Logo.tsx'],
  ])('%s', (_label, path) => {
    const marks = markElements(read(path));
    expect(marks.length).toBeGreaterThan(0);
    for (const mark of marks) {
      expect(mark).not.toMatch(/priority=/);
      expect(mark).not.toMatch(/loading=/);
    }
  });
});
