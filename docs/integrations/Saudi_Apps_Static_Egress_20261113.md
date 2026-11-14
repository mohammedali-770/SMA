# Fixed outbound addresses: what well-known Saudi apps do (draft)

> **Status: DRAFT, engineering-written 2026-11-13, for the owner. Revised the
> same day** after two adversarial reviews, one of the sources and facts and one
> of the reasoning and recommendation. Each finding was re-checked against the
> page it cites before anything changed, and the Review log at the end lists
> every finding and what was done with it. Everything about other companies and
> vendors comes from public sources, read on 2026-11-13. Facts about our own
> system come from the [proxy comparison draft](Moyasar_Static_IP_Proxy.md), which this
> goes with. Nobody was contacted and nothing was signed up for.
>
> How to read the labels:
>
> - **Published:** the company or vendor says it.
> - **Checked by us:** we looked up addresses a company publishes, in the cloud
>   provider's own published address list or in the public address registry.
> - **Inferred:** our reading. It could be wrong.

**The question.** In live mode, Moyasar accepts our secret key only from
internet addresses we list in its dashboard. You asked what famous Saudi apps
use to get such a **fixed outbound address**, meaning the address their
servers' calls appear to come from.

## 1. The short answer

Nobody publishes it. No well-known Saudi app says how its servers get fixed
outbound addresses for its payment gateway, and none is documented as using a
proxy service such as QuotaGuard or Fixie. What is published is that the big
apps run their own servers on large clouds (Google Cloud, AWS, Tencent Cloud).

Three of them publish the fixed addresses they send webhooks or orders from, so
that partners can allow them: Delivery Hero (which owns HungerStation), Keeta
and Tabby. Every address sits in a cloud that company is documented to use
(checked by us). For Tabby (Google Cloud, Dammam) and Keeta (Tencent), where no
proxy service we looked at operates, that suggests addresses reserved on their
own cloud network (inferred). For Delivery Hero (AWS) the check cannot decide,
because proxy services such as QuotaGuard also run on AWS, in the same regions.
None of them says how its servers reach its payment gateway.

On gateways: The Chefz uses Checkout.com, Careem names it as one of its payment
providers, and Checkout.com says it has served Delivery Hero in the region.
Checkout.com's key documentation asks for no fixed address. Moyasar is the only
gateway we found that insists on one, and at least one famous app uses it:
Jahez, for Samsung Pay (June 2025). Moyasar's site also cites HungerStation next
to Jahez for capture after delivery, without saying it is a customer.

Our payment code runs on Supabase, which gives us no network of our own, so we
need a relay with fixed addresses, as Supabase recommends. A small server of our
own is the closest copy of what the big apps appear to do, with an address only
we use. A managed relay is the least work, with addresses shared with the
vendor's other customers.

## 2. What we found

