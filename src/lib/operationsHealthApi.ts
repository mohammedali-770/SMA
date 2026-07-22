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

export interface OperationsHealthSystem {
  id:
    | 'lazywait'
    | 'order_integrity'
    | 'account_deletion'
    | 'payment'
    | 'push'
    | 'email'
    | 'otp'
    | 'database_jobs';
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

function unwrap<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data as T;
}

export const operationsHealth = {
  async probeAvailability(): Promise<OperationsHealthCapability> {
    const { error } = await supabase.rpc('operations_health_summary');
    return classifyOperationsHealthProbe(error);
  },

  async summary(): Promise<OperationsHealthSummary> {
    return unwrap<OperationsHealthSummary>(await supabase.rpc('operations_health_summary'));
  },
};
