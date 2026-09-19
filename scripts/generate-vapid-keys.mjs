#!/usr/bin/env node
/**
 * Generate the VAPID key pair for admin web push (docs/ADMIN_PUSH_NOTIFICATIONS.md).
 *
 * Run it, then put the three values where the file it prints says. NOTHING here
 * writes to the repository, the database or Supabase: the private key must
 * reach exactly one place, the Edge Function secret store, and it must never be
 * committed, pasted into a pull request, or stored in `app_settings`
 * (CLAUDE.md §9).
 *
 *   node scripts/generate-vapid-keys.mjs
 *
 * The format is the ordinary web-push one — base64url, uncompressed P-256
 * point for the public half and the raw scalar for the private half — so a pair
 * from any other generator works too.
 *
 * This duplicates a few lines of `supabase/functions/_shared/webPush.ts`
 * because that module is TypeScript and this has to run with plain `node`. The
 * duplication is not trusted: `adminPushWiring.test.ts` executes this script
 * and feeds its output to the real `assertVapidKeyPair`, so a drift in the
 * encoding fails CI rather than producing keys that silently do not work.
 */

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
  'sign',
  'verify',
]);
const publicKey = bytesToBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
const { d: privateKey } = await crypto.subtle.exportKey('jwk', pair.privateKey);

process.stdout.write(
  [
    `ADMIN_PUSH_VAPID_PUBLIC_KEY=${publicKey}`,
    `ADMIN_PUSH_VAPID_PRIVATE_KEY=${privateKey}`,
    '',
    '# Both lines above go in the Edge Function secrets.',
    '# The PUBLIC key also goes in the database, so the console can subscribe:',
    `#   update public.app_settings set admin_push_vapid_public_key = '${publicKey}' where id is true;`,
    '',
    '# The PRIVATE key goes nowhere else. Not the repository, not app_settings,',
    '# not a pull request, not a chat message you would not delete.',
    '',
  ].join('\n'),
);
