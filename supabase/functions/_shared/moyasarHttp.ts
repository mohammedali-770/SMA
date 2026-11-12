/**
 * moyasarHttp — the one way this codebase sends a request to Moyasar.
 *
 * WHY IT EXISTS
 * Every Moyasar call the server makes carries the SECRET key, and Moyasar LIVE
 * refuses a secret-key call from any address that is not on the account's
 * Allowed IPs list: "You must list at least one address. Requests from any
 * address that is not on the list are refused", with 401 "This IP Address is
 * not whitelisted to do this operation"
 * (https://docs.moyasar.com/guides/dashboard/setting-up-your-ip-whitelist).
 * Supabase says "Supabase Edge Functions do not originate from a single static
 * IP address", and recommends routing outbound requests through a proxy that
 * has one
 * (https://supabase.com/kb/troubleshooting/why-supabase-edge-functions-cannot-provide-static-egress-ips-for-whitelisting-3d78b0).
 * The owner chose a static-IP proxy service (2026-11-11). When the Supabase
 * secret MOYASAR_PROXY_URL is set, every request goes through it; unset, every
 * request is a plain fetch, which is how TEST mode works, because the test key
 * is not IP-restricted unless the merchant restricts it.
 *
 * HOW, AND WHY NOT HTTPS_PROXY
 * The proxy is used through `Deno.createHttpClient({ proxy })`. Supabase's
 * documentation says nothing about that API on hosted Edge Functions, so this
 * rests on the runtime's source, supabase/edge-runtime at f6b79fb (2026-11-06):
 *   - PR #515 (merged 2025-03-18, released in 1.68.0) exposed
 *     Deno.createHttpClient to user workers, "since it's stable on Deno 2.x",
 *     closing issue #208, which had reported it undefined once deployed;
 *   - the vendored deno_fetch takes `proxy: { url, basicAuth }`
 *     (vendor/deno_fetch/lib.rs, CreateHttpClientArgs) and tunnels an https
 *     target with CONNECT (vendor/deno_fetch/proxy.rs), so the proxy relays TLS
 *     it cannot read and never sees the secret key;
 *   - the HTTPS_PROXY / HTTP_PROXY variables deno_fetch also honours are read
 *     from the PROCESS environment (proxy.rs, from_env), while a function's
 *     secrets reach it through a per-worker map behind Deno.env (ext/env).
 *     Setting HTTPS_PROXY as a function secret would route nothing.
 * Because that support is read from source rather than documented, a proxy
 * that is set but cannot be honoured FAILS CLOSED: the request is not sent,
 * rather than leaving from an address Moyasar will refuse. The admin Test
 * connection proves the route before live is switched on.
 *
 * The proxy URL carries the proxy's credentials. It is never logged, never put
 * in an error message and never returned; the credentials go to the runtime as
 * `basicAuth`, kept out of `url`.
 */
import { isMoyasarIpNotAllowed, MOYASAR_IP_NOT_ALLOWED, MOYASAR_IP_NOT_ALLOWED_REMEDY } from './moyasar.ts';

/** The Supabase Edge Function secret that holds the proxy URL. */
export const MOYASAR_PROXY_ENV = 'MOYASAR_PROXY_URL';

export type MoyasarProxySetting =
  | { kind: 'direct' }
  | { kind: 'proxy'; url: string; username: string; password: string }
  | { kind: 'invalid' };

/**
 * Read a MOYASAR_PROXY_URL value. Blank means no proxy. Anything else must be
 * an http: or https: URL with a host, or the setting is invalid and every
 * Moyasar request is refused until it is fixed. Credentials are split out of
 * the URL and percent-decoded, so a password holding `@` or `:` survives.
 */
export function parseMoyasarProxyUrl(raw: unknown): MoyasarProxySetting {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) return { kind: 'direct' };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { kind: 'invalid' };
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) return { kind: 'invalid' };
  try {
    return {
      kind: 'proxy',
      url: `${url.protocol}//${url.host}`,
      username: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
    };
  } catch {
    return { kind: 'invalid' };
  }
}

/** Which route Moyasar requests take right now. Never the URL itself. */
export function moyasarProxyMode(): MoyasarProxySetting['kind'] {
  return parseMoyasarProxyUrl(Deno.env.get(MOYASAR_PROXY_ENV)).kind;
}