| App or platform | Where it runs (published) | Card gateway (published) | Fixed outbound addresses | Sources |
|---|---|---|---|---|
| **HungerStation** (Delivery Hero group) | Google Cloud (Kubernetes). Privacy policy, Sep 2024: platforms run on cloud resources from "the EU subsidiaries of Google Cloud Platform and Amazon Web Services". | Not named by HungerStation. Checkout.com says it has served Delivery Hero in the Middle East and North Africa since 2019, but does not name HungerStation. **Published by Moyasar (marketing):** "Authorization & Capture (including post-delivery capture) like Jahez or Hungerstation do." It does not say HungerStation is its customer. | **Published:** Delivery Hero gives restaurant POS systems 3 fixed addresses per region, "to receive orders from Integration Middleware", and lists HungerStation under Middle East/North Africa. **Checked by us:** the 3 "Middle East + Turkey" addresses are AWS, Ireland; the other 12 are AWS too (Ireland, N. Virginia, Singapore). **Inferred:** HungerStation's POS orders come from them. | [Google story](https://cloud.google.com/customers/hungerstation), [privacy policy](https://hungerstation.com/sa-en/privacy-policy), [Checkout.com](https://www.checkout.com/case-studies/how-localized-payments-is-driving-delivery-hero-s-global-expansion), [Moyasar platforms](https://moyasar.com/en/solutions/platforms-and-marketplaces/), [address list](https://integrar.pedidosya.com/es/documentation), [DH POS page](https://developers.deliveryhero.com/documentation/pos.html), [AWS list](https://ip-ranges.amazonaws.com/ip-ranges.json) |
| **Jahez** | 2021 share prospectus: platforms run on "Amazon Web Services and Google". It was moving customer data to servers inside the Kingdom to meet a CITC rule (§4), with a March 2022 deadline (PDF pp. 57, 69–70, 135). Its current host is not published. | **Moyasar**, at least for Samsung Pay (June 2025). Other gateways not named. | **Not publicly documented.** Moyasar says some existing live accounts still accept any address. | [prospectus](https://cma.gov.sa/en/Market/Prospectuses/Documents/Jahezen.pdf), [Moyasar blog](https://moyasar.com/en/resources/blog/jahez-activates-samsung-pay-on-moyasar-mpg/), [Moyasar Allowed IPs](https://docs.moyasar.com/guides/dashboard/setting-up-your-ip-whitelist) |
| **The Chefz** | Not publicly documented. | **Checkout.com** (2024). | Not publicly documented. | [Checkout.com](https://www.checkout.com/case-studies/chefz-offers-better-online-delivery-user-experience-with-enhanced-payment-efficiency) |
| **Mrsool** | AWS at some point: an undated AWS case study, now removed (its AWS address redirects to AWS's case-study index). Its current privacy policy says personal data is stored at its premises or in hosting inside Saudi Arabia "to preserve national data sovereignty" (our translation), and may be processed or stored abroad by affiliates or providers. Its current host is not publicly documented. | Not publicly documented. | Not publicly documented. | [case-study listing](https://www.casestudies.com/company/amazonwebservices/case-study/mrsool-delivers-anything-anywhere-with-aws), [privacy policy (Arabic)](https://s.mrsool.co/privacy_policy) |
| **Keeta** (Meituan) | A Benzinga report on Finviz (27 Jan 2026, citing CNBC) says Tencent's Saudi availability zone "serves customers there, including Keeta". How much of Keeta runs there is not stated. Privacy policy, Aug 2026: data may be stored in "Frankfurt, Hong Kong" and Saudi Arabia. | Not publicly documented. | **Published:** 22 fixed addresses that send its webhooks. **Checked by us:** all 22 are registered to Tencent (three blocks under the name "TencentCloud", the rest with the contact qcloud_net_duty@tencent.com) and sit on Tencent's network, AS132203. 13 are registered in Germany, 7 in Hong Kong and 2 in the US; the country of registration is not necessarily where the server is. | [press report](https://finviz.com/news/287930/tencent-wants-bigger-slice-of-middle-east-cloud-boom), [privacy policy](https://www.mykeeta.com/contents/privacy.html?region=SA&locale=en), [address list](https://api-docs.mykeeta.com/apis/standard/docs/apirequest.md), [registry](https://rdap.apnic.net/ip/43.157.1.126), [routing](https://ipinfo.io/AS132203) |
| **Careem** | "Careem runs entirely on AWS", with 800+ services on Kubernetes. | **Checkout.com**, "one of its Payment Service Providers". | Not publicly documented. | [Dynatrace](https://www.dynatrace.com/customers/careem/), [Checkout.com](https://www.checkout.com/case-studies/careem-scales-at-speed) |
| **ToYou** | Not publicly documented. | Not named. It announced a Geidea partnership in 2022 (scope not stated) and launched Tabby pay-later in 2023. | Not publicly documented. | [Arab News](https://www.arabnews.com/corporate-and-sponsored-content/toyou-joins-forces-with-saudi-payments-infrastructure-giant-geidea-2196611), [Tabby release](https://prnewswire.co.uk/news-releases/toyou-and-tabby-join-forces-raising-the-bar-in-customer-experience-and-online-delivery-301713465.html) |
| **Shgardi** | AWS since 2021 (Kubernetes). | Not publicly documented. | Not publicly documented. | [AWS case study](https://aws.amazon.com/solutions/case-studies/shgardi/) |
| **Nana** | Google Cloud since 2016 (Kubernetes). | Not publicly documented. | Not publicly documented. | [Google story](https://cloud.google.com/customers/nana) |
| **Zid** (store builder) | "an AWS house", "primarily in eu-west-1" (Ireland). | Zid's help page names MyFatoorah as the payment service provider on the Zid Payments account-opening request. Moyasar's platforms page points to Zid as an example of a platform managing sub-merchants. | Not publicly documented. | [Zid engineering](https://zid.engineering/zid-50m-orders-later/), [Zid help (Arabic)](https://help.zid.sa/ar/payments/activate-zid-payments), [Moyasar platforms](https://moyasar.com/en/solutions/platforms-and-marketplaces/) |
| **Salla** (store builder) | Cloudflare in front. The cloud behind it is not published. | Tap says it powers Salla 4.0. Merchants can also connect Moyasar by pasting their live secret key into Salla. | **Not publicly documented.** **Inferred:** Salla's servers make those Moyasar calls. Neither Salla nor Moyasar says whose addresses go on the list. | [Cloudflare](https://www.cloudflare.com/case-studies/salla/), [Tap blog](https://blog.tap.company/salla-4-0-saudi-ecommerce/), [Salla help](https://help.salla.sa/en/article/connect-moyasar-payment-gateway/zm2rkn8lfc8gjd6drybo2tvh) |
| **Tabby** (pay later) | Google Cloud (Kubernetes). Its CTO: "I can't overstate the importance of the Dammam Cloud Region", and "With our infrastructure physically located in the country, we can show the regulators that we are complying with all their data sovereignty requirements". | It is a payment provider itself. | **Published:** 8 addresses for merchants to allow, on its webhooks page. **Checked by us:** 7 are in Google Cloud Dammam and 1 in Mumbai. | [Google story](https://cloud.google.com/customers/tabby), [Tabby webhooks](https://docs.tabby.ai/pay-in-4-custom-integration/webhooks.md), [Google list](https://www.gstatic.com/ipranges/cloud.json) |
| **Tamara** (pay later) | AWS. Its status page blames "our external provider (AWS)" for a sandbox outage and "our external cloud provider (AWS)" for a merchant-services incident in which settlement reports and tax invoices could not be downloaded, both on 1 Apr 2026. | It is a payment provider itself. | **Published:** an in-store go-live checklist says merchants "needing to whitelist Tamara IPs to connect with Tamara system" get the list from their Integration Manager or Account Manager "on requirement". It does not say whether these are addresses Tamara sends from. | [go-live checklist](https://docs.tamara.co/docs/in-store-go-live-testing-checklist.md), [status data](https://statuspage.tamara.com/data/payload.json) |

**Reading the last column.** A short list of addresses that all sit inside a
company's cloud is what you get when you reserve addresses on that cloud's own
outbound gateway. Google's docs say to assign the addresses yourself "if you
depend on knowing the set of possible NAT IP addresses ahead of time (for
example, to create an allowlist)"
([Google](https://docs.cloud.google.com/nat/docs/ports-and-addresses)). AWS
recommends one such gateway per zone
([AWS](https://docs.aws.amazon.com/vpc/latest/userguide/nat-gateway-basics.html)),
which would explain Delivery Hero's three addresses per region. Moyasar's own
page describes the same set-up: for servers in a private network, "requests
leave through a NAT gateway, so add the NAT gateway's public IP"
([Moyasar](https://docs.moyasar.com/guides/dashboard/setting-up-your-ip-whitelist)).
But the same list is also what relay servers of the company's own, or a proxy
service hosted on that cloud, would give you: QuotaGuard runs in 12 AWS regions,
including Ireland, N. Virginia and Singapore, the three Delivery Hero uses
([QuotaGuard](https://www.quotaguard.com/products/pricing/)). None of these
companies says how it does it, so this is our inference.

**Two public projects aimed at the Saudi market** use the simplest version: one
server inside the Kingdom, whose own address is the one a provider allows.
[One](https://github.com/Majed-2000/SunRay-App/blob/d49c00f2eead6798985120fb5b9447f95b0ac55a/README.md),
a café app on a LightNode VPS in Riyadh, waits for its SMS provider (Yamamah) to
allow that server's address. It had earlier used a third-party relay "to dodge
the whitelist". That relay "now returns 503", and the project abandoned it,
noting that calling the provider directly "also removes a third party from the
path OTP codes travel".
[Another](https://github.com/muathhamad111-lgtm/moashir/blob/3c62e5df6aa0e6a7089eed81dfd61b0ef5bc6758/backend/README.md),
whose server is "in the Kingdom", recommends adding the server's addresses to
"the Moyasar IP whitelist of each mode". Two projects are a small sample. We
found no public example of a Saudi team using QuotaGuard or Fixie with Moyasar.

## 3. What Moyasar and other gateways say

**Moyasar** ([Allowed IPs page](https://docs.moyasar.com/guides/dashboard/setting-up-your-ip-whitelist), updated 11 November 2026):

- **Live:** "You must list at least one address." Until one is listed, the
  live secret key stays hidden and cannot be regenerated. Once a live list is
  saved, live "cannot be set back to any IP address". Some existing live
  accounts still accept the key from any address.
- **Test:** works from any address until you choose specific ones.
- **For our kind of hosting:** "Set up a static outbound IP with your provider
  first, then add it." It also says to add the outbound address of "every
  server, worker and scheduled job" that uses the secret key.
- **What it does not offer:** it names no proxy vendor and no platform, gives no
  exception for serverless code, and has no rule about where the addresses must
  be.
- **Refusals:** a call from an unlisted address gets 401 "This IP Address is not
  whitelisted to do this operation".
- **History:** the feature launched in July 2020 as optional, "It is optional."
  ([announcement](https://announcekit.app/moyasar/announcements?label=8595)).
  When it became mandatory for live is not publicly documented.

**Other gateways used in Saudi Arabia.** None of them names a proxy vendor.

- **PayTabs** makes it optional: "If no limit is set, then the key can be used
  from any IP address"
  ([PayTabs](https://support.paytabs.com/en/support/solutions/articles/60000709801)).
- **Amazon Payment Services** makes it optional too: "By default, we advise to
  keep Origin IP and Origin URL blank"
  ([APS](https://paymentservices.amazon.com/account-activation-guide)).
- **HyperPay**'s platform has an error code for "merchant source IP address not
  whitelisted", but its docs do not require a list
  ([HyperPay](https://hyperpay.docs.oppwa.com/reference/resultCodes)).
- **Tap, Geidea, Checkout.com and Network International (N-Genius):** we found
  no setting that limits a merchant's key to the merchant's own addresses in
  their public docs. For Tap, Geidea and N-Genius this rests on their
  documentation indexes, which list page titles only (their full-text versions
  return 404), and on web searches
  ([Tap](https://developers.tap.company/llms.txt),
  [Geidea](https://docs.geidea.net/llms.txt),
  [N-Genius](https://docs.ngenius-payments.com/llms.txt)). For Checkout.com it
  rests on its API-key page
  ([Checkout.com](https://www.checkout.com/docs/developer-resources/api/manage-api-keys/api-keys)).
  Checkout.com does publish its own API and webhook addresses, for merchants'
  firewalls ([Checkout.com IP addresses](https://www.checkout.com/docs/developer-resources/ip-addresses)).
  A dashboard-only setting cannot be ruled out (§6 item 6).
- **Inferred:** among the gateways we checked, only Moyasar makes the list
  mandatory for live keys. No app discusses its gateway networking, Jahez
  included, so their silence tells us nothing either way.

**Supabase and Google agree that serverless addresses change; their fixes
differ.** Google's fix is a gateway it runs, with addresses you reserve.
Supabase's is a small server you run.

- **Supabase:** Edge Functions "do not originate from a single static IP
  address". Its recommended fix is "an Outbound Proxy": "a small, dedicated
  instance (for example, an AWS EC2 instance or similar cloud VM) with a fixed
  egress IP". Its other two suggestions are a shared secret in a header, which
  works only for servers you control (not Moyasar), and running Supabase's Edge
  Runtime yourself on a server with a static address
  ([Supabase](https://supabase.com/docs/guides/troubleshooting/why-supabase-edge-functions-cannot-provide-static-egress-ips-for-whitelisting-3d78b0)).
  Its Dedicated IPv4 add-on fixes the address for incoming traffic only
  ([Supabase](https://supabase.com/docs/guides/platform/ipv4-address)).
- **Google:** its serverless platform sends traffic from "a regional pool of
  dynamic IP addresses" by default. For "reputation-sensitive external
  endpoints, such as payment gateways", it says to send the traffic out through
  its own NAT gateway "with dedicated static outbound IP addresses" instead
  ([Google](https://docs.cloud.google.com/run/docs/configuring/networking-best-practices)).

## 4. The Saudi-hosted option

**Open now (13 Nov 2026):**

- **Oracle Cloud:** Jeddah and Riyadh
  ([Oracle](https://docs.oracle.com/en-us/iaas/Content/General/Concepts/regions.htm)).
- **Huawei Cloud:** Riyadh
  ([Huawei](https://support.huaweicloud.com/intl/en-us/usermanual-organizations/org_03_0082.html)),
  launched 4 September 2023
  ([PR Newswire](https://www.prnewswire.com/il/news-releases/with-saudi-go-global-huawei-cloud-launches-services-in-saudi-arabia-301916944.html)).
- **Alibaba Cloud:** Riyadh, which Alibaba lists as a "Partner Region"
  ([Alibaba regions](https://www.alibabacloud.com/help/en/ecs/user-guide/regions-and-zones))
  and "Partner-operated"
  ([Alibaba prices](https://www.alibabacloud.com/help/en/eip/product-overview/pay-as-you-go)).
  sccc by stc, an stc subsidiary, says it provides Alibaba Cloud services in
  Saudi Arabia ([sccc](https://www.sccc.sa/en)).
- **Tencent Cloud:** Riyadh, two zones, "Riyadh Zone 1" and "Riyadh Zone 2"
  ([Tencent Cloud](https://www.tencentcloud.com/document/product/213/6091),
  updated 29 October 2026). Not priced.
- **stc cloud**
  ([stc](https://cloud.stc.com.sa/virtual-data-center/cost-estimation)).
- **Google Cloud:** Dammam, but only bought through its reseller CNTXT, on
  invoiced billing. A Saudi billing address must buy every Google Cloud region
  that way
  ([Google](https://docs.cloud.google.com/docs/dammam-region-access)).
- **LightNode** (a VPS seller): Riyadh and Jeddah. "Each plan includes a static
  dedicated Saudi IP"
  ([LightNode](https://go.lightnode.com/saudi-arabia-vds)).

**Not open yet:**

- **AWS:** Amazon says it is "on track to launch in December 2026"
  ([Amazon](https://www.aboutamazon.com/news/aws/aws-cloud-region-saudi-arabia)).
- **Microsoft Azure:** announced for November 2026
  ([Microsoft](https://news.microsoft.com/source/emea/2026/08/microsoft-announces-saudi-arabia-east-datacenter-region-will-be-available-in-november-2026/)).
  It was not on Microsoft's region list on 10 November
  ([list](https://learn.microsoft.com/en-us/azure/reliability/regions-list)),
  and we found no launch notice by 13 November.

**Cheapest fixed-address servers found: roughly $5 to $13 a month,** at
Alibaba Cloud or Huawei Cloud in Riyadh, at list prices, before a disk at
Alibaba and before our own time.

| Provider | Monthly price | What it covers |
|---|---|---|
| Alibaba Riyadh | about $5, plus a disk (not priced) and traffic | Smallest server at $0.0072 an hour ([tracker](https://sparecores.com/server/alicloud/ecs.t6-c4m1.large)). The fixed address costs $0.008 an hour, but that fee is "waived" while the address is bound directly to the server, on accounts allowed 2,000 addresses or fewer. Outbound traffic is $0.097 a GB, cents a month at our volume (estimate) ([Alibaba](https://www.alibabacloud.com/help/en/eip/product-overview/pay-as-you-go)) |
| Huawei Riyadh | about $9 to $13 | Server, fixed address and disk. A researcher's reading of [Huawei's price data](https://www.huaweicloud.com/intl/en-us/pricing/calculator.html), not re-checked |
| Google Dammam | about $13, plus disk, on CNTXT's terms | Smallest server ([tracker](https://cloudprice.net/gcp/compute?region=me-central2&filter=%5EE2-)) plus Google's general address price ([Google](https://cloud.google.com/vpc/network-pricing)) |
| LightNode | from $21.2 | Server and fixed address ([LightNode](https://go.lightnode.com/saudi-arabia-vds)) |
| Oracle Jeddah or Riyadh | $0 on Always Free, about $21 to $23 paid | Free servers must be in the account's home region, and Oracle may reclaim idle ones ([Oracle](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)); a low-traffic relay would likely count as idle (our inference). The paid figure is our arithmetic from [Oracle's price list](https://apexapps.oracle.com/pls/apex/cetools/api/v1/products/?currencyCode=USD): one E4 processor at $0.025 an hour, 1 to 2 GB of memory at $0.0015 per GB an hour, and a 47 GB disk at $0.0255 per GB a month plus its performance charge |
| stc cloud | about 110 SAR (about $29) | The fixed address alone, at 0.15 SAR an hour, before any server ([stc](https://cloud.stc.com.sa/virtual-data-center/cost-estimation)) |

One server is a single point of failure, so double the server prices for a
standby.

**Does any rule require a Saudi relay?** None that we found. What the sources
state:

- **Moyasar** sets no location rule for its list (page above).
- **SAMA's Cyber Security Framework** says cloud services should "in principle"
  be located in Saudi Arabia. It applies to banks, insurers, financing
  companies, credit bureaus and market infrastructure
  ([scope](https://rulebook.sama.gov.sa/en/entiresection/3850),
  [cloud rule](https://rulebook.sama.gov.sa/en/node/3972)). Our reading: a
  restaurant is not on that list.
- **The NCA's ECC-2:2024 and CCC-2:2024** cover government bodies and operators
  of critical national infrastructure. Both deleted their "inside the Kingdom"
  hosting rules and moved data localization to the National Data Management
  Office
  ([ECC](https://cdn.nca.gov.sa/api/files/public/upload/86e09090-44e4-481f-bc28-355673607654_ECC--2024-EN.pdf),
  [CCC](https://cdn.nca.gov.sa/api/files/public/upload/6d5408a3-d8e6-4e96-963b-2c7198e5b7c2_CCC-2-2024-EN-.pdf)).
- **A sector rule, found in our own source.** Jahez's 2021 prospectus says the
  "General Principles for Personal Data Protection in the Telecommunications,
  Information Technology and Postal Sectors" (CITC Resolution No. 415,
  16 April 2020) required it "to process customers' personal data inside the
  Kingdom", and that it "may not process such data outside the Kingdom without
  the written approval of the CITC" (PDF pp. 69–70,
  [prospectus](https://cma.gov.sa/en/Market/Prospectuses/Documents/Jahezen.pdf)).
  That is why Jahez was moving data into the Kingdom (§2). A law firm's guide,
  updated 8 October 2025, still says these principles "require that service
  providers process customers' personal data within KSA", and does not say they
  were superseded ([CMS](https://cms.law/en/int/expert-guides/cms-expert-guide-to-data-protection-and-cyber-security-laws/saudi-arabia)).
  The regulator's own copies of the text returned "not found" on 13 November
  (CITC is now called CST,
  [CST](https://www.cst.gov.sa/en/about/who-we-are)). Whether the rule still
  applies after the PDPL, and whether a restaurant's own app counts as a
  "service provider" under it, is not verified. Ask counsel.
- **The PDPL in force** allows transfers abroad under conditions, in Article 29
  ([PDPL](https://sdaia.gov.sa/en/SDAIA/about/Documents/PersonalDataProtectionLaw.pdf)).
- **SDAIA's draft amendments to the PDPL's Implementing Regulation** were open
  for comment from 6 October to 5 November 2026. Draft Article 23(2) would
  require controllers to store personal data in the Kingdom, and Reed Smith
  calls the wording ambiguous. If approved, they take effect sixty days after
  publication in the Gazette. They were not in force when Reed Smith wrote, on
  16 October, and we did not find the outcome
  ([Reed Smith](https://www.reedsmith.com/our-insights/blogs/viewpoints/102o5at/sdaia-consults-on-extensive-amendments-to-the-saudi-pdpl-implementing-regulation/)).

No source deals with a relay that only passes encrypted traffic. Treat this as
"not addressed" rather than "allowed", and ask counsel if you need certainty. A
relay that only tunnels holds no payment content. A managed one keeps
connection records (QuotaGuard: about 60 days), which show the calling server's
address, `api.moyasar.com`, the times and the sizes, and nothing about our
customers (our reading of the fields it lists)
([QuotaGuard](https://www.quotaguard.com/privacy-security-gdpr-faqs)). If any
localisation rule applies to us (the CITC rule, if it still applies, or SDAIA's
draft, if adopted), the real question is our database in Frankfurt. Moving the
relay would not change that.

## 5. What this means for Spicy Meal

**The evidence does not change the recommendation, which rests on upkeep.**
Three reasons:

1. **Copying the big apps means running something ourselves.** What they
   publish are the addresses they send webhooks and orders from, each on a
   cloud they are documented to use (checked by us). For Tabby and Keeta that
   points to their own cloud network rather than a rented proxy (inferred). For
   Delivery Hero, whose addresses are ordinary AWS ones, the check cannot tell
   (§1). Whether any of them uses its cloud's outbound gateway, relays of its
   own or a proxy service is not publicly documented, and neither is how it
   reaches its payment gateway. We have no cloud network of our own, because
   Supabase gives us none. Its suggested fix is a small server of our own with
   a fixed address, which is the own-server option below. A managed relay is
   the same idea, run by a vendor.
2. **Nothing we found asks for a Saudi relay.** Moyasar sets no location rule.
   On where data is kept, the market is mixed. Delivery Hero's regional POS
   addresses are AWS Ireland, Keeta's webhook addresses are registered in
   Germany, Hong Kong and the US, and Zid runs mainly in Ireland. Tabby sends
   from Google's Dammam region; HungerStation, Mrsool and Jahez describe keeping
   data in the Kingdom; and Jahez cites a CITC rule (§4). Those rules are about
   where customer data is processed. For us that is the database in Frankfurt,
   not a relay that passes encrypted traffic (our reading; ask counsel).
3. **A Saudi server would make us run a server.** With a standby, two Saudi
   servers cost a little less than Shield Starter ($11 to $26 a month against
   $29, before a disk at Alibaba), and $33 to $48 less than Shield Production
   ($59). But a server on the payment path is upkeep that a team without
   operations staff is better off paying someone else for.

| | **Managed relay** (QuotaGuard Shield; Fixie as backup) | **Our own small server, Saudi region** | **Our own small server, Frankfurt** |
|---|---|---|---|
| Monthly cost | $29 (Shield Starter, 20,000 requests) or $59 (Shield Production, 100,000) ([QuotaGuard](https://www.quotaguard.com/products/pricing/)). A second vendor kept ready as a standby adds $19 (Fixie Cruiser, [Fixie](https://usefixie.com/pricing)) | About $5 to $13 a server at Alibaba or Huawei (§4; Alibaba before a disk), or from $21.2 at LightNode. A standby doubles it: about $11 to $26 for two | $4 to $7 a server (DigitalOcean $4 or $6, Lightsail $5 or $7) ([DigitalOcean](https://www.digitalocean.com/pricing/droplets), [Lightsail](https://aws.amazon.com/lightsail/pricing/)). A standby doubles it: $8 to $14 for two |
| Addresses ours alone | **No.** QuotaGuard's price page says Starter, Production and Business "use shared static IP pairs"; a private pair needs Shield Enterprise ($269) ([QuotaGuard](https://www.quotaguard.com/products/pricing/)). Fixie: unclear. Its price page says "a dedicated static IP" ([Fixie](https://usefixie.com/pricing)), and a competitor says Fixie's are shared ([draft](Moyasar_Static_IP_Proxy.md) §1) | Yes. We can also let the relay reach only `api.moyasar.com` (our design choice) | Yes, as for Saudi |
| Setting it up | Low: sign up, add one Supabase secret, list 2 addresses ([draft](Moyasar_Static_IP_Proxy.md) §3) | Medium: we build the relay. It must demand a password, because Supabase's addresses change and it cannot simply trust ours, and it needs an encrypted link. About half a day (estimate, [draft](Moyasar_Static_IP_Proxy.md) §1). Sign-up hurdles, below | Same build, with an easy sign-up |
| Upkeep | Low, and no server: watch the monthly request count against the plan, keep the card current, and keep the vendor's written answers on file | Ours: updates, certificates and monitoring, about 1 to 2 hours a month (estimate) | Same as Saudi |
| Reliability | 2 addresses behind one name. Every Shield plan includes "High availability and automated failover", and QuotaGuard states 99.95% and 99.98% historic uptime ([QuotaGuard](https://www.quotaguard.com/products/pricing/)). Its SLA covers only Enterprise plans bought directly and "does not apply to other plans" ([SLA](https://www.quotaguard.com/docs/support/service-level-agreement)). One vendor in one region: if it is down, card payments stop until it recovers, or until we switch the Supabase secret to a second vendor whose addresses are already on Moyasar's list | One server is a single point of failure. Card payments stop until someone fixes it or switches the Supabase secret to the standby | Same as Saudi |
| What the relay keeps, and where | Tunnel only: the relay sees `api.moyasar.com`, the times and the sizes, never the content. QuotaGuard keeps connection records about 60 days and says data may leave the EU ([QuotaGuard](https://www.quotaguard.com/privacy-security-gdpr-faqs)). Fixie: probably the US unless it confirms the EU, since it says it "operates in the same data center as Heroku's US region" ([Fixie](https://usefixie.com/features)) | Same tunnel. The records stay in Saudi Arabia | Same tunnel. The records stay with us, in the EU |
| Latency to Moyasar | Not measured. Our functions run in several regions (Mumbai, Zurich and N. Virginia in one day), so any relay adds a detour, estimated at a second at most against a 12 to 15 second limit ([draft](Moyasar_Static_IP_Proxy.md) §1). Pinning the payment functions to Frankfurt would remove most of the detour to a Frankfurt relay. It is a code change, and a pinned call is not re-routed if that region has an outage ([Supabase](https://supabase.com/docs/guides/functions/regional-invocation)) | Not measured. Possibly a little closer to Moyasar, which says it stores and processes personal data in Saudi Arabia ([Moyasar](https://moyasar.com/en/resources/privacy-policy/)). Supabase has no Middle East region to pin the functions to ([Supabase](https://supabase.com/docs/guides/functions/regional-invocation)). Not a deciding factor | Same as managed |
| Sign-up | A card. QuotaGuard has a 3-day trial ([draft](Moyasar_Static_IP_Proxy.md) §6) | Google: CNTXT only, on invoiced billing, and forum users report that individuals are turned away ([Google](https://docs.cloud.google.com/docs/dammam-region-access), [forum](https://discuss.google.dev/t/ksa-region-cntxt-individual-onboarding-unavailable-completely-blocks-sandbox-testing/378547)). Oracle refuses PIN-debit, virtual and prepaid cards ([Oracle](https://www.oracle.com/cloud/free/faq/)). stc's general business terms ask a new business client for a commercial registration, licence or entity ID, without mentioning stc cloud ([stc](https://www.stc.com.sa/en/business/static/terms-and-conditions.html)); a registered company presumably has one (our inference). Alibaba and Huawei take cards ([Alibaba](https://www.alibabacloud.com/help/en/user-center/instruction-of-payment-management), [Huawei](https://support.huaweicloud.com/intl/en-us/usermanual-account/account_id_001.html)) | A card |

**Why shared addresses matter.** With a shared pair, other customers' traffic
leaves from the addresses on our live list. That does not let anyone use our
Moyasar account, because every call still needs our secret key. It does make
the list a weaker second lock if that key ever leaks
([draft](Moyasar_Static_IP_Proxy.md) §2). It is the one security property on which the
options differ: the tunnel keeps the content, the key included, out of the
relay's reach in every column.

**Also considered.**

- **Vercel's Static IPs**, since Vercel already serves our web build
  (`docs/DEPLOY.md`): $100 a month per project on Pro, plus data transfer, and
  the pair is shared with "a small group of customers in the same region"
  ([Vercel](https://vercel.com/docs/networking/static-ips)). The calls to
  Moyasar would have to be made from Vercel instead of Supabase. It costs more
  than the relay and is a bigger change.
- **Google Cloud Run with Cloud NAT and reserved addresses**, Google's own
  answer for serverless code that calls payment gateways (§3). It is the closest
  match to what the big apps appear to do, but our payment code would run on a
  second cloud. Not priced.
- **A relay container on Fly.io.** A fixed outbound address costs $3.60 a month
  and survives redeploys ([Fly.io](https://docs.fly.io/networking/egress-ips)),
  plus the machine it runs on (not priced). That is less operating-system upkeep
  than a server, but the relay is still ours to build and look after, which is
  why the proxy comparison draft rules it out ([draft](Moyasar_Static_IP_Proxy.md) §1).
- **Running Supabase's Edge Runtime on our own server**, Supabase's third
  suggestion (§3). It moves the payment functions onto a server we run, which is
  the most work of all.

**Recommendation: keep the draft's choice, QuotaGuard Shield in Frankfurt.**

**One addition to the draft.** QuotaGuard's price page labels the $29 Starter
plan "For compliance dev and test environments". It labels the $59 Production
plan "For production healthcare and fintech applications", and says both use
shared address pairs
([QuotaGuard](https://www.quotaguard.com/products/pricing/)). Before starting
the free trial, ask QuotaGuard in writing whether Starter is acceptable for live
card payments (question 1 of the QuotaGuard email in the
[draft](Moyasar_Static_IP_Proxy.md) §7), and start the trial on the plan its
answer allows. If Starter is not acceptable, budget $59 a month. The same page says "Upgrading or downgrading your plan does not change
your assigned IP addresses", so starting on Starter costs nothing if we later
move to Production.

**Ask Moyasar before starting the trial, and in any case before any Allowed IPs
list is changed, TEST or live,** because once
it is saved, live "cannot be set back to any IP address" (§3). Three questions:
does it accept addresses that a relay shares with its other customers; how do
platforms such as Salla meet the list for their merchants; and does it
recommend a provider? Neither Moyasar's page nor Salla's Moyasar guide answers
them: Salla asks merchants to paste the key "that starts with sk_live_" and
says nothing about addresses
([Salla](https://help.salla.sa/en/article/connect-moyasar-payment-gateway/zm2rkn8lfc8gjd6drybo2tvh)).

**Fallback: Fixie, Cruiser plan, $19 a month.** First ask Fixie the two
questions in the draft: can the relay be in the EU, and are the addresses ours
alone? ([draft](Moyasar_Static_IP_Proxy.md) §2). As planned, Fixie is a fallback
purchase, not a standby. If card payments must survive a QuotaGuard outage,
keep Fixie as a standby instead: an account open, its addresses already on
Moyasar's live list, and $19 a month on top.

**Only if a Saudi address becomes required,** for example if SDAIA's draft rule
is adopted in a form that covers relays, or if Moyasar asks: run two small
servers in Riyadh, at Alibaba Cloud or Huawei Cloud, and put both addresses on
Moyasar's list. That costs roughly $11 to $26 a month at list prices (Alibaba
before a disk), plus our time. **Our own server in Frankfurt is not
recommended.** It saves roughly $15 to $21 a month against Starter, or $45 to
$51 against Production, but brings the same upkeep and no location benefit. Its
one advantage is an address only we use.

## 6. Not verified

1. **How any famous Saudi app actually reaches its gateway** is not publicly
   documented. Every "inferred" entry in §2 is our reading. The Tencent link
   for Keeta's addresses rests on registry and routing records and one press
   report, and the country an address is registered in is not necessarily
   where its server is.
2. **Gateways not public:** HungerStation (beyond Moyasar's marketing mention),
   Mrsool, ToYou and Keeta; and Jahez beyond Samsung Pay. The current hosts of
   Jahez and Mrsool were not found. Ninja is not in the table because nothing
   about its host, gateway or addresses was found. Job ads that may name the
   clouds of The Chefz, ToYou and Ninja were gone (404, 410 or 403).
3. **Whether Jahez's Moyasar account is an existing one** that still accepts
   any address.
4. **How Salla and Zid satisfy Moyasar's list** for their merchants. A question
   for Moyasar (§5).
5. **When Moyasar made the live list mandatory.** help.moyasar.com and
   updates.moyasar.com could not be reached from this session.
6. **Dashboard-only address locks.** For Tap, Geidea and N-Genius we searched
   only their documentation indexes and the web; for Checkout.com, its API-key
   page. Any of them may have a setting their public docs do not mention. One
   third-party page says IP restrictions "can be configured in the Checkout.com
   dashboard for API access"
   ([SailPoint](https://documentation.sailpoint.com/entro/help/supported-secrets/specific-secrets/checkout-com-api-secret-key.html)).
7. **Saudi prices:**
   - The Huawei figure is a researcher's reading, not re-checked. Oracle's paid
     figure is our own arithmetic.
   - The Alibaba and Google server prices come from third-party trackers, and
     Google's Dammam address price could not be extracted.
   - Disks are not priced for Alibaba or Google, traffic is priced only for
     Alibaba, and Tencent's Riyadh region was not priced at all.
   - LightNode's page says $21.2 a month, while one developer reports about
     $7.71 a month for the same size.
8. **Cloud launches and access:** whether Azure's Saudi region has opened,
   AWS's exact December date, and CNTXT's prices and terms. Also whether an
   account billed to a Saudi address can buy Alibaba's Riyadh partner region
   directly by card; Google's CNTXT rule shows such limits exist.
9. **Rules:** we did not read NDMO's data-localization text, the primary text
   of CST's cloud regulations, or the final outcome of SDAIA's draft. Whether
   the CITC principles of Resolution 415 still apply after the PDPL, and
   whether they cover a restaurant's own app, is for counsel; CST's two copies
   of the text
   ([1](https://www.cst.gov.sa/ar/Decisions/PublishingImages/Pages/415-1441/attch415.pdf),
   [2](https://www.cst.gov.sa/ar/RulesandSystems/privacy/Documents/Data_Privacy_Principles_For_ICT.pdf))
   returned 404 on 13 November.
10. **Latency was not measured.** Moyasar does not publish where its API
    servers are.
11. **QuotaGuard:** whether Starter is meant for live payments. Treat Starter's
    pair as shared: the price page says so, and only its llms.txt says "a
    dedicated pair of static IPs per subscription"
    ([llms.txt](https://www.quotaguard.com/llms.txt)).
12. **Search coverage:** Reddit, Stack Overflow, X and Arabic developer forums
    were not searched, because the search budget ran out. The revision added
    targeted searches on gateway address locks and the CITC rule only.

---

## Review log

Two adversarial reviews (2026-11-13): **A**, sources and facts (2 blocking,
10 should-fix, 14 nits); **B**, reasoning and recommendation (1 blocking,
9 should-fix, 4 nits). Every finding was re-checked against the page it cites,
fetched again for this revision. Where both reviews raised the same point, the
fixes were merged.

| Finding | Outcome | Evidence |
|---|---|---|
| **A-B1, B-B1.** §5 reason 1 stated the central inference as fact, and the address check cannot decide for Delivery Hero. | **Applied**, merged: §5 reason 1 rewritten with labels, and the same caveat in §1. B's point that Supabase's fix is our own server, so the method is open to us at the cost of upkeep, is in reason 1. | QuotaGuard: "QuotaGuard proxies run in 12 AWS regions", including EU-West-1, US-East-1 and AP-Southeast-1 (price page). Re-ran the check: Delivery Hero's 15 addresses are AWS eu-west-1, us-east-1 and ap-southeast-1; Tabby's are 7 in me-central2 and 1 in asia-south1. Supabase: "Deploy a small, dedicated instance… with a fixed egress IP". |
| **B-S1.** §1's "not a rented proxy" rests on the same non-deciding check. | **Applied** in §1 and in "Reading the last column", which now also names relays of the company's own. | As above. Fixie "operates in the same data center as Heroku's US region" (features page). |
| **A-B2.** The CITC data-localisation rule in the cited Jahez prospectus was left out. | **Applied:** a §4 bullet, the closing paragraph of §4, §6 item 9 and the Jahez row. Extended: a CMS guide updated 8 Oct 2025 still states the rule and does not say it was superseded; CST's own two copies return 404. | Prospectus PDF pp. 69–70 (CITC Resolution No. 415, 16 Apr 2020: "required to process customers' personal data inside the Kingdom"; "may not process such data outside the Kingdom without the written approval of the CITC"), repeated on p. 71. |
| **A-S1, B-S3.** §5 reason 2 was one-sided. | **Applied**, merged into reason 2, with Tabby, HungerStation, Mrsool and Jahez on the in-Kingdom side. | Tabby's CTO: "we can show the regulators…"; HungerStation's Google story: "data will never leave the country"; Mrsool's policy (Arabic): stored in the Kingdom "لضمان المحافظة على السيادة الوطنية للبيانات". |
| **A-S2.** Keeta attribution overstated the source. | **Applied.** The Keeta sentence is the reporter's text, not a quote from Tencent Cloud's CEO. | Finviz page (Benzinga links, by Anusuya Lahiri, 27 Jan 2026): "Tencent has already launched an availability zone in Saudi Arabia and serves customers there, including Keeta". |
| **A-S3.** Mrsool's "AWS" is undated and probably stale. | **Applied.** | The AWS address redirects to `aws.amazon.com/solutions/case-studies/`; the casestudies.com listing has no date; the archive could not be reached from this session. |
| **A-S4.** Tamara understated. | **Applied, with one quote corrected:** the sandbox incident says "our external provider (AWS)"; only the merchant-services incident says "our external cloud provider (AWS)". | `statuspage.tamara.com/data/payload.json`, both incidents started 1 Apr 2026. |
| **A-S5.** Huawei's date not in the cited page. | **Applied**, PR Newswire added. | "04 Sep, 2023… announced the launch of the Huawei Cloud Riyadh Region today". |
| **A-S6.** Alibaba's operator not in the cited page. | **Applied.** | Regions page: "SAU (Riyadh - Partner Region)"; price page: "Partner-operated"; sccc: "an stc subsidiary", "providing Alibaba cloud services in Saudi Arabia". |
| **A-S7.** Tencent Cloud Riyadh missing. | **Applied** in §4 and §6 item 7. | Tencent's page (updated 2026-10-29): `me-saudi-arabia`, "Riyadh Zone 1", "Riyadh Zone 2". Read through a page-reading tool, because the page blocks scripted downloads. |
| **A-S8.** The "no list" claim for four gateways rests on page indexes. | **Applied**, with the scope of the search stated. Added Checkout.com's IP-addresses page, which lists only its own addresses. | The three llms.txt files are 128 to 265 title lines with no address topic; each llms-full.txt returns 404. Web searches found nothing contrary. |
| **A-S9.** "No formal SLA" too strong; review suggested "we found no published SLA terms". | **Rejected in part.** QuotaGuard does publish SLA terms, and they exclude our plan, so "no SLA on Starter" was right. The text now says so precisely and cites the SLA page. | SLA page: available on "Enterprise plans and above purchased directly from QuotaGuard… It does not apply to other plans". llms.txt: "Uptime: 99.95%, matching the SLA commitment". |
| **A-S10.** Alibaba price overstated. | **Applied, figures adjusted:** the address fee waiver and $0.097 a GB are confirmed, but no Riyadh disk price was found, so the text says "about $5, plus a disk (not priced)" rather than the review's "$5 to $7". The ranges follow: $5 to $13 a server, $11 to $26 for two. | Alibaba EIP page (updated 26 Oct 2026): the retention fee "is waived" for addresses "directly bound to VPC-type ECS instances" when the account's quota "is 2,000 or less"; Riyadh traffic 0.097, retention 0.008. Tracker: Riyadh $0.0072 an hour, 0 GB storage included. |
| **B-S2.** §1 leaned on Checkout.com and missed Moyasar naming HungerStation. | **Applied** in §1, the HungerStation row and §3. | Moyasar platforms page: "Authorization & Capture (including post-delivery capture) like Jahez or Hungerstation do." Careem: "one of its Payment Service Providers". |
| **B-S4.** The comparison table left out shared addresses. | **Applied:** new row, a "Why shared addresses matter" paragraph, and §6 item 11. | Price page: "Shield Starter, Shield Production, and Shield Business use shared static IP pairs". Fixie's price page: "a dedicated static IP". |
| **B-S5.** Costs compared against $29 only. | **Applied, with numbers recomputed** from A-S10 and A-N5: Saudi $11 to $26 for two ($3 to $18 under Starter, $33 to $48 under Production); Frankfurt $8 to $14 ($15 to $21 and $45 to $51). Plan changes keep the addresses. | QuotaGuard price page: "Upgrading or downgrading your plan does not change your assigned IP addresses". |
| **B-S6.** Upkeep and single point of failure judged more kindly for the managed option. | **Applied** in the Upkeep and Reliability rows and the Fallback paragraph, which now separates a fallback purchase from a standby. | Price page: "permanently reserved IPs that persist through maintenance and failovers"; every Shield plan includes "High availability and automated failover". Fixie Cruiser $19. |
| **B-S7.** Material options missing. | **Applied** as "Also considered", and the §3 heading now says the fixes differ. Two adjustments: Fly.io's $3.60 is per address, with the machine extra; and Supabase's own third suggestion, running its Edge Runtime ourselves, is added from the page already cited. The Google link now points to where it lands (Cloud Run networking best practices). | Vercel: "$100/month per project for Pro plus Private Data Transfer"; "shared across a small group of customers in the same region". Google: "route traffic through Cloud NAT with dedicated static outbound IP addresses". Fly.io: "$3.60/mo", "persist across Machine destruction and deployments". |
| **B-S8.** "A relay stores nothing" contradicted the table. | **Applied** in §4. | QuotaGuard FAQ: logs "account identifier, source IP, destination host and port, proxy identifier, timestamp, status code, method, proxy type, byte counts"; "time-to-live target of sixty (60) days". |
| **B-S9.** Ask Moyasar before the live list is saved. | **Applied** as its own step in §5. The review's supporting reference to an owner note in the repository was not needed and was not used. | Moyasar's page names no platform or proxy; Salla's guide asks for the `sk_live_` key and says nothing about addresses. |
| **A-N1** "existing" accounts; **A-N2** Implementing Regulation; **A-N4** Zid wording; **A-N7** Tamara wording; **A-N8** Moyasar's NAT line; **A-N9** SunRay; **A-N10** Ninja; **A-N11** "a cloud the company is documented to use"; **A-N12** Careem; **A-N13** Alibaba purchase by card. | **Applied** as suggested. A-N2 also adds Reed Smith's sixty-day entry-into-force and that the outcome is unknown. A-N9 now mentions the abandoned relay. | Each checked on its page: Moyasar ("Some existing live accounts"; "requests leave through a NAT gateway"), Reed Smith ("draft amendments to the Implementing Regulation"), Zid ("مزود خدمة الدفع (ماي فاتورة)"), Tamara checklist, SunRay README ("A relay … was used to dodge the whitelist"), HungerStation's policy (Google and AWS). |
| **A-N3.** The stc link is general business terms. | **Applied.** | stc terms: "a copy of its commercial registration, license, entity ID or official letter"; "cloud" appears only in the site menu. |
| **A-N5.** "$4 to $8" not supported. | **Applied** as "$4 to $7", from the two cited pages, rather than adding an EC2 source. | DigitalOcean $4 (512 MiB) and $6 (1 GiB); Lightsail $5 (0.5 GB) and $7 (1 GB). |
| **A-N6.** "Tencent Cloud" should be "Tencent". | **Not adopted as worded.** Three of the 22 blocks are registered under the name "TencentCloud", so "Tencent Cloud" is supported; the row now states the registry evidence exactly. | APNIC: 119.28.140.253, 49.51.164.88 and 49.51.172.32 are "TencentCloud"; the other 19 are "ACEVILLEPTELTD-SG" with qcloud_net_duty@tencent.com. Counts re-checked: 13 DE, 7 HK, 2 US. All 22 are announced by AS132203 (RIPEstat network-info). |
| **A-N14.** Oracle paid figure re-derives to about $21; free servers must be in the home region. | **Applied:** home-region rule added; paid figure now "about $21 to $23", labelled as our arithmetic. | Oracle price list: E4 $0.025 per OCPU-hour, memory $0.0015 per GB-hour, block volume $0.0255 per GB-month. Free tier page: "You must create the Always Free compute instances in your home region". |
| **B-N1** §1 last sentence; **B-N2** Fixie location; **B-N3** pinning the functions to Frankfurt; **B-N4** "two public projects". | **Applied.** B-N3 also notes that Supabase has no Middle East region, which slightly favours Frankfurt over Riyadh. | Supabase regional invocation: `x-region` or `forceFunctionRegion`; pinned requests "will NOT be automatically re-routed"; no Middle East region listed. |

**Beyond the reviews.** Re-reading the sources turned up three things that are
now in the text: Checkout.com publishes its own API and webhook addresses for
merchants' firewalls (§3); Supabase's troubleshooting page offers a third fix,
self-hosting its Edge Runtime (§3, §5); and two cited pages now redirect, so
the links point to where they land (Google's page in §3, now Cloud Run's
networking best practices, and QuotaGuard's privacy FAQ). No finding changed
the recommendation: QuotaGuard Shield in Frankfurt, with Fixie as the fallback,
on upkeep grounds.
