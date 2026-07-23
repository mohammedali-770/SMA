import { supabase } from './supabase';
import {
  classifyOperationsHealthProbe,
  OperationsHealthCapability,
} from './operationsHealthCapability';

export type OperationsHealthState =
  | 'healthy'
  | 'idle'
  | 'degraded'
  | 'failing'
  | 'configuration_error'
  | 'disabled'
  | 'not_configured'
  | 'not_monitored'
  | 'unavailable';

export type OperationsHealthSystemId =
  | 'lazywait'
  | 'order_integrity'
  | 'account_deletion'
  | 'payment'
  | 'push'
  | 'email'
  | 'otp'
  | 'database_jobs';

export interface OperationsHealthSystem {
  id: OperationsHealthSystemId;
  critical: boolean;
  state: OperationsHealthState;
  source: string;
  details: Record<string, unknown>;
}

export interface OperationsHealthJob {
  job_name: string;
  subsystem: string;
  critical: boolean;
  job_id: number | null;
  schedule: string | null;
  expected_schedule: string;
  active: boolean;
  state: 'healthy' | 'degraded' | 'failing' | 'unavailable';
  latest_status: string | null;
  latest_run_at: string | null;
  latest_completed_at: string | null;
  latest_success_at: string | null;
  latest_success_age_seconds: number | null;
}

export interface OperationsHealthAttention {
  code: string;
  subsystem: string;
  severity: 'warning' | 'critical';
  count: number;
  oldest_at?: string | null;
}

export interface OperationsHealthSummary {
  generated_at: string;
  overall_state: 'healthy' | 'degraded' | 'failing' | 'configuration_error';
  critical_attention_count: number;
  warning_attention_count: number;
  systems_unavailable_count: number;
  systems_disabled_count: number;
  systems_not_configured_count: number;
  systems_not_monitored_count: number;
  critical_systems: string[];
  systems: OperationsHealthSystem[];
  jobs: OperationsHealthJob[];
  attention: OperationsHealthAttention[];
}

/**
 * Safe optional shape of the push card's `details`. All fields are optional so
 * an older backend response (which only carried `failed_sends_24h`) still reads
 * without error. The wire type stays `Record<string, unknown>`; this documents
 * the fields the panel consumes.
 */
export interface OperationsHealthPushDetails {
  /** Actual failed device deliveries in the last 24h (sum of the `failed` counter). */
  failed_deliveries_24h?: number;
  /** Failed send lifecycle events in the last 24h (rows with send_status='failed'). */
  failed_send_events_24h?: number;
  /** Backward-compatible alias for actual failed deliveries. */
  failed_sends_24h?: number;
}

/** A finite, non-negative integer read from an untyped details bag, else 0. */
function safeCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

/**
 * Normalize the two push failure metrics from a details bag. Delivery failures
 * prefer `failed_deliveries_24h` and fall back to the legacy `failed_sends_24h`
 * alias; send-event failures default to 0 when the field is absent. Negative,
 * non-finite and malformed values are clamped to 0. The backend remains the
 * authority for the card's state — this only shapes what the UI displays.
 */
export function pushFailureMetrics(
  details: Record<string, unknown> | null | undefined,
): { failedDeliveries: number; failedSendEvents: number } {
  const d = details ?? {};
  const hasDeliveries = typeof d.failed_deliveries_24h === 'number' && Number.isFinite(d.failed_deliveries_24h);
  return {
    failedDeliveries: hasDeliveries ? safeCount(d.failed_deliveries_24h) : safeCount(d.failed_sends_24h),
    failedSendEvents: safeCount(d.failed_send_events_24h),
  };
}

const SYSTEMS: Array<{ id: OperationsHealthSystemId; critical: boolean }> = [
  { id: 'lazywait', critical: true },
  { id: 'order_integrity', critical: true },
  { id: 'account_deletion', critical: true },
  { id: 'payment', critical: false },
  { id: 'push', critical: false },
  { id: 'email', critical: false },
  { id: 'otp', critical: false },
  { id: 'database_jobs', critical: true },
];

const JOBS: Array<{ job_name: string; subsystem: string; expected_schedule: string; critical: boolean }> = [
  { job_name: 'account-deletion-processor', subsystem: 'account_deletion', expected_schedule: '* * * * *', critical: true },
  { job_name: 'lazywait-sync', subsystem: 'lazywait', expected_schedule: '* * * * *', critical: true },
  { job_name: 'order-integrity-watchdog', subsystem: 'order_integrity', expected_schedule: '*/2 * * * *', critical: true },
  // Non-critical internal automation crons (Operations Alerts + Daily Digest).
  { job_name: 'operations-alerts-evaluator', subsystem: 'operations_alerts', expected_schedule: '*/5 * * * *', critical: false },
  { job_name: 'operations-digest-generator', subsystem: 'operations_digest', expected_schedule: '0 * * * *', critical: false },
];

/**
 * Safe client-side fallback for network/auth/transient RPC failures.
 * It never reports healthy and never copies the raw error into the UI.
 */
export function unavailableOperationsHealthSummary(
  generatedAt = new Date().toISOString(),
): OperationsHealthSummary {
  return {
    generated_at: generatedAt,
    overall_state: 'degraded',
    critical_attention_count: 0,
    warning_attention_count: 1,
    systems_unavailable_count: SYSTEMS.length,
    systems_disabled_count: 0,
    systems_not_configured_count: 0,
    systems_not_monitored_count: 0,
    critical_systems: ['lazywait', 'order_integrity', 'account_deletion', 'database_jobs'],
    systems: SYSTEMS.map(({ id, critical }) => ({
      id,
      critical,
      state: 'unavailable',
      source: 'operations_health_summary',
      details: { safe_error_code: 'client_fetch_failed' },
    })),
    jobs: JOBS.map(({ job_name, subsystem, expected_schedule, critical }) => ({
      job_name,
      subsystem,
      critical,
      job_id: null,
      schedule: null,
      expected_schedule,
      active: false,
      state: 'unavailable',
      latest_status: null,
      latest_run_at: null,
      latest_completed_at: null,
      latest_success_at: null,
      latest_success_age_seconds: null,
    })),
    attention: [{
      code: 'OPERATIONS_HEALTH_SOURCE_UNAVAILABLE',
      subsystem: 'operations_health',
      severity: 'warning',
      count: 1,
    }],
  };
}

export const operationsHealth = {
  async probeAvailability(): Promise<OperationsHealthCapability> {
    const { error } = await supabase.rpc('operations_health_summary');
    return classifyOperationsHealthProbe(error);
  },

  async summary(): Promise<OperationsHealthSummary> {
    const { data, error } = await supabase.rpc('operations_health_summary');
    if (error || !data) return unavailableOperationsHealthSummary();
    return data as OperationsHealthSummary;
  },
};