/** Thrown, with nothing sent, when MOYASAR_PROXY_URL is set but cannot be used. */
export class MoyasarProxyError extends Error {
  readonly reason: 'moyasar_proxy_invalid' | 'moyasar_proxy_unsupported';

  constructor(reason: MoyasarProxyError['reason'], message: string) {
    super(message);
    this.name = 'MoyasarProxyError';
    this.reason = reason;
  }
}

function refuse(reason: MoyasarProxyError['reason'], message: string): MoyasarProxyError {
  console.error(JSON.stringify({ event: 'moyasar_request_refused', reason }));
  return new MoyasarProxyError(reason, message);
}

/** The /v1/<resource> a request is for, which is all a log line needs. */
function endpointOf(input: string | URL): string {
  try {
    const parts = new URL(String(input)).pathname.split('/').filter(Boolean);
    return parts[parts.indexOf('v1') + 1] ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Keyed by the raw secret, so a changed value builds a new client. */
let proxyClient: { raw: string; client: Deno.HttpClient } | null = null;

function clientFor(
  raw: string,
  setting: { url: string; username: string; password: string },
): Deno.HttpClient {
  if (proxyClient?.raw === raw) return proxyClient.client;
  if (typeof Deno.createHttpClient !== 'function') {
    throw refuse(
      'moyasar_proxy_unsupported',
      'MOYASAR_PROXY_URL is set, but this runtime cannot route a request through a proxy, so nothing was sent to Moyasar.',
    );
  }
  const basicAuth =
    setting.username || setting.password
      ? { username: setting.username, password: setting.password }
      : undefined;
  let client: Deno.HttpClient;
  try {
    client = Deno.createHttpClient({ proxy: { url: setting.url, ...(basicAuth ? { basicAuth } : {}) } });
  } catch {
    // Whatever the runtime said may quote the URL, so it is not passed on.
    throw refuse(
      'moyasar_proxy_invalid',
      'MOYASAR_PROXY_URL could not be used as a proxy, so nothing was sent to Moyasar.',
    );
  }
  proxyClient = { raw, client };
  return client;
}

/** An error from the proxied request, with every form of the credentials removed. */
function redacted(error: unknown, raw: string, setting: { username: string; password: string }): Error {
  const original = error instanceof Error ? error : new Error(String(error));
  const secrets = [raw, setting.password, setting.username].flatMap((s) => [s, encodeURIComponent(s)]);
  let message = original.message;
  for (const secret of secrets) if (secret) message = message.split(secret).join('[redacted]');
  const out = new Error(message);
  out.name = original.name;
  return out;
}

/**
 * fetch(), for Moyasar. Through the MOYASAR_PROXY_URL proxy when it is set,
 * with one client created on first use; a plain fetch when it is not.
 *
 * It throws where fetch throws, plus a MoyasarProxyError, before anything is
 * sent, when the proxy is set but unusable. A 401 that Moyasar explains as the
 * Allowed IPs list is logged here as `moyasar_ip_not_allowed`, for every
 * caller; the response is handed back unread.
 */
export async function moyasarFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  const raw = Deno.env.get(MOYASAR_PROXY_ENV) ?? '';
  const setting = parseMoyasarProxyUrl(raw);
  let res: Response;
  if (setting.kind === 'direct') {
    res = await fetch(input, init);
  } else if (setting.kind === 'invalid') {
    throw refuse(
      'moyasar_proxy_invalid',
      'MOYASAR_PROXY_URL is set but is not an http:// or https:// URL, so nothing was sent to Moyasar.',
    );
  } else {
    const client = clientFor(raw, setting);
    try {
      res = await fetch(input, { ...init, client });
    } catch (e) {
      throw redacted(e, raw, setting);
    }
  }
  if (res.status === 401) {
    const body = await res
      .clone()
      .json()
      .catch(() => null);
    if (isMoyasarIpNotAllowed(res.status, body)) {
      console.error(
        JSON.stringify({
          event: 'moyasar_request_refused',
          reason: MOYASAR_IP_NOT_ALLOWED,
          via_proxy: setting.kind === 'proxy',
          endpoint: endpointOf(input),
          remedy: MOYASAR_IP_NOT_ALLOWED_REMEDY,
        }),
      );
    }
  }
  return res;
}
