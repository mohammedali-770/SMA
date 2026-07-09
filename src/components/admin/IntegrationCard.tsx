import React, { useState } from 'react';
import { Check, Loader2, KeyRound, ShieldCheck, AlertCircle } from 'lucide-react';
import { DbIntegrationSetting, UpsertIntegrationInput } from '../../lib/api';

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
    title: 'Payment Gateway',
    subtitle: 'Mada / Visa / Apple Pay provider — stored only, not activated yet',
    providerOptions: ['moyasar', 'paytabs', 'hyperpay', 'sandbox'],
    publicFields: [
      { key: 'publishable_key', label: 'Publishable Key', type: 'text', placeholder: 'pk_test_…' },
      { key: 'live_mode', label: 'Live / Production Mode', type: 'bool' },
    ],
    secretFields: [{ key: 'secret_key', label: 'Secret Key' }],
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
    subtitle: 'Mobile push provider — stored only, not activated yet',
    providerOptions: ['onesignal', 'expo', 'sandbox'],
    publicFields: [{ key: 'app_id', label: 'App ID', type: 'text', placeholder: 'app-id…' }],
    secretFields: [{ key: 'api_key', label: 'API Key' }],
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
  const [providerName, setProviderName] = useState<string>(row?.provider_name ?? spec.providerOptions?.[0] ?? '');
  const [pub, setPub] = useState<Record<string, unknown>>(() => ({ ...(row?.public_config ?? {}) }));
  const [secrets, setSecrets] = useState<Record<string, string>>({}); // write-only, cleared after save
  const [hasSecret, setHasSecret] = useState<boolean>(row?.has_secret ?? false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const handleSave = async () => {
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
    <div className="glass-card p-4 rounded-2xl bg-white/40 space-y-3.5">
      <div className="flex justify-between items-start border-b border-slate-100 pb-2.5">
        <div>
          <h4 className="text-xs font-black text-slate-800 uppercase">{spec.title}</h4>
          <p className="text-[9.5px] text-slate-400 font-bold mt-0.5">{spec.subtitle}</p>
        </div>
        <span className={`text-[8px] font-black px-2 py-0.5 rounded-full ${enabled ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
          {enabled ? 'ENABLED' : 'DISABLED'}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Provider select */}
        <div>
          <label className="block text-[9px] font-black text-slate-400 uppercase mb-1">Provider</label>
          <select
            value={providerName}
            disabled={disabled}
            aria-label={`${spec.title} provider`}
            onChange={(e) => setProviderName(e.target.value)}
            className="glass-input w-full p-2 font-bold text-slate-800 text-xs disabled:opacity-50"
          >
            {(spec.providerOptions ?? [providerName]).map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>

        {/* Public (non-secret) fields */}
        {spec.publicFields.map(f => (
          <div key={f.key}>
            <label className="block text-[9px] font-black text-slate-400 uppercase mb-1">{f.label}</label>
            {f.type === 'bool' ? (
              <select
                value={pub[f.key] ? 'true' : 'false'}
                disabled={disabled}
                aria-label={f.label}
                onChange={(e) => setPub(p => ({ ...p, [f.key]: e.target.value === 'true' }))}
                className="glass-input w-full p-2 font-bold text-slate-800 text-xs disabled:opacity-50"
              >
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            ) : (
              <input
                type="text"
                value={(pub[f.key] as string) ?? ''}
                placeholder={f.placeholder}
                disabled={disabled}
                aria-label={f.label}
                onChange={(e) => setPub(p => ({ ...p, [f.key]: e.target.value }))}
                className="glass-input w-full p-2 font-mono text-slate-800 text-xs disabled:opacity-50"
              />
            )}
          </div>
        ))}
      </div>

      {/* Secret (write-only) fields */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3 bg-slate-50/60 rounded-xl border border-slate-100">
        {spec.secretFields.map(f => (
          <div key={f.key}>
            <label className="text-[9px] font-black text-slate-400 uppercase mb-1 flex items-center gap-1">
              <KeyRound className="w-3 h-3 text-secondary" /> {f.label}
              {hasSecret && (
                <span className="ml-1 text-[8px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full inline-flex items-center gap-0.5">
                  <ShieldCheck className="w-2.5 h-2.5" /> configured
                </span>
              )}
            </label>
            <input
              type="password"
              autoComplete="new-password"
              value={secrets[f.key] ?? ''}
              disabled={disabled}
              aria-label={f.label}
              placeholder={hasSecret ? '•••••••• (leave blank to keep)' : 'not set — enter to configure'}
              onChange={(e) => setSecrets(s => ({ ...s, [f.key]: e.target.value }))}
              className="glass-input w-full p-2 font-mono text-xs disabled:opacity-50"
            />
          </div>
        ))}
        <p className="md:col-span-2 text-[8.5px] text-slate-400 font-bold flex items-start gap-1 leading-snug">
          <AlertCircle className="w-3 h-3 text-slate-400 flex-shrink-0 mt-0.5" />
          Secrets are stored server-side and never returned to the browser. Leave blank to keep the saved value.
        </p>
      </div>

      {/* Enable + save */}
      <div className="flex items-center justify-between gap-3 pt-1">
        <label className="flex items-center gap-2 text-[10px] font-extrabold text-slate-700">
          <input
            type="checkbox"
            checked={enabled}
            disabled={disabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="w-4 h-4 cursor-pointer accent-primary disabled:opacity-50"
          />
          Enable this integration
        </label>
        <div className="flex items-center gap-2">
          {msg && (
            <span className={`text-[10px] font-bold flex items-center gap-1 ${msg.ok ? 'text-green-600' : 'text-red-600'}`}>
              {msg.ok && <Check className="w-3.5 h-3.5" />}{msg.text}
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={disabled || saving}
            className="glass-btn-primary text-[10px] py-1.5 px-4 flex items-center gap-1.5 font-black text-white disabled:opacity-50"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
};
