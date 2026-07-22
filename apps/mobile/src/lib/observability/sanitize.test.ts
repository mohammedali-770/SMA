import { describe, expect, it } from 'vitest';
import {
  isSensitiveKey, REDACTED, sanitizeBreadcrumb, sanitizeEvent, sanitizeObject,
  sanitizeText, sanitizeUrl, shouldDropBreadcrumb,
} from './sanitize';

describe('isSensitiveKey', () => {
  it('flags every documented sensitive key family', () => {
    for (const key of [
      'authorization', 'Cookie', 'token', 'access_token', 'refresh_token', 'jwt',
      'password', 'otp', 'otp_code', 'phone', 'customer_phone', 'email',
      'delivery_address', 'street', 'latitude', 'longitude', 'lat', 'lng',
      'payment_ref', 'tap_session', 'card_number', 'customer', 'profile',
      'push_token', 'device_token', 'lazywait_token', 'secret', 'api_key',
      'apiKey', 'session', 'service_role', 'private_key', 'pin', 'pan', 'cvv',
    ]) {
      expect(isSensitiveKey(key), key).toBe(true);
    }
  });

  it('keeps safe diagnostic keys untouched', () => {
    for (const key of [
      'status_code', 'safe_error_code', 'code', 'subsystem', 'op', 'route',
      'duration_ms', 'retry_count', 'platform', 'environment', 'release',
      'provider_code', 'operation', 'order_type', 'branch_count',
    ]) {
      expect(isSensitiveKey(key), key).toBe(false);
    }
  });
});

describe('sanitizeText', () => {
  it('redacts JWT-like values', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.F4xEfsAXqvGfXvcaEqzdrb';
    expect(sanitizeText(`session ${jwt} rest`)).toBe('session [redacted-jwt] rest');
  });

  it('redacts bearer authorization values', () => {
    expect(sanitizeText('Bearer abcdef1234567890')).toContain('[redacted-auth]');
  });

  it('redacts email addresses', () => {
    expect(sanitizeText('user mohammed.ali@1sttaste.com failed')).toBe('user [redacted-email] failed');
  });

  it('redacts Saudi phone formats', () => {
    expect(sanitizeText('call +966501234567')).toBe('call [redacted-phone]');
    expect(sanitizeText('call 966501234567 now')).toBe('call [redacted-phone] now');
    expect(sanitizeText('call 0501234567 now')).toBe('call [redacted-phone] now');
  });

  it('redacts international numbers and card-like digit runs', () => {
    expect(sanitizeText('+441234567890')).toBe('[redacted-phone]');
    expect(sanitizeText('pan 4111 1111 1111 1111 used')).toContain('[redacted-number]');
  });

  it('redacts payment provider references', () => {
    expect(sanitizeText('charge chg_TS0123456789 declined')).toBe('charge [redacted-payment-ref] declined');
    expect(sanitizeText('token tok_abcdef123')).toBe('token [redacted-payment-ref]');
  });

  it('redacts high-precision coordinate pairs', () => {
    expect(sanitizeText('at 24.71355, 46.67529')).toBe('at [redacted-coords]');
  });

  it('leaves safe operational text alone', () => {
    const s = 'checkout init failed with status 500 (safe_error_code=P0001, retry 2)';
    expect(sanitizeText(s)).toBe(s);
  });
});

describe('sanitizeObject', () => {
  it('redacts sensitive keys and preserves safe diagnostics', () => {
    const out = sanitizeObject({
      status_code: 500,
      safe_error_code: 'CHECKOUT_INIT',
      otp: '123456',
      phone: '+966501234567',
      payment_reference: 'chg_x1y2z3a4b5',
      note: 'contact test@example.com',
      retry_count: 2,
    });
    expect(out.status_code).toBe(500);
    expect(out.safe_error_code).toBe('CHECKOUT_INIT');
    expect(out.retry_count).toBe(2);
    expect(out.otp).toBe(REDACTED);
    expect(out.phone).toBe(REDACTED);
    expect(out.payment_reference).toBe(REDACTED);
    expect(out.note).toBe('contact [redacted-email]');
  });

  it('redacts nested customer/order payloads wholesale by key', () => {
    const out = sanitizeObject({
      customer: { name: 'x', phone: 'y' },
      order_id_suffix: 'safe',
      nested: { address: { street: 'x' }, ok: 1 },
    }) as Record<string, unknown>;
    expect(out.customer).toBe(REDACTED);
    expect(out.order_id_suffix).toBe('safe');
    expect((out.nested as Record<string, unknown>).address).toBe(REDACTED);
    expect((out.nested as Record<string, unknown>).ok).toBe(1);
  });

  it('caps depth and key counts', () => {
    let deep: Record<string, unknown> = { v: 'end' };
    for (let i = 0; i < 10; i += 1) deep = { next: deep };
    const out = JSON.stringify(sanitizeObject(deep));
    expect(out).toContain('[truncated]');
    const wide = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`k${i}`, i]));
    expect(JSON.stringify(sanitizeObject(wide))).toContain('[truncated]');
  });
});

