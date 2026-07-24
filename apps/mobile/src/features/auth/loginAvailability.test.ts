import { describe, it, expect } from 'vitest';

import {
  classifyLoginFlag, readLoginFlag, requestLoginCode, showsLoginForm, showsUnavailableCard,
  type WhatsAppLoginAvailability,
} from './loginAvailability';

/** What the LoginScreen would render for a given availability. */
function render(a: WhatsAppLoginAvailability): 'form' | 'unavailable-card' {
  return showsUnavailableCard(a) ? 'unavailable-card' : 'form';
}

describe('confirmed flag ON', () => {
  it('classifies an explicit true as enabled', () => {
    expect(classifyLoginFlag({ data: true, error: null })).toBe('enabled');
  });
  it('reads through the invoker as enabled', async () => {
    await expect(readLoginFlag(async () => ({ data: true, error: null }))).resolves.toBe('enabled');
  });
  it('shows the login form', () => {
    expect(render('enabled')).toBe('form');
    expect(showsLoginForm('enabled')).toBe(true);
  });
});

describe('confirmed flag OFF', () => {
  it('classifies an explicit false as disabled', () => {
    expect(classifyLoginFlag({ data: false, error: null })).toBe('disabled');
  });
  it('reads through the invoker as disabled', async () => {
    await expect(readLoginFlag(async () => ({ data: false, error: null }))).resolves.toBe('disabled');
  });
  it('is the ONLY state that hides the form', () => {
    expect(render('disabled')).toBe('unavailable-card');
    expect(showsLoginForm('disabled')).toBe(false);
  });
});

// The regression this contract exists for: a failed read used to collapse into
// `false` and render the unavailable card, locking customers out of a working
// app because WhatsApp is the only way in.
describe('read failure (RPC / network / RLS)', () => {
  it('treats an RPC error as unknown, not disabled', () => {
    const rpcError = { message: 'function whatsapp_login_enabled() does not exist', code: '42883' };
    expect(classifyLoginFlag({ data: null, error: rpcError })).toBe('unknown');
  });

  it('treats an RLS denial as unknown, not disabled', () => {
    const rlsError = { message: 'permission denied for function whatsapp_login_enabled', code: '42501' };
    expect(classifyLoginFlag({ data: null, error: rlsError })).toBe('unknown');
  });

  it('treats a rejected (network-failure) invoker as unknown', async () => {
    const offline = async () => { throw new Error('Network request failed'); };
    await expect(readLoginFlag(offline)).resolves.toBe('unknown');
  });

  it('never rejects, so no caller can reintroduce a fail-closed branch', async () => {
    await expect(readLoginFlag(() => Promise.reject(new Error('boom')))).resolves.toBe('unknown');
  });

  it('treats missing / null / non-boolean payloads as unknown', () => {
    expect(classifyLoginFlag({ data: null, error: null })).toBe('unknown');
    expect(classifyLoginFlag({ data: undefined, error: null })).toBe('unknown');
    expect(classifyLoginFlag({})).toBe('unknown');
    expect(classifyLoginFlag(null)).toBe('unknown');
    expect(classifyLoginFlag(undefined)).toBe('unknown');
    // Truthy-but-not-true must not be mistaken for an enabled flag...
    expect(classifyLoginFlag({ data: 'true', error: null })).toBe('unknown');
    // ...and falsy-but-not-false must not be mistaken for a confirmed OFF.
    expect(classifyLoginFlag({ data: 0, error: null })).toBe('unknown');
    expect(classifyLoginFlag({ data: '', error: null })).toBe('unknown');
  });

  it('shows the login form on an unreadable flag (no lockout)', () => {
    expect(render('unknown')).toBe('form');
    expect(showsLoginForm('unknown')).toBe(true);
  });
});

describe('server rejection when WhatsApp login is actually disabled', () => {
  // The Send SMS hook fails closed with exactly this message (503) when
  // `whatsapp_login_enabled !== true`, so signInWithOtp rejects.
  const HOOK_DISABLED = 'WhatsApp login is temporarily unavailable';

  it('reports failed — never sent — so the UI cannot advance to the code step', async () => {
    const rejectingServer = async () => { throw new Error(HOOK_DISABLED); };
    const outcome = await requestLoginCode(rejectingServer, '+966512345678');
    expect(outcome).toEqual({ status: 'failed', message: HOOK_DISABLED });
    expect(outcome.status).not.toBe('sent');
  });

  it('still rejects when the client optimistically rendered the form on unknown', async () => {
    // Flag unreadable → form shown → server is the one that says no.
    expect(render(await readLoginFlag(async () => { throw new Error('offline'); }))).toBe('form');
    const outcome = await requestLoginCode(async () => { throw new Error(HOOK_DISABLED); }, '+966512345678');
    expect(outcome.status).toBe('failed');
  });

  it('surfaces other server rejections (e.g. rate limits) with their message', async () => {
    const limited = async () => { throw new Error('For security purposes, you can only request this after 60 seconds.'); };
    const outcome = await requestLoginCode(limited, '+966512345678');
    expect(outcome).toEqual({
      status: 'failed',
      message: 'For security purposes, you can only request this after 60 seconds.',
    });
  });

  it('falls back to null message when the rejection carries none', async () => {
    expect(await requestLoginCode(async () => { throw new Error(''); }, '+966512345678'))
      .toEqual({ status: 'failed', message: null });
    // Non-Error throws must not crash the send path.
    expect(await requestLoginCode(async () => { throw 'nope'; }, '+966512345678'))
      .toEqual({ status: 'failed', message: null });
  });

  it('reports sent only when the server accepts', async () => {
    expect(await requestLoginCode(async () => undefined, '+966512345678')).toEqual({ status: 'sent' });
  });

  it('passes the canonical phone straight through to the server', async () => {
    const seen: string[] = [];
    await requestLoginCode(async (p) => { seen.push(p); }, '+966512345678');
    expect(seen).toEqual(['+966512345678']);
  });
});
