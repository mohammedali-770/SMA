import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../..');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const read = (p: string) => strip(readFileSync(join(ROOT, p), 'utf8'));

/** F-TA3-001: the screens must not show "signed out" while the session is still stored. */
describe('sign-out only resets the screen after the session really ended', () => {
  it('console: resetToGuest runs after a successful auth.signOut and not when it throws', () => {
    const src = read('src/context/AppContext.tsx');
    const body = src.slice(src.indexOf('const signOut = useCallback'));
    const block = body.slice(0, body.indexOf('[resetToGuest, flushSettings]'));
    expect(block).toMatch(
      /try \{\s*await auth\.signOut\(\);\s*\} catch \{[\s\S]*?window\.alert\([\s\S]*?return;\s*\}\s*resetToGuest\(\);/,
    );
  });

  it('mobile: the service throws on failure and both callers handle it', () => {
    expect(read('apps/mobile/src/services/api.ts')).toMatch(
      /async signOut\(\) \{\s*const \{ error \} = await supabase\.auth\.signOut\(\);\s*if \(error\) throw new Error\(error\.message\);/,
    );
    expect(read('apps/mobile/src/features/profile/ProfileScreen.tsx')).toMatch(
      /try \{\s*await signOut\(\);\s*\} catch \{[\s\S]*?Alert\.alert/,
    );
    expect(read('apps/mobile/src/features/account/DeleteAccountScreen.tsx')).toMatch(
      /try \{\s*await signOut\(\);\s*\} catch \{[\s\S]*?finishedRef\.current = false;[\s\S]*?return;\s*\}\s*router\.replace\('\/\(auth\)\/login'\);/,
    );
  });
});
