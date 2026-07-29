/**
 * Contrast audit for the admin console's Tailwind colour utilities.
 *
 * The console styles with utility classes rather than the mobile app's token
 * file, so it cannot be checked by reading one palette. This walks every
 * className string, resolves the effective background, and measures each
 * text/icon colour against it.
 *
 * Background resolution: a bg-* utility on the SAME element wins; otherwise the
 * element sits on the page ground. That ground is #f3f2f7 (index.css body) seen
 * through a translucent white panel — the panel only lightens it, so measuring
 * against #f3f2f7 is the conservative case for dark-on-light text.
 *
 * Usage:  node src/lib/a11yContrast.audit.mjs [--all] [--fix]
 *
 * --fix rewrites ONLY the occurrences this audit flags. That distinction
 * matters: the same utility can be correct or broken depending on what it sits
 * on — text-slate-400 is unreadable on the page ground at 2.30:1 but perfectly
 * fine on bg-slate-900. A blanket find-and-replace would wreck the dark panels.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE_GROUND = '#f3f2f7'; // index.css body background-color

// Files whose ROOT container is dark, so an element with no bg- utility of its
// own sits on that instead of the page. Getting this wrong is not cosmetic:
// assuming the light page inside a dark panel makes the fixer darken text that
// was already correct, turning readable light-on-dark into black-on-dark.
// #21293a is .glass-panel-dark (rgba(15,23,42,0.92)) composited over the body.
const DARK_ROOTS = {
  'src/components/DatabasePlayground.tsx': '#21293a',
};

// Tailwind default palette, only the shades this codebase uses.
const P = {
  'slate-50': '#f8fafc', 'slate-100': '#f1f5f9', 'slate-200': '#e2e8f0',
  'slate-300': '#cbd5e1', 'slate-400': '#94a3b8', 'slate-500': '#64748b',
  'slate-600': '#475569', 'slate-700': '#334155', 'slate-800': '#1e293b',
  'slate-900': '#0f172a', 'slate-950': '#020617',
  'gray-50': '#f9fafb', 'gray-100': '#f3f4f6', 'gray-300': '#d1d5db',
  'gray-400': '#9ca3af', 'gray-500': '#6b7280', 'gray-600': '#4b5563',
  'gray-700': '#374151', 'gray-800': '#1f2937', 'gray-900': '#111827',
  'green-50': '#f0fdf4', 'green-100': '#dcfce7', 'green-600': '#16a34a',
  'green-700': '#15803d', 'green-800': '#166534',
  'amber-50': '#fffbeb', 'amber-100': '#fef3c7', 'amber-500': '#f59e0b',
  'amber-600': '#d97706', 'amber-700': '#b45309', 'amber-800': '#92400e',
  'amber-900': '#78350f',
  'red-50': '#fef2f2', 'red-100': '#fee2e2', 'red-200': '#fecaca',
  'red-400': '#f87171', 'red-500': '#ef4444', 'red-600': '#dc2626',
  'red-700': '#b91c1c', 'red-800': '#991b1b', 'red-900': '#7f1d1d',
  'blue-100': '#dbeafe', 'blue-400': '#60a5fa', 'blue-500': '#3b82f6',
  'blue-600': '#2563eb', 'blue-700': '#1d4ed8', 'blue-800': '#1e40af',
  'emerald-400': '#34d399', 'emerald-500': '#10b981', 'emerald-600': '#059669',
  'emerald-700': '#047857', 'emerald-800': '#065f46',
  'purple-50': '#faf5ff', 'purple-300': '#d8b4fe', 'purple-400': '#c084fc',
  'purple-600': '#9333ea', 'purple-700': '#7e22ce',
  'indigo-100': '#e0e7ff', 'indigo-700': '#4338ca',
  'orange-100': '#ffedd5', 'orange-700': '#c2410c', 'orange-800': '#9a3412',
  'yellow-600': '#ca8a04', 'yellow-700': '#a16207',
  white: '#ffffff',
};

/** Composite `hex` at `alpha` over `ground` — Tailwind's bg-x/NN modifier. */
function composite(hex, alpha, ground) {
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.replace('#', '').slice(i - 1, i + 1), 16));
  const [r1, g1, b1] = rgb(hex);
  const [r2, g2, b2] = rgb(ground);
  const mix = (a, b) => Math.round(alpha * a + (1 - alpha) * b);
  return `#${[mix(r1, r2), mix(g1, g2), mix(b1, b2)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function luminance(hex) {
  const h = hex.replace('#', '');
  const ch = (i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(0) + 0.7152 * ch(2) + 0.0722 * ch(4);
}
function ratio(a, b) {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

// Any className-ish string literal: className="…", className={`…`}, or a
// ternary branch inside one. Splitting on quotes/braces keeps each candidate
// class list attached to the element it decorates.
const CLASS_RE = /class(?:Name)?\s*=\s*(?:"([^"]*)"|\{`([^`]*)`\}|\{[^}]*?["'`]([^"'`]*)["'`][^}]*\})/g;

/**
 * Nearest shade of the same hue that clears `need` on `bg`.
 *
 * Direction matters. On a light ground the text must get darker, so walk the
 * ramp 50 -> 950 and take the first shade that passes (the smallest darkening).
 * On a dark ground it must get lighter, so walk the ramp the other way. Always
 * searching one direction would suggest slate-50 for text on a dark panel — a
 * passing ratio, but a far bigger visual change than necessary.
 */
function suggest(fgName, bg, need) {
  const hue = fgName.split('-')[0];
  const ramp = Object.keys(P)
    .filter((n) => n.startsWith(`${hue}-`))
    .sort((a, b) => Number(a.split('-')[1]) - Number(b.split('-')[1]));
  const ordered = luminance(bg) > 0.5 ? ramp : [...ramp].reverse();
  return ordered.find((n) => ratio(P[n], bg) >= need);
}

const FIX = process.argv.includes('--fix');
const findings = [];
const touched = new Set();

for (const file of walk('src')) {
  const src = readFileSync(file, 'utf8');
  const lines = src.split('\n');
  let changed = false;

  const next = lines.map((line, i) => {
    let out = line;
    let m;
    const re = new RegExp(CLASS_RE.source, 'g');
    while ((m = re.exec(line))) {
      const cls = (m[1] || m[2] || m[3] || '');
      const fgm = cls.match(/\btext-([a-z]+-[0-9]{2,3})\b/);
      if (!fgm || !P[fgm[1]]) continue;
      const fg = P[fgm[1]];
      // Tailwind opacity modifiers matter: bg-emerald-500/10 is a 10% tint over
      // whatever is behind it, not a solid mid-tone green. Treating it as solid
      // resolves the ground far too dark and makes a light-on-light failure look
      // like a dark-on-dark one.
      const bgm = cls.match(/\bbg-([a-z]+-[0-9]{2,3})(?:\/([0-9]{1,3}))?\b/);
      const rootGround = DARK_ROOTS[file.split('\\').join('/')] ?? PAGE_GROUND;
      const bgName = bgm && P[bgm[1]] ? (bgm[2] ? `${bgm[1]}/${bgm[2]}` : bgm[1]) : 'page';
      const bg = bgName === 'page'
        ? rootGround
        : bgm[2]
          ? composite(P[bgm[1]], Number(bgm[2]) / 100, rootGround)
          : P[bgm[1]];
      // An element sized like a glyph is an icon: 1.4.11 asks 3:1, not 4.5:1.
      const isIcon = /\bw-\d+(\.\d+)?\b/.test(cls) && /\bh-\d+(\.\d+)?\b/.test(cls);
      const need = isIcon ? 3.0 : 4.5;
      const r = ratio(fg, bg);
      if (r >= need) continue;

      const fix = suggest(fgm[1], bg, need);
      findings.push({
        file, line: i + 1, fg: fgm[1], bg: bgName, fix,
        ratio: +r.toFixed(2), need, kind: isIcon ? 'icon' : 'text',
      });

      if (FIX && fix) {
        // Rewrite inside THIS className only, so an identical utility elsewhere
        // on the line (on a different element, over a different ground) is left
        // alone.
        const before = m[0];
        const after = before.replace(
          new RegExp(`\\btext-${fgm[1]}\\b`), `text-${fix}`,
        );
        if (after !== before) {
          out = out.replace(before, after);
          changed = true;
        }
      }
    }
    return out;
  });

  if (FIX && changed) {
    writeFileSync(file, next.join('\n'));
    touched.add(file);
  }
}

const byPair = new Map();
for (const f of findings) {
  const k = `${f.fg} on ${f.bg} (${f.kind})`;
  if (!byPair.has(k)) byPair.set(k, { ...f, count: 0, files: new Set() });
  const e = byPair.get(k);
  e.count += 1;
  e.files.add(f.file);
}

const rows = [...byPair.entries()].sort((a, b) => b[1].count - a[1].count);
console.log(`\n${findings.length} failing occurrences across ${rows.length} distinct pairs\n`);
console.log('count  ratio  need  pair');
console.log('-'.repeat(64));
for (const [k, v] of rows) {
  console.log(`${String(v.count).padStart(5)}  ${String(v.ratio).padStart(5)}  ${String(v.need).padStart(4)}  ${k}   [${v.files.size} file(s)]`);
}

if (process.argv.includes('--all')) {
  console.log('\nOccurrences:');
  for (const f of findings) console.log(`  ${f.file}:${f.line}  text-${f.fg} on ${f.bg}  ${f.ratio}:1`);
}

// Suggest the lightest shade of the same hue that clears the requirement.
console.log('\nSuggested replacements (same hue, smallest step that passes):');
for (const [k, v] of rows) {
  const [hue] = v.fg.split('-');
  const bg = v.bg === 'page' ? PAGE_GROUND
    : v.bg.includes('/')
      ? composite(P[v.bg.split('/')[0]], Number(v.bg.split('/')[1]) / 100, PAGE_GROUND)
      : P[v.bg];
  const candidates = Object.keys(P)
    .filter((n) => n.startsWith(`${hue}-`))
    .sort((a, b) => Number(a.split('-')[1]) - Number(b.split('-')[1]));
  const fix = candidates.find((n) => ratio(P[n], bg) >= v.need);
  console.log(`  ${k.padEnd(42)} -> ${fix ? `${fix} (${ratio(P[fix], bg).toFixed(2)}:1)` : 'no shade of this hue passes'}`);
}
console.log('');
if (FIX) console.log(`\nrewrote ${findings.filter((f) => f.fix).length} occurrence(s) across ${touched.size} file(s)`);
process.exit(findings.length && !FIX ? 1 : 0);
