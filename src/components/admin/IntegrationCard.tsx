import React, { useState } from 'react';
import { AlertCircle, KeyRound, ShieldCheck } from 'lucide-react';

import { Button } from '../../design-system/ui/Button';
import { Card } from '../../design-system/ui/Card';
import { Field } from '../../design-system/ui/Field';
import { StatusPill } from '../../design-system/ui/StatusPill';
import { Text } from '../../design-system/ui/Text';
import { useDsFontClass } from '../../design-system/ui/useDsLang';
import { DbIntegrationSetting, UpsertIntegrationInput } from '../../lib/api';
import { initialProviderName } from '../../lib/integrationProvider';

const SELECT = [
  'ds-motion min-h-11 w-full rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface px-3',
  'text-[15px] text-con-text transition-colors duration-150',
  'focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50',
].join(' ');

const LABEL = 'text-start text-[13px] font-semibold text-con-text-2';

type FieldType = 'text' | 'bool';
interface PublicField { key: string; label: string; type: FieldType; placeholder?: string; }
interface SecretField { key: string; label: string; }
export interface ProviderSpec {
  title: string;
  subtitle: string;
  providerOptions?: string[];
  publicFields: PublicField[];
  secretFields: SecretField[];
}

/**
 * Field layout per integration slot. `publicFields` are safe to show/persist in
 * public_config; `secretFields` are write-only and go into the server-only
 * secret_config (never read back). No real provider API is called — this is
 * secure configuration storage only.
 */
export const PROVIDER_SPECS: Record<DbIntegrationSetting['provider_type'], ProviderSpec> = {
  payment: {
    title: 'Payment Gateway (Tap)',
    subtitle: 'Tap Hosted Checkout (Mada/Visa/…). Secrets server-side only. Set TEST mode first — switching to LIVE asks for confirmation.',
    providerOptions: ['tap'],
    publicFields: [
      { key: 'merchant_id', label: 'Merchant ID', type: 'text', placeholder: 'Tap merchant id' },
      { key: 'mode', label: 'Mode (test / live)', type: 'text', placeholder: 'test' },
      { key: 'currency', label: 'Currency', type: 'text', placeholder: 'SAR' },
      { key: 'source_id', label: 'Source ID', type: 'text', placeholder: 'src_all' },
      { key: 'transaction_expiry_minutes', label: 'Charge expiry (minutes, 5–60)', type: 'text', placeholder: '30' },
      { key: 'statement_descriptor', label: 'Statement descriptor (optional)', type: 'text', placeholder: 'Spicy Meal' },
    ],
    secretFields: [
      { key: 'test_secret_key', label: 'Test Secret Key (sk_test_…)' },
      { key: 'live_secret_key', label: 'Live Secret Key (sk_live_…)' },
    ],
  },
  sms: {
    title: 'SMS / OTP Gateway',
    subtitle: 'Transactional SMS provider — stored only, not activated yet',
    providerOptions: ['unifonic', 'mobily', 'twilio', 'sandbox'],
    publicFields: [{ key: 'sender_id', label: 'Approved Sender ID', type: 'text', placeholder: 'SPICYMEAL' }],
    secretFields: [{ key: 'api_key', label: 'API Key' }],
  },
  push: {
    title: 'Push Notifications',
    subtitle: 'Expo Push sender (push-dispatch). EAS credentials are configured (iOS APNs + Android FCM V1). Enabling this starts real delivery to opted-in devices on a build that ships the notifications plugin — see docs/OWNER_ACTIONS.md §10',
    // Expo is the implemented sender; other options removed until a sender
    // for them exists (a stale 'sandbox' row is normalized to expo by the
    // 20260714090000 migration).
    providerOptions: ['expo'],
    publicFields: [],
    secretFields: [],
  },
  lazywait: {
    title: 'Lazywait POS',
    subtitle: 'POS order sync — server-side only. Secrets never leave the server.',
    providerOptions: ['lazywait'],
    publicFields: [
      { key: 'base_url', label: 'API Base URL', type: 'text', placeholder: 'https://apiv2.lazywait.com/v1' },
      { key: 'client_id', label: 'Client ID', type: 'text', placeholder: 'vAK1AmUr…' },
    ],
    secretFields: [
      { key: 'api_token', label: 'API Token (lw_live_…)' },
      { key: 'webhook_secret', label: 'Webhook Secret' },
    ],
  },
  email: {
    title: 'Email Server (SMTP)',
    subtitle: 'Transactional email (receipts / notifications) — server-side only. Password never leaves the server.',
    providerOptions: ['smtp'],
    publicFields: [
      { key: 'host', label: 'SMTP Host', type: 'text', placeholder: 'smtp.example.com' },
      { key: 'port', label: 'SMTP Port', type: 'text', placeholder: '587' },
      { key: 'secure', label: 'Use TLS/SSL', type: 'bool' },
      { key: 'username', label: 'SMTP Username', type: 'text', placeholder: 'apikey / user@example.com' },
      { key: 'from_email', label: 'From Email', type: 'text', placeholder: 'orders@example.com' },
      { key: 'from_name', label: 'From Name', type: 'text', placeholder: 'Spicy Meal' },
      { key: 'reply_to', label: 'Reply-To Email (optional)', type: 'text', placeholder: 'support@example.com' },
    ],
    secretFields: [
      { key: 'password', label: 'SMTP Password' },
    ],
  },
  whatsapp: {
    title: 'WhatsApp OTP (Meta Cloud API)',
    subtitle: 'Customer login + phone verification via WhatsApp — server-side only. Tokens never leave the server.',
    providerOptions: ['meta_cloud'],
    publicFields: [
      { key: 'graph_api_version', label: 'Graph API Version', type: 'text', placeholder: 'v21.0' },
      { key: 'phone_number_id', label: 'Phone Number ID', type: 'text', placeholder: '1234567890' },
      { key: 'business_account_id', label: 'Business Account ID (optional)', type: 'text', placeholder: 'WABA id' },
      { key: 'otp_template_name_en', label: 'OTP Template Name (EN)', type: 'text', placeholder: 'otp_code_en' },
      { key: 'otp_template_language_en', label: 'OTP Template Language (EN)', type: 'text', placeholder: 'en_US' },
      { key: 'otp_template_name_ar', label: 'OTP Template Name (AR)', type: 'text', placeholder: 'otp_code_ar' },
      { key: 'otp_template_language_ar', label: 'OTP Template Language (AR)', type: 'text', placeholder: 'ar' },
      { key: 'otp_template_has_copy_button', label: 'Template has copy-code button', type: 'bool' },
      { key: 'whatsapp_login_enabled', label: 'Enable WhatsApp customer LOGIN (Send SMS Hook)', type: 'bool' },
      { key: 'otp_default_language', label: 'Login OTP default language (en/ar)', type: 'text', placeholder: 'en' },
    ],
    secretFields: [
      { key: 'access_token', label: 'Access Token' },
      { key: 'app_secret', label: 'App Secret (webhook signature)' },
      { key: 'webhook_verify_token', label: 'Webhook Verify Token' },
      { key: 'send_sms_hook_secret', label: 'Send SMS Hook Secret (v1,whsec_…)' },
    ],
  },
};

