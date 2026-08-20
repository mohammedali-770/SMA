/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { supabase } from './supabase';

/**
 * Admin configuration for a branch's trading hours and its advisory delivery
 * areas.
 *
 * Separate from `opsApi`, which carries the *operational* controls (pause
 * delivery, disable an area for an hour). Creating an area or setting hours is
 * configuration and stays admin-only; disabling one for the evening is an
 * operational act the call centre performs. The database enforces that split —
 * these RPCs check `is_admin()`, the ops ones check
 * `is_admin() or is_call_center()`.
 */

/** 0 = Sunday, matching `branch_working_hours.day_of_week`. */
export type WeekdayIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface WorkingHoursDay {
  dayOfWeek: WeekdayIndex;
  isClosed: boolean;
  /** 'HH:MM'. Null when the day is closed. */
  opensAt: string | null;
  closesAt: string | null;
}

export interface DeliveryArea {
  id: string;
  branchId: string;
  nameAr: string;
  nameEn: string | null;
  sortOrder: number;
  isDisabled: boolean;
  disabledUntil: string | null;
}

function fail(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

/** Postgres returns `time` as 'HH:MM:SS'; the editor wants 'HH:MM'. */
function toHm(v: unknown): string | null {
  return typeof v === 'string' && v.length >= 5 ? v.slice(0, 5) : null;
}

export const branchConfig = {
  async workingHours(branchId: string): Promise<WorkingHoursDay[]> {
    const { data, error } = await supabase
      .from('branch_working_hours')
      .select('day_of_week, is_closed, opens_at, closes_at')
      .eq('branch_id', branchId)
      .order('day_of_week');
    fail(error);
    return (data ?? []).map((r) => ({
      dayOfWeek: r.day_of_week as WeekdayIndex,
      isClosed: r.is_closed as boolean,
      opensAt: toHm(r.opens_at),
      closesAt: toHm(r.closes_at),
    }));
  },

  async saveWorkingHours(branchId: string, days: WorkingHoursDay[]): Promise<void> {
    const { error } = await supabase.rpc('admin_upsert_branch_working_hours', {
      p_branch_id: branchId,
      p_days: days.map((d) => ({
        day_of_week: d.dayOfWeek,
        is_closed: d.isClosed,
        opens_at: d.isClosed ? null : d.opensAt,
        closes_at: d.isClosed ? null : d.closesAt,
      })),
    });
    fail(error);
  },

  async areas(branchId: string): Promise<DeliveryArea[]> {
    const { data, error } = await supabase
      .from('branch_delivery_areas')
      .select('id, branch_id, name_ar, name_en, sort_order, is_disabled, disabled_until')
      .eq('branch_id', branchId)
      .order('sort_order');
    fail(error);
    return (data ?? []).map((r) => ({
      id: r.id as string,
      branchId: r.branch_id as string,
      nameAr: r.name_ar as string,
      nameEn: (r.name_en as string | null) ?? null,
      sortOrder: r.sort_order as number,
      isDisabled: r.is_disabled as boolean,
      disabledUntil: (r.disabled_until as string | null) ?? null,
    }));
  },

  async addArea(branchId: string, nameAr: string, nameEn?: string | null): Promise<void> {
    const { error } = await supabase.rpc('admin_add_delivery_area', {
      p_branch_id: branchId,
      p_name_ar: nameAr,
      p_name_en: nameEn?.trim() ? nameEn.trim() : null,
    });
    fail(error);
  },

  /** Reorder is a sort_order patch, matching how banners move (BannerRow). */
  async moveArea(areaId: string, sortOrder: number): Promise<void> {
    const { error } = await supabase.rpc('admin_update_delivery_area', {
      p_area_id: areaId,
      p_sort_order: sortOrder,
    });
    fail(error);
  },

  async deleteArea(areaId: string): Promise<void> {
    const { error } = await supabase.rpc('admin_delete_delivery_area', { p_area_id: areaId });
    fail(error);
  },
};
