-- Spicy Meal — Contact & Support settings (additive, nullable, defaults off).
--
-- Extends the app_settings SINGLETON with admin-configured support contact
-- channels. Channels are OFF by default and every value is nullable, so a
-- pre-migration client keeps working and nothing customer-visible appears
-- until an admin explicitly configures AND enables a channel.
--
-- RLS: intentionally none added here — app_settings already enforces exactly
-- the required model (public/anon SELECT of the singleton; admin-only UPDATE),
-- so customers can read but never write these values.

alter table public.app_settings
  add column if not exists support_phone            text,
  add column if not exists support_whatsapp         text,
  add column if not exists support_email            text,
  add column if not exists support_hours_en         text,
  add column if not exists support_hours_ar         text,
  add column if not exists support_desc_en          text,
  add column if not exists support_desc_ar          text,
  add column if not exists support_phone_enabled    boolean not null default false,
  add column if not exists support_whatsapp_enabled boolean not null default false,
  add column if not exists support_email_enabled    boolean not null default false;

comment on column public.app_settings.support_phone is
  'Support phone in international format (e.g. +9665XXXXXXXX). Rendered as a tel: link only after client-side sanitization.';
comment on column public.app_settings.support_whatsapp is
  'Support WhatsApp number. Rendered ONLY as a constructed https://wa.me/<digits> link — arbitrary URLs are never stored or rendered.';
comment on column public.app_settings.support_email is
  'Support email. Rendered as a mailto: link only after validation.';
