/**
 * Where tapping a homepage banner goes — the only place that decides it.
 *
 * `homepage_banners.action_value` is free text at the database (nothing but the
 * console's product picker ever wrote a product id into it), and the tap used
 * to build the route straight from it: `/product/${actionValue}`. A value that
 * carries a path separator, `..` or a query is then a DIFFERENT in-app route
 * from the one an administrator chose to link to (audit finding F-X10-002).
 *
 * So the value is checked against the one shape a product route takes — a UUID,
 * which is what `products.id` is — and anything else yields `null`, meaning "no
 * navigation", never "navigate to whatever was stored". This is the same
 * allow-list approach as `features/auth/returnPath.ts`.
 */
import type { HomeBanner } from '../../types/models';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The in-app route a banner tap opens, or `null` when the banner is not (validly) tappable. */
export function bannerHref(banner: Pick<HomeBanner, 'actionType' | 'actionValue'>): string | null {
  if (banner.actionType !== 'product') return null; // 'category' / 'none': no navigation
  const id = banner.actionValue;
  if (typeof id !== 'string' || !UUID_RE.test(id)) return null;
  return `/product/${id}`;
}