describe('sanitizeBreadcrumb', () => {
  it('keeps only method/status/clean-url for http crumbs (no bodies, no query)', () => {
    const out = sanitizeBreadcrumb({
      category: 'http',
      message: 'x',
      data: {
        method: 'POST',
        status_code: 401,
        url: 'https://x.supabase.co/rest/v1/rpc/place_order?apikey=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaaa.bbbb',
        request_body: { phone: '+966501234567' },
        response_body: 'big',
      },
    });
    expect(out.data).toEqual({
      method: 'POST',
      status_code: 401,
      url: 'https://x.supabase.co/rest/v1/rpc/place_order',
    });
  });

  it('sanitizes non-http crumb data and messages', () => {
    const out = sanitizeBreadcrumb({
      category: 'checkout',
      message: 'customer test@example.com retried',
      data: { otp: '1234', step: 'init' },
    });
    expect(out.message).toBe('customer [redacted-email] retried');
    expect(out.data).toEqual({ otp: REDACTED, step: 'init' });
  });
});

describe('sanitizeEvent', () => {
  it('removes cookies/bodies, redacts headers, keeps pseudonymous user id only', () => {
    const out = sanitizeEvent({
      request: {
        cookies: 'sb=secret',
        data: { phone: 'x' },
        query_string: 'apikey=x',
        url: 'https://api.example.com/orders?token=abc',
        headers: { Authorization: 'Bearer abcdef123456', 'X-Retry': '1' },
      },
      user: { id: 'uuid-1', email: 'a@b.com', ip_address: '1.2.3.4', username: 'x' },
      exception: { values: [{ value: 'failed for +966501234567' }] },
      extra: { access_token: 'x', safe: 'yes' },
      tags: { subsystem: 'checkout' },
      transaction: '/receipt/[id]',
    });
    expect(out.request?.cookies).toBeUndefined();
    expect(out.request?.data).toBeUndefined();
    expect(out.request?.query_string).toBeUndefined();
    expect(out.request?.url).toBe('https://api.example.com/orders');
    expect((out.request?.headers as Record<string, unknown>).Authorization).toBe(REDACTED);
    expect((out.request?.headers as Record<string, unknown>)['X-Retry']).toBe('1');
    expect(out.user).toEqual({ id: 'uuid-1' });
    expect(out.exception?.values?.[0].value).toBe('failed for [redacted-phone]');
    expect((out.extra as Record<string, unknown>).access_token).toBe(REDACTED);
    expect((out.extra as Record<string, unknown>).safe).toBe('yes');
    expect(out.transaction).toBe('/receipt/[id]');
  });
});

describe('shouldDropBreadcrumb', () => {
  it('drops touch crumbs in every environment (interaction breadcrumbs are off)', () => {
    for (const env of ['development', 'preview', 'production']) {
      expect(shouldDropBreadcrumb('touch', env), env).toBe(true);
    }
  });

  it('drops console crumbs outside development only', () => {
    expect(shouldDropBreadcrumb('console', 'production')).toBe(true);
    expect(shouldDropBreadcrumb('console', 'preview')).toBe(true);
    expect(shouldDropBreadcrumb('console', 'development')).toBe(false);
  });

  it('keeps operational crumbs everywhere', () => {
    for (const category of ['http', 'navigation', 'checkout', undefined]) {
      expect(shouldDropBreadcrumb(category, 'production'), String(category)).toBe(false);
    }
  });
});

describe('sanitizeUrl', () => {
  it('strips query strings entirely', () => {
    expect(sanitizeUrl('https://a.b/c?d=e&token=x')).toBe('https://a.b/c');
  });

  it('strips fragments (OAuth/deep-link callback credentials)', () => {
    expect(sanitizeUrl('spicymeal://auth#access_token=opaque123&refresh_token=r456'))
      .toBe('spicymeal://auth');
    expect(sanitizeUrl('https://a.b/return?ok=1#token=x')).toBe('https://a.b/return');
  });
});
