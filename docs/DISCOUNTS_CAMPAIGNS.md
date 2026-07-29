# Discounts & Promotional Campaigns (#100)

Status: **repository-only, UNAPPLIED.** This is a safe, self-contained slice —
a migration file, a SQL test, and a small typed client helper. No migration has
been applied to any database, nothing is deployed, and no owner approval for a
live change is implied. Applying it to Production goes only through the
owner-approved `apply_migration` workflow in `docs/MIGRATIONS.md`.

## What this slice adds

- **`supabase/migrations/20260728120000_discounts_campaigns.sql`**
  - `public.campaigns` — bilingual name/description; `type` in
    `('percentage','fixed','free_delivery')`; `value`; optional uppercase `code`
    (unique when present); `starts_at`/`ends_at`; `min_order_amount`;
    `max_discount_amount` (percentage cap); `per_user_limit`/`global_limit`;
    optional `branch_id` scoping; `is_active`; timestamps + `updated_at` trigger.
  - `public.campaign_redemptions` — append-only ledger `(campaign_id, user_id,
    order_id, discount_amount, redeemed_at)`; the source of truth for usage
    limits; a partial unique index on `(campaign_id, order_id)` makes a retried
    checkout idempotent.
  - RLS — deny-all by default; admins manage; staff read all; anon + customers
    read only **active, in-window, codeless** campaigns; redemptions are
    read-your-own (no client write grant at all).
  - `public.compute_campaign_discount(...)` — SECURITY DEFINER, STABLE,
    `search_path=public`, revoked from public/anon, granted to authenticated.
    Validates auth/active/window/branch/min-order/per-user/global and returns a
    **server-computed, cap-clamped** discount. Mirrors the existing
    `validate_coupon` pattern.
- **`supabase/tests/discounts_campaigns_test.sql`** — object + grant/RLS
  contract, real SET ROLE RLS enforcement, discount math + cap clamping, and the
  full rejection matrix. Requires a live Postgres (not part of the Vitest suite).
- **`src/lib/campaigns.ts` + `src/lib/campaigns.test.ts`** — typed `DbCampaign`
  /`CampaignType`, a thin `campaignsApi` wrapper (validate via RPC + admin CRUD),
  and DISPLAY-ONLY pure helpers (`selectLiveCampaigns`, `formatCampaignSummary`).
  No client-side discount math. `tsc --noEmit` clean; 12 unit tests pass.

## Assumptions (please confirm)

1. **Server authority / `place_order` integration is out of scope here.** Like
   `validate_coupon`, `compute_campaign_discount` returns a discount for a
   *server-known* subtotal; a direct client call is only a PREVIEW. The binding
   guarantee (client can't underprice an order) is delivered when `place_order`
   is later changed to (a) recompute the subtotal server-side, (b) call this RPC
   with its own numbers, and (c) insert a `campaign_redemptions` row. That
   `place_order` change is intentionally **not** included, because `place_order`
   has several existing versions (loyalty, idempotency, delivery-zone, the coupon
   TOCTOU fix) and rewriting it is a separate, reviewed change.
2. **Redemption-write race-safety is the writer's job.** Usage limits are read
   from `campaign_redemptions` in the RPC. When `place_order` writes redemptions,
   it must enforce `global_limit`/`per_user_limit` race-safely (e.g. a
   conditional insert guarded by a `count(*) < limit` check under row locks, the
   same pattern as the coupon `usage_count` fix). The current RPC's count-based
   check is correct for validation/preview but is TOCTOU under concurrency, so
   the writer must re-check atomically.
3. **`free_delivery` interacts with `delivery_fee`, not the merchandise
   subtotal.** The RPC returns `discount_amount = delivery_fee` and
   `free_delivery = true`; the intended effect at order time is to waive the
   delivery fee (so `total = subtotal + delivery_fee - delivery_fee`). It is 0
   for pickup orders. Confirm whether the order path should model this as a
   discount line or by zeroing `delivery_fee`.
4. **Stacking rules are NOT defined.** Coupons (`validate_coupon`) and campaigns
   are independent today. Whether a campaign may stack with a coupon and/or
   loyalty, and in what order they apply, is a business decision left to the
   `place_order` integration. Default suggestion: apply campaign to the
   merchandise subtotal, then coupon, then loyalty, then VAT — but confirm.
5. **VAT interaction.** KSA VAT is inclusive and extracted from the payable total
   in `place_order`. A campaign discount reduces the payable total before VAT is
   extracted (same as coupons today). No VAT logic is added here.
6. **Codeless campaigns are publicly readable; coded campaigns are secret.** The
   public RLS policy requires `code IS NULL`, so advertised auto-apply promos are
   visible while promo codes are only ever validated through the RPC (never
   listed). Confirm this matches the intended "campaign vs. code" UX.
7. **Percentage vs. fixed caps.** `max_discount_amount` caps `percentage` and
   `fixed` discounts and both are additionally clamped to the subtotal;
   `free_delivery` is clamped only to the delivery fee. Confirm the cap should
   also apply to `fixed`.
8. **Branch scoping** uses `on delete cascade` (deleting a branch removes its
   scoped campaigns). Confirm that is the desired lifecycle vs. `set null`
   (campaign becomes all-branches) or `restrict`.

## What a reviewer must check

- The RPC is the single server-authoritative validation point; no client path
  computes or sends a discount amount.
- RLS: confirm anon/customers cannot see inactive/future/coded campaigns or other
  users' redemptions, and cannot write either table (the SQL test asserts this,
  but it has not been executed here — no local Postgres).
- Migration timestamp `20260728120000` is after the latest existing file
  (`20260723140000`) and the file is idempotent (`create ... if not exists`,
  `drop policy if exists`, `create or replace function`).
