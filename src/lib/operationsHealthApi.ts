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
  | 'order_flow'
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

/**
 * Keep the fallback inventory aligned with every card the backend can return.
 * `order_flow` became a production card in 20260807170000; omitting it here did
 * more than make the types stale — HealthSystemCard indexed a total Record by
 * the new runtime id and dereferenced `undefined`, which could crash the Health
 * Center while the backend itself was healthy.
 */
const SYSTEMS: Array<{ id: OperationsHealthSystemId; critical: boolean }> = [
  { id: 'lazywait', critical: true },
  { id: 'order_integrity', critical: true },
  { id: 'order_flow', critical: true },
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
    critical_systems: ['lazywait', 'order_integrity', 'order_flow', 'account_deletion', 'database_jobs'],
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

/**
 * What a capability probe learned. The probe has always fetched a full summary
 * and then thrown the payload away, keeping only the error — so the dashboard
 * paid for the round trip and got a boolean.
 *
 * It now returns the summary too. `summary` is null when the probe failed (the
 * tab is hidden or the RPC errored), so a caller must handle absence; it is
 * never a partially-populated object.
 */
export interface OperationsHealthProbe {
  capability: OperationsHealthCapability;
  summary: OperationsHealthSummary | null;
}

export const operationsHealth = {
  /**
   * Probe the RPC AND keep what it returned.
   *
   * The extra value is free: this is the same request, the same row, the same
   * latency. Discarding it meant the only way to know whether operations were
   * healthy was to open the Operations Health tab — so nothing could warn an
   * operator who was looking at a different tab, which is most of the time.
   */
  async probeAvailability(): Promise<OperationsHealthProbe> {
    const { data, error } = await supabase.rpc('operations_health_summary');
    const capability = classifyOperationsHealthProbe(error);
    return {
      capability,
      summary: !error && data ? (data as OperationsHealthSummary) : null,
    };
  },

  async summary(): Promise<OperationsHealthSummary> {
    const { data, error } = await supabase.rpc('operations_health_summary');
    if (error || !data) return unavailableOperationsHealthSummary();
    return data as OperationsHealthSummary;
  },
};
