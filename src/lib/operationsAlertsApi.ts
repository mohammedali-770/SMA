import { supabase } from './supabase';
import {
  classifyOperationsAlertsProbe,
  OperationsAlertsCapability,
} from './operationsAlertsCapability';

/**
 * Operations Alerts + Daily Digest client (staff-gated read RPCs + the
 * admin-only dormant-settings RPC). The backend is authoritative for every
 * severity/status decision — this module only normalizes response shapes
 * defensively so malformed or older payloads can never crash the panel.
 */

export type OperationsAlertSeverity = 'warning' | 'critical';
export type OperationsAlertStatus = 'open' | 'recovered';
export type OperationsAlertEventType =
  | 'baseline_observed'
  | 'opened'
  | 'escalated'
  | 'downgraded'
  | 'reminder'
  | 'recovered';

export interface OperationsAlert {
  id: string;
  fingerprint: string;
  subsystem: string;
  condition_code: string;
  severity: OperationsAlertSeverity;
  status: OperationsAlertStatus;
  generation: number;
  baseline: boolean;
  first_seen_at: string | null;
  last_seen_at: string | null;
  occurrence_count: number;
  last_notified_at: string | null;
  last_reminder_at: string | null;
  recovered_at: string | null;
  safe_evidence: Record<string, unknown>;
}

export interface OperationsAlertEvent {
  id: string;
  event_type: OperationsAlertEventType;
  severity: 'info' | OperationsAlertSeverity;
  notification_suppressed: boolean;
  safe_evidence: Record<string, unknown>;
  created_at: string | null;
}

export interface OperationsAlertTimeline {
  alert: OperationsAlert;
  events: OperationsAlertEvent[];
}

export interface OperationsAlertsSummary {
  generated_at: string | null;
  open_critical_count: number;
  open_warning_count: number;
  open_total: number;
  open_baseline_count: number;
  recovered_last_24h: number;
  last_evaluation: Record<string, unknown> | null;
  last_digest: Record<string, unknown> | null;
  alert_evaluation_enabled: boolean;
  digest_generation_enabled: boolean;
  external_dispatch_enabled: boolean;
}

export interface OperationsDigest {
  id?: string;
  scope: string;
  digest_date: string;
  language: 'en' | 'ar';
  timezone: string;
  period_start_utc: string | null;
  period_end_utc: string | null;
  overall_state: string;
  opened_count: number;
  recovered_count: number;
  unresolved_count: number;
  critical_open_count: number;
  warning_open_count: number;
  content: Record<string, unknown>;
  rendered_subject: string;
  rendered_body: string;
  generated_at?: string | null;
  preview?: boolean;
}

export interface OperationsAlertSettings {
  alert_evaluation_enabled: boolean;
  digest_generation_enabled: boolean;
  external_dispatch_enabled: boolean;
  timezone: string;
  digest_local_time: string;
  warning_reminder_minutes: number;
  critical_reminder_minutes: number;
  recovery_notifications_enabled: boolean;
  optional_system_alerts_enabled: boolean;
  system_rule_overrides: Record<string, unknown>;
  updated_at?: string | null;
}

export interface OperationsAlertSettingsBundle {
  settings: OperationsAlertSettings;
  last_evaluation_run: Record<string, unknown> | null;
  last_digest_run: Record<string, unknown> | null;
}

export interface OperationsAlertsFilters {
  status?: OperationsAlertStatus | 'all' | null;
  severity?: OperationsAlertSeverity | null;
  subsystem?: string | null;
  limit?: number | null;
}

/** Finite, non-negative integer; anything else becomes 0. */
export function safeAlertCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function safeString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function safeNullableString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function safeObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function safeNullableObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function normalizeAlertSeverity(value: unknown): OperationsAlertSeverity {
  return value === 'critical' ? 'critical' : 'warning';
}

export function normalizeAlertStatus(value: unknown): OperationsAlertStatus {
  return value === 'recovered' ? 'recovered' : 'open';
}

export function normalizeOperationsAlert(raw: unknown): OperationsAlert {
  const r = safeObject(raw);
  return {
    id: safeString(r.id),
    fingerprint: safeString(r.fingerprint, 'unknown'),
    subsystem: safeString(r.subsystem, 'unknown'),
    condition_code: safeString(r.condition_code, 'unknown'),
    severity: normalizeAlertSeverity(r.severity),
    status: normalizeAlertStatus(r.status),
    generation: Math.max(1, safeAlertCount(r.generation) || 1),
    baseline: r.baseline === true,
    first_seen_at: safeNullableString(r.first_seen_at),
    last_seen_at: safeNullableString(r.last_seen_at),
    occurrence_count: Math.max(1, safeAlertCount(r.occurrence_count) || 1),
    last_notified_at: safeNullableString(r.last_notified_at),
    last_reminder_at: safeNullableString(r.last_reminder_at),
    recovered_at: safeNullableString(r.recovered_at),
    safe_evidence: safeObject(r.safe_evidence),
  };
}

const EVENT_TYPES: OperationsAlertEventType[] = [
  'baseline_observed', 'opened', 'escalated', 'downgraded', 'reminder', 'recovered',
];

export function normalizeOperationsAlertEvent(raw: unknown): OperationsAlertEvent {
  const r = safeObject(raw);
  const type = EVENT_TYPES.includes(r.event_type as OperationsAlertEventType)
    ? (r.event_type as OperationsAlertEventType)
    : 'opened';
  const severity = r.severity === 'info' ? 'info' : normalizeAlertSeverity(r.severity);
  return {
    id: safeString(r.id),
    event_type: type,
    severity,
    notification_suppressed: r.notification_suppressed === true,
    safe_evidence: safeObject(r.safe_evidence),
    created_at: safeNullableString(r.created_at),
  };
}