interface Props {
  providerType: DbIntegrationSetting['provider_type'];
  row?: DbIntegrationSetting;
  disabled: boolean; // accountant / non-admin
  onSave: (input: UpsertIntegrationInput) => Promise<DbIntegrationSetting>;
}

export const IntegrationCard: React.FC<Props> = ({ providerType, row, disabled, onSave }) => {
  const spec = PROVIDER_SPECS[providerType];
  const [enabled, setEnabled] = useState<boolean>(row?.enabled ?? false);
  // Coerce a stale stored provider (e.g. seeded 'sandbox') to a currently-offered
  // option, so a Save persists a usable provider rather than the stale value.
  const [providerName, setProviderName] = useState<string>(() => initialProviderName(row?.provider_name, spec.providerOptions));
  const [pub, setPub] = useState<Record<string, unknown>>(() => ({ ...(row?.public_config ?? {}) }));
  const [secrets, setSecrets] = useState<Record<string, string>>({}); // write-only, cleared after save
  const [hasSecret, setHasSecret] = useState<boolean>(row?.has_secret ?? false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const family = useDsFontClass();

  const handleSave = async () => {
    // Explicit confirmation before switching Tap to LIVE (real payments).
    if (providerType === 'payment') {
      const newMode = String((pub.mode as string) ?? '').toLowerCase();
      const oldMode = String(((row?.public_config as Record<string, unknown>)?.mode as string) ?? 'test').toLowerCase();
      if (newMode === 'live' && oldMode !== 'live') {
        const okLive = window.confirm(
          'Switch Tap to LIVE mode? Real customer payments will be processed. Make sure the LIVE secret key is configured.',
        );
        if (!okLive) return;
      }
    }
    setSaving(true);
    setMsg(null);
    try {
      // Only send secrets the admin actually typed; empty => keep the stored one.
      const typed: Record<string, string> = {};
      for (const [k, v] of Object.entries(secrets) as [string, string][]) {
        if (v.trim() !== '') typed[k] = v;
      }
      const secretConfig = Object.keys(typed).length ? typed : null;
      const saved = await onSave({ providerType, providerName, enabled, publicConfig: pub, secretConfig });
      setHasSecret(saved.has_secret);
      setSecrets({}); // clear inputs so secrets stay masked
      setMsg({ ok: true, text: 'Saved securely' });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Save failed' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="space-y-4">
      <div className="flex items-start justify-between gap-3 border-b border-con-line pb-3">
        <div className="min-w-0">
          <Text variant="heading" as="h4">{spec.title}</Text>
          <Text variant="caption" tone="tertiary" as="p" className="mt-0.5">{spec.subtitle}</Text>
        </div>
        <StatusPill label={enabled ? 'ENABLED' : 'DISABLED'} tone={enabled ? 'success' : 'neutral'} />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <label className="flex flex-col gap-2">
          <span className={LABEL}>Provider</span>
          <select
            value={providerName}
            disabled={disabled}
            aria-label={`${spec.title} provider`}
            onChange={(e) => setProviderName(e.target.value)}
            className={`${SELECT} ${family}`}
          >
            {(spec.providerOptions ?? [providerName]).map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>

        {spec.publicFields.map(f => (
          f.type === 'bool' ? (
            <label key={f.key} className="flex flex-col gap-2">
              <span className={LABEL}>{f.label}</span>
              <select
                value={pub[f.key] ? 'true' : 'false'}
                disabled={disabled}
                aria-label={f.label}
                onChange={(e) => setPub(p => ({ ...p, [f.key]: e.target.value === 'true' }))}
                className={`${SELECT} ${family}`}
              >
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            </label>
          ) : (
            // Mono: every one of these is an identifier, a host, a port or a
            // template name — values an admin copies from a provider console
            // and compares character by character.
            <Field
              key={f.key}
              label={f.label}
              numeric
              value={(pub[f.key] as string) ?? ''}
              placeholder={f.placeholder}
              disabled={disabled}
              onValueChange={(v) => setPub(p => ({ ...p, [f.key]: v }))}
            />
          )
        ))}
      </div>

      {/* Write-only secrets. These are never read back from the server, so the
          placeholder is the only signal of whether one is already stored. */}
      <div className="grid grid-cols-1 gap-3 rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface-2 p-3 md:grid-cols-2">
        {spec.secretFields.map(f => (
          <div key={f.key} className="space-y-2">
            <span className="flex items-center gap-1">
              <KeyRound className="size-3 shrink-0 text-con-text-2" aria-hidden="true" />
              <Text variant="label" tone="secondary" as="span">{f.label}</Text>
              {hasSecret && (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-mint-tint px-1.5 py-0.5">
                  <ShieldCheck className="size-2.5 text-mint" aria-hidden="true" />
                  <Text variant="caption" tone="success" as="span">configured</Text>
                </span>
              )}
            </span>
            <input
              type="password"
              autoComplete="new-password"
              value={secrets[f.key] ?? ''}
              disabled={disabled}
              aria-label={f.label}
              placeholder={hasSecret ? '•••••••• (leave blank to keep)' : 'not set — enter to configure'}
              onChange={(e) => setSecrets(s => ({ ...s, [f.key]: e.target.value }))}
              className="ds-motion min-h-11 w-full rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface px-3 font-ds-num text-[15px] text-con-text transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
            />
          </div>
        ))}
        <div className="flex items-start gap-1 md:col-span-2">
          <AlertCircle className="mt-0.5 size-3 shrink-0 text-con-text-3" aria-hidden="true" />
          <Text variant="caption" tone="tertiary" as="p">
            Secrets are stored server-side and never returned to the browser. Leave blank to keep the saved value.
          </Text>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={enabled}
            disabled={disabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="size-4 cursor-pointer accent-ember disabled:opacity-50"
          />
          <Text variant="label" as="span">Enable this integration</Text>
        </label>
        <div className="flex items-center gap-2">
          {msg && (
            <Text variant="label" tone={msg.ok ? 'success' : 'danger'} as="span">{msg.text}</Text>
          )}
          <Button
            label="Save"
            onClick={() => { void handleSave(); }}
            disabled={disabled || saving}
            loading={saving}
          />
        </div>
      </div>
    </Card>
  );
};
