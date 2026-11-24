/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrandSettings, LoyaltySettings } from '../types';

// (Removed INITIAL_BRANCHES, INITIAL_CATEGORIES, INITIAL_MODIFIER_GROUPS,
//  INITIAL_PRODUCTS, INITIAL_BANNERS, INITIAL_PROFILES, INITIAL_ADDRESSES and
//  INITIAL_ORDERS on 2026-09-02 — 451 lines of pre-Supabase seed data for the
//  prototype. Every one of them occurred exactly once in the repository, at its
//  own definition: the catalog, profiles, addresses and orders have come from
//  Supabase since the emulator was retired. Same reasoning as the provider-
//  settings removal recorded below.)

export const INITIAL_BRAND_SETTINGS: BrandSettings = {
  primaryColor: '#422e87',
  secondaryColor: '#e02d3d',
  vatPercentage: 15,
  instagram: 'spicymeal_sa',
  twitter: 'spicymeal_sa',
};

// (Removed INITIAL_LAZYWAIT_SETTINGS, INITIAL_PAYMENT_SETTINGS, INITIAL_SMS_SETTINGS
//  and INITIAL_NOTIFICATION_SETTINGS — they shipped fake/placeholder provider
//  secret-shaped fields (secretKey / apiKey) in the client bundle and were unused
//  dead exports. All provider config now lives in integration_settings
//  (secret_config, admin-only, never returned to the browser); the admin UI reads
//  only the non-secret projection via list_integration_settings.)

export const INITIAL_LOYALTY_SETTINGS: LoyaltySettings = {
  isEnabled: true,
  pointsPerRiyal: 1,
  minPointsToRedeem: 100,
  discountPerPoint: 0.10, // 100 points = 10 SAR
  pickupOnly: true, // matches the app_settings column default
  expiryEnabled: false, // expiry is OFF until an owner turns it on
  expiryAnchorMonth: 1,
  expiryAnchorDay: 1,
  expiryPeriodMonths: 12,
  expiryNextRunOn: null
};

