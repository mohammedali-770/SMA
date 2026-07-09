/**
 * WhatsApp OTP send orchestration (Deno runtime — uses env + fetch + service
 * role, so it is NOT unit-tested here; the pure helpers it calls live in
 * `whatsapp.ts` and are covered by `whatsapp.test.ts`).
 *
 * Shared by `whatsapp-send-otp` (customer) and `whatsapp-test-config` (admin
 * test send). NEVER logs the OTP or the access token; only a sanitized provider
 * response is persisted.
 */
import { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { getProviderConfig } from './secrets.ts';
import {
  buildOtpTemplateMessage, generateOtp, hashOtp, randomSalt, sanitizeProviderResponse,
} from './whatsapp.ts';

const GRAPH_BASE = 'https://graph.facebook.com';

export type Language = 'ar' | 'en';
export type SendOutcome = 'disabled' | 'rate_limited' | 'sent' | 'error';

function str(v: unknown): string { return typeof v === 'string' ? v : ''; }
function num(v: unknown, d: number): number { const n = Number(v); return Number.isFinite(n) ? n : d; }
function bool(v: unknown, d: boolean): boolean { return typeof v === 'boolean' ? v : d; }

interface ResolvedConfig {
  graphVersion: string;
  phoneNumberId: string;
  accessToken: string;
  templateName: string;
  langCode: string;
  hasCopyButton: boolean;
  pepper: string;
  ttlMinutes: number;
  maxAttempts: number;
  cooldownSeconds: number;
  maxPerHour: number;
  maxPerDay: number;
}

/**
 * Resolve the OTP HMAC pepper server-side. Prefers the Deno env secret
 * (strongest — separate compromise domain), else a value already in
 * secret_config, else generates one and persists it (so it works with zero CLI).
 */
async function resolvePepper(admin: SupabaseClient, secretConfig: Record<string, unknown>): Promise<string> {
  const envPepper = Deno.env.get('WHATSAPP_OTP_HMAC_SECRET');
  if (envPepper && envPepper.length >= 16) return envPepper;
  const existing = str(secretConfig.otp_hmac_secret);
  if (existing.length >= 16) return existing;
  const generated = randomSalt(32);
  await admin.from('integration_settings')
    .update({ secret_config: { ...secretConfig, otp_hmac_secret: generated } })
    .eq('provider_type', 'whatsapp');
  return generated;
}

/** Resolve just the OTP pepper (for verification, which doesn't need send config).
 *  Returns null only when the provider row is missing entirely. */
export async function getOtpPepper(admin: SupabaseClient): Promise<string | null> {
  const cfg = await getProviderConfig(admin, 'whatsapp');
  if (!cfg) return null;
  return resolvePepper(admin, cfg.secretConfig);
}

/** Returns the resolved config, or null when the provider is disabled/unconfigured. */
export async function resolveWhatsAppConfig(
  admin: SupabaseClient, language: Language,
): Promise<ResolvedConfig | null> {
  const cfg = await getProviderConfig(admin, 'whatsapp');
  if (!cfg || !cfg.enabled) return null;
  const pub = cfg.publicConfig;
  const sec = cfg.secretConfig;
  const phoneNumberId = str(pub.phone_number_id);
  const accessToken = str(sec.access_token);
  const templateName = language === 'ar' ? str(pub.otp_template_name_ar) : str(pub.otp_template_name_en);
  const langCode = language === 'ar' ? (str(pub.otp_template_language_ar) || 'ar') : (str(pub.otp_template_language_en) || 'en_US');
  if (!phoneNumberId || !accessToken || !templateName) return null; // not fully configured
  const pepper = await resolvePepper(admin, sec);
  return {
    graphVersion: str(pub.graph_api_version) || 'v21.0',
    phoneNumberId, accessToken, templateName, langCode,
    hasCopyButton: bool(pub.otp_template_has_copy_button, true),
    pepper,
    ttlMinutes: num(pub.otp_ttl_minutes, 5),
    maxAttempts: num(pub.max_attempts, 5),
    cooldownSeconds: num(pub.resend_cooldown_seconds, 60),
    maxPerHour: 5,
    maxPerDay: 10,
  };
}

/**
 * Generate + hash + rate-limit + send one OTP. Returns an outcome; the caller
 * decides what to expose (send-otp always returns a generic message except for
 * the global `disabled` state, to prevent phone enumeration).
 */
export async function sendOtpViaWhatsApp(
  admin: SupabaseClient,
  e164: string,
  purpose: string,
  language: Language,
  meta: { ipHash?: string | null; deviceHash?: string | null } = {},
): Promise<SendOutcome> {
  const cfg = await resolveWhatsAppConfig(admin, language);
  if (!cfg) return 'disabled';

  const otp = generateOtp();
  const salt = randomSalt();
  const otpHash = await hashOtp(cfg.pepper, e164, purpose, otp, salt);
  const expiresAt = new Date(Date.now() + cfg.ttlMinutes * 60_000).toISOString();

  const { data: beginRows, error: beginErr } = await admin.rpc('otp_begin_send', {
    p_phone: e164, p_channel: 'whatsapp', p_purpose: purpose,
    p_otp_hash: otpHash, p_salt: salt, p_expires_at: expiresAt,
    p_max_attempts: cfg.maxAttempts, p_cooldown_seconds: cfg.cooldownSeconds,
    p_max_per_hour: cfg.maxPerHour, p_max_per_day: cfg.maxPerDay,
    p_ip_hash: meta.ipHash ?? null, p_device_hash: meta.deviceHash ?? null,
    p_provider_message_id: null,
  });
  if (beginErr) return 'error';
  const begin = Array.isArray(beginRows) ? beginRows[0] : beginRows;
  if (!begin?.allowed) return 'rate_limited';

  // Send the template message to Meta. The token is only ever in this request
  // header — never logged; only the sanitized response is persisted.
  const body = buildOtpTemplateMessage({
    to: e164, templateName: cfg.templateName, langCode: cfg.langCode, otp, hasCopyButton: cfg.hasCopyButton,
  });
  let sanitized;
  let providerStatus = 'failed';
  try {
    const resp = await fetch(`${GRAPH_BASE}/${cfg.graphVersion}/${cfg.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${cfg.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const parsed = await resp.json().catch(() => ({}));
    sanitized = sanitizeProviderResponse(parsed);
    providerStatus = resp.ok && sanitized.message_id ? 'sent' : 'failed';
  } catch {
    sanitized = { message_id: null, error_code: 'network_error', error_message: 'send failed' };
  }

  await admin.rpc('record_whatsapp_message', {
    p_phone: e164, p_message_type: 'otp_send', p_template_name: cfg.templateName,
    p_provider_message_id: sanitized.message_id, p_provider_status: providerStatus,
    p_error_code: sanitized.error_code, p_error_message_safe: sanitized.error_message,
    p_raw: sanitized,
  });

  return providerStatus === 'sent' ? 'sent' : 'error';
}
