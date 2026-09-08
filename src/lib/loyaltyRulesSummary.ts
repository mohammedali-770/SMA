/**
 * What is the loyalty programme actually doing right now?
 *
 * The settings that decide it are spread across two admin tabs and five
 * controls — rate, redemption floor, channel, expiry, campaigns — plus a
 * per-item flag on every product. An operator can read all of them and still not
 * be able to say what a customer will get, which is how a programme ends up
 * running rules nobody meant.
 *
 * This is a DESCRIPTION, not a calculation: `place_order` and
 * `compute_order_snapshot` remain the only things that decide a number. Nothing
 * here feeds a total, so it cannot drift into being a third copy of the earning
 * rule — it restates settings the operator has already saved.
 */
import type { LoyaltyCampaign } from './loyaltyCampaignsApi';
import type { LoyaltySettings } from '../types';

export interface RuleLine {
  /** Stable key for tests and React keys; never shown. */
  id: string;
  en: string;
  ar: string;
  /** `warn` for anything that reduces or removes customer value. */
  tone: 'info' | 'warn';
}

/**
 * As many decimals as the value actually has, and no more.
 *
 * Two decimals is NOT enough here, which review caught on #339:
 * `app_settings.discount_per_point` is `numeric(10,4)`, so a saved 0.0051
 * rendered as "0.01" — nearly double what a point is worth. In a block headed
 * "what the programme is doing right now" that is not a formatting nicety, it
 * is the summary contradicting the rule it claims to describe. Four decimals is
 * the column's own scale; trailing zeros are still dropped so an ordinary rate
 * does not print as "1.0000 point".
 */
function num(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(4)));
}

/** Live NOW — not merely active. A row can be active and scheduled for August. */
function liveNow(c: LoyaltyCampaign, now: Date): boolean {
  if (!c.is_active) return false;
  if (c.starts_at && new Date(c.starts_at) > now) return false;
  if (c.ends_at && new Date(c.ends_at) <= now) return false;
  return true;
}

export function loyaltyRulesSummary(
  s: LoyaltySettings,
  /**
   * Live campaigns, so the rate line is not read as the whole answer during
   * one. Optional because the settings tab may not have loaded them yet, and a
   * missing list must not be reported as "no campaigns" — see the line below.
   */
  campaigns?: LoyaltyCampaign[],
  now: Date = new Date(),
): RuleLine[] {
  // Programme off is the whole answer — appending "points expire in January" to
  // it would describe a programme that is not running.
  if (!s.isEnabled) {
    return [
      {
        id: 'off',
        en: 'The loyalty programme is OFF. No order earns or redeems points.',
        ar: 'برنامج الولاء متوقف. لا يكتسب أي طلب نقاطاً ولا يستبدلها.',
        tone: 'warn',
      },
    ];
  }

  const lines: RuleLine[] = [
    {
      id: 'rate',
      en: `Customers earn ${num(s.pointsPerRiyal)} point(s) per 1 SAR, and each point is worth ${num(s.discountPerPoint)} SAR at redemption.`,
      ar: `يكتسب العميل ${num(s.pointsPerRiyal)} نقطة لكل ١ ريال، وقيمة كل نقطة ${num(s.discountPerPoint)} ريال عند الاستبدال.`,
      tone: 'info',
    },
    {
      id: 'floor',
      en:
        s.minPointsToRedeem > 0
          ? `At least ${s.minPointsToRedeem} points are needed before any can be spent.`
          : 'There is no minimum before points can be spent.',
      ar:
        s.minPointsToRedeem > 0
          ? `يلزم ${s.minPointsToRedeem} نقطة على الأقل قبل الاستبدال.`
          : 'لا يوجد حد أدنى للاستبدال.',
      tone: 'info',
    },
    {
      id: 'channel',
      en: s.pickupOnly
        ? 'PICKUP ONLY: a delivery order neither earns points nor may spend them.'
        : 'Pickup and delivery both earn and redeem points.',
      ar: s.pickupOnly
        ? 'الاستلام فقط: طلبات التوصيل لا تكتسب نقاطاً ولا تستبدلها.'
        : 'الاستلام والتوصيل يكتسبان النقاط ويستبدلانها.',
      tone: s.pickupOnly ? 'warn' : 'info',
    },
  ];

  // The rate is a floor, not the whole story, once an item can be excluded or a
  // campaign can multiply — so say so rather than leaving the rate line to be
  // read as the complete rule.
  lines.push({
    id: 'perItem',
    en: 'Individual items can be set to earn nothing — check the Menu tab for which.',
    ar: 'يمكن ضبط أصناف بعينها لعدم منح نقاط — راجع صفحة القائمة.',
    tone: 'info',
  });

  lines.push(
    s.expiryEnabled
      ? {
          id: 'expiry',
          en: `EXPIRY IS ON: every balance returns to zero on ${s.expiryNextRunOn ?? 'a scheduled date'}, then every ${s.expiryPeriodMonths} month(s).`,
          ar: `انتهاء الصلاحية مفعّل: تُصفَّر جميع الأرصدة في ${s.expiryNextRunOn ?? 'التاريخ المجدول'}، ثم كل ${s.expiryPeriodMonths} شهر.`,
          tone: 'warn',
        }
      : {
          id: 'expiry',
          en: 'Points do not expire.',
          ar: 'النقاط لا تنتهي صلاحيتها.',
          tone: 'info',
        },
  );

  // CAMPAIGNS. Review found the block silent about them on #339, which made it
  // wrong precisely when an operator most needs it: during a campaign, the rate
  // line alone understates what a qualifying order earns.
  //
  // `undefined` and `[]` are deliberately different. An unloaded list says
  // nothing rather than "no campaigns are running" — this block is read as
  // authoritative, so the one thing it must never do is assert an absence it has
  // not checked.
  if (campaigns) {
    const live = campaigns.filter((c) => liveNow(c, now));
    if (live.length === 0) {
      lines.push({
        id: 'campaigns',
        en: 'No points campaign is running, so the rate above is the whole rate.',
        ar: 'لا توجد حملة نقاط فعّالة، فالمعدل أعلاه هو المعدل الكامل.',
        tone: 'info',
      });
    } else {
      const names = live.map((c) => `${c.name_en} (x${num(Number(c.multiplier))})`).join(', ');
      const namesAr = live.map((c) => `${c.name_ar} (×${num(Number(c.multiplier))})`).join('، ');
      lines.push({
        id: 'campaigns',
        en: `${live.length} points campaign(s) running now, so qualifying orders earn MORE than the rate above: ${names}. Check the campaign list for what each one applies to.`,
        ar: `${live.length} حملة نقاط فعّالة الآن، لذا تكتسب الطلبات المؤهلة أكثر من المعدل أعلاه: ${namesAr}. راجع قائمة الحملات لمعرفة نطاق كل حملة.`,
        tone: 'info',
      });
    }
  }

  return lines;
}