export function normalizeOperationsAlertsSummary(raw: unknown): OperationsAlertsSummary {
  const r = safeObject(raw);
  return {
    generated_at: safeNullableString(r.generated_at),
    open_critical_count: safeAlertCount(r.open_critical_count),
    open_warning_count: safeAlertCount(r.open_warning_count),
    open_total: safeAlertCount(r.open_total),
    open_baseline_count: safeAlertCount(r.open_baseline_count),
    recovered_last_24h: safeAlertCount(r.recovered_last_24h),
    last_evaluation: safeNullableObject(r.last_evaluation),
    last_digest: safeNullableObject(r.last_digest),
    alert_evaluation_enabled: r.alert_evaluation_enabled === true,
    digest_generation_enabled: r.digest_generation_enabled === true,
    // Backend-authoritative and expected false in this version; never invented
    // client-side.
    external_dispatch_enabled: r.external_dispatch_enabled === true,
  };
}

export function normalizeOperationsDigest(raw: unknown): OperationsDigest {
  const r = safeObject(raw);
  return {
    id: safeNullableString(r.id) ?? undefined,
    scope: safeString(r.scope, 'daily'),
    digest_date: safeString(r.digest_date),
    language: r.language === 'ar' ? 'ar' : 'en',
    timezone: safeString(r.timezone, 'Asia/Riyadh'),
    period_start_utc: safeNullableString(r.period_start_utc),
    period_end_utc: safeNullableString(r.period_end_utc),
    overall_state: safeString(r.overall_state, 'unavailable'),
    opened_count: safeAlertCount(r.opened_count),
    recovered_count: safeAlertCount(r.recovered_count),
    unresolved_count: safeAlertCount(r.unresolved_count),
    critical_open_count: safeAlertCount(r.critical_open_count),
    warning_open_count: safeAlertCount(r.warning_open_count),
    content: safeObject(r.content),
    rendered_subject: safeString(r.rendered_subject),
    rendered_body: safeString(r.rendered_body),
    generated_at: safeNullableString(r.generated_at),
    preview: r.preview === true,
  };
}

export function normalizeOperationsAlertSettings(raw: unknown): OperationsAlertSettings {
  const r = safeObject(raw);
  const minutes = (v: unknown, fallback: number) => {
    const n = safeAlertCount(v);
    return n >= 5 && n <= 10080 ? n : fallback;
  };
  return {
    alert_evaluation_enabled: r.alert_evaluation_enabled === true,
    digest_generation_enabled: r.digest_generation_enabled === true,
    external_dispatch_enabled: r.external_dispatch_enabled === true,
    timezone: safeString(r.timezone, 'Asia/Riyadh'),
    digest_local_time: safeString(r.digest_local_time, '08:00'),
    warning_reminder_minutes: minutes(r.warning_reminder_minutes, 1440),
    critical_reminder_minutes: minutes(r.critical_reminder_minutes, 240),
    recovery_notifications_enabled: r.recovery_notifications_enabled === true,
    optional_system_alerts_enabled: r.optional_system_alerts_enabled === true,
    system_rule_overrides: safeObject(r.system_rule_overrides),
    updated_at: safeNullableString(r.updated_at),
  };
}

function normalizeArray<T>(raw: unknown, normalize: (item: unknown) => T): T[] {
  return Array.isArray(raw) ? raw.map(normalize) : [];
}

function ok<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

export const operationsAlerts = {
  async probeAvailability(): Promise<OperationsAlertsCapability> {
    const { error } = await supabase.rpc('operations_alerts_admin_summary');
    return classifyOperationsAlertsProbe(error);
  },

  async summary(): Promise<OperationsAlertsSummary> {
    return normalizeOperationsAlertsSummary(
      ok(await supabase.rpc('operations_alerts_admin_summary')),
    );
  },

  async list(filters: OperationsAlertsFilters = {}): Promise<OperationsAlert[]> {
    const data = ok(await supabase.rpc('operations_alerts_list', {
      p_status: filters.status ?? 'open',
      p_severity: filters.severity ?? null,
      p_subsystem: filters.subsystem ?? null,
      p_limit: filters.limit ?? 100,
    }));
    return normalizeArray(data, normalizeOperationsAlert);
  },

  async timeline(alertId: string): Promise<OperationsAlertTimeline> {
    const data = safeObject(ok(await supabase.rpc('operations_alert_timeline', {
      p_alert_id: alertId,
    })));
    return {
      alert: normalizeOperationsAlert(data.alert),
      events: normalizeArray(data.events, normalizeOperationsAlertEvent),
    };
  },

  async digestList(limit = 30): Promise<OperationsDigest[]> {
    const data = ok(await supabase.rpc('operations_digest_list', { p_limit: limit }));
    return normalizeArray(data, normalizeOperationsDigest);
  },

  async digestPreview(language: 'en' | 'ar'): Promise<OperationsDigest> {
    return normalizeOperationsDigest(
      ok(await supabase.rpc('operations_digest_preview', { p_language: language })),
    );
  },

  async settingsGet(): Promise<OperationsAlertSettingsBundle> {
    const data = safeObject(ok(await supabase.rpc('operations_alert_settings_get')));
    return {
      settings: normalizeOperationsAlertSettings(data.settings),
      last_evaluation_run: safeNullableObject(data.last_evaluation_run),
      last_digest_run: safeNullableObject(data.last_digest_run),
    };
  },

  /** Admin-only. The backend hard-rejects external_dispatch_enabled=true. */
  async settingsUpdate(patch: Record<string, unknown>): Promise<OperationsAlertSettings> {
    return normalizeOperationsAlertSettings(
      ok(await supabase.rpc('operations_alert_settings_update', { p_patch: patch })),
    );
  },
};
