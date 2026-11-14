# Fact-check of the static-IP proxy comparison, 2026-11-13

> **Point-in-time evidence, kept for provenance.** An independent check of an
> earlier version of the static-IP proxy comparison (`docs/integrations/Moyasar_Static_IP_Proxy.md`), made on 2026-11-13 against the
> code, the live database (read-only) and the cited pages. Line numbers such as
> "Draft L234" refer to that earlier version, not to the file as merged. Every
> finding is answered in the draft's Review log: what was changed, and why where a
> finding was not applied as written. Read the draft for the current text.

Adversarial check of docs/integrations/Moyasar_Static_IP_Proxy.md (pricing and capability), against vendor pages read 2026-11-13. I did not edit the file. No writes, deploys, git actions or secrets. Raw page captures were kept locally, not in the repository

## BLOCKING
None. Every price, port, IP count, region and CONNECT/TLS claim that the recommendation rests on holds. The errors below are in the risk framing, the "not verified" list and the ruled-out reasons.

## SHOULD-FIX

**S1. Fixie's hard quota stop and QuotaGuard's soft limits are both missing** (table line 39, fallback lines 119-125, §4 table line 256)
- Claim: Fixie "has the same essentials"; its main risk is location, sharing and SLA.
- Evidence:
  - The Heroku Dev Center article, which Fixie operates (devcenter.heroku.com/articles/fixie), says: "When you reach 100% utilization, Fixie will send another notification via email and requests will fail with status code 407". The 75% mark only sends a warning.
  - Fixie's terms §8: "Aggregate usage data is used to enforce Fixie plan limits."
  - QuotaGuard's pricing FAQ: "We use soft limits so a brief spike does not automatically break production traffic… Soft limits are a courtesy for unexpected spikes, not a way to run sustained traffic above the paid plan."
- Correction:
  - Add to Fixie's risks: going over 25,000 requests or 10 GB stops every Moyasar call until the month resets or the plan is upgraded.
  - In our code, a 407 on CONNECT surfaces as "Could not reach Moyasar". Add "over quota" as a fourth cause in the §4 table.
  - List soft limits as a reason for QuotaGuard.

**S2. The sharing risk is framed as QuotaGuard-only, and the evidence is stronger than "pages disagree"** (lines 39, 104-110, Not verified #1)
- QuotaGuard's own pages, saying shared:
  - Pricing FAQ: "Starter, Production, and Business plans use shared static IP pairs and shared proxy resources."
  - Fixie comparison post: sub-Enterprise pairs are "stable for the customer but shared with a small group of other QuotaGuard customers".
  - Dedicated-IP page: turning on dedicated "necessitates a change in your static IP addresses".
- QuotaGuard's own pages, saying not shared: llms.txt ("dedicated pair … per subscription"), the Static product page ("Your IPs are yours alone, with no sharing") and the Shield page ("your dedicated IPs").
- Fixie: its pricing page says "a dedicated static IP". QuotaGuard (a competitor) says "Fixie has shared static IPs at every tier. There is no dedicated IP option at any price point." Fixie's docs say nothing either way.
- Correction:
  - Treat QuotaGuard Starter as shared unless QuotaGuard confirms otherwise in writing.
  - Treat Fixie's pair as probably shared too.
  - Only QuotaGuard sells a dedicated option (Enterprise).

**S3. Not verified #2 is wrong: the "change only if you ask" wording IS on a page the draft cites** (lines 423-426, and line 52)
- QuotaGuard pricing page, visible FAQ: "Will my static IPs ever change? No, unless you ask us to. In over 12 years of operation, we have never forced an IP change." Also: "Upgrading or downgrading your plan does not change your assigned IP addresses."
- QuotaGuard's register-account page: "Changing plans does not affect your Static IP's".
- Fixie's Supabase guide: "Your pair of Fixie IP-addresses. These will never change…" and "Changing the plan won't affect your outbound IP address".
- Correction:
  - Narrow #2 to cancellation and trial-to-paid, which are still unstated.
  - Line 52 should say the IPs themselves survive a plan change, not only "the proxy address format".
  - Note that QuotaGuard's dedicated (Enterprise) upgrade does change the IPs.

**S4. "Neither vendor publishes a separate SLA document" is false for QuotaGuard** (lines 431-433)
- quotaguard.com/docs/support/service-level-agreement (modified 2026-10-10) gives:
  - 99.95% of monthly minutes, with credits of 10%, 25% or 50%;
  - it applies only to "Enterprise plans and above purchased directly", and "does not apply to other plans, or to free, trial, or evaluation accounts".
- Correction: Starter has no SLA, and the $269 Shield Enterprise tier brings the contractual SLA as well as dedicated IPs.
- Also:
  - QuotaGuard's two uptime figures (99.95% and 99.98%) appear on the same pricing page. They are not a difference between pages.
  - Fixie's 99.98% is also on its Vercel Marketplace listing, and the Fixie-operated Heroku Dev Center article claims ">99.99%" availability. So "only on its Heroku listing" is wrong.
  - Fixie's terms disclaim any guarantee: "We do not guarantee continuous, uninterrupted or secure access".

**S5. Not verified #3 contradicts the draft's own source list** (line 428 against lines 332-334)
- QuotaGuard's register-account page: Step Five "Add your payment details for Stripe", then "Start Trial".
- Correction: a QuotaGuard trial needs card details. Only Fixie's free-plan card requirement is still unverified.

**S6. "No managed proxy service offers Saudi Arabia or the Gulf" (line 54) is overbroad**
- Oxylabs' dedicated datacenter page lists "Saudi Arabia Dedicated, Shared (pay per IP), Shared (pay per GB) 10k IPs" and "United Arab Emirates Dedicated, … 13k IPs".
- Correction: "Neither QuotaGuard (12 AWS regions, none in the Middle East) nor Fixie offers a Gulf location." Supabase also has no Middle East function region, which supports Frankfurt.

**S7. Two ruled-out reasons are not correct** (lines 72-74 and 81)
- Scraping sellers: "Each sells one bare address" is false.
  - Oxylabs has a "Dedicated Datacenter Proxies $2/IP Up to 2 IPs" tier, IPRoyal prices per proxy, and Decodo prices "From $2.50/IP".
  - The real point: there is no load-balanced pair behind one host name, and our code takes a single `MOYASAR_PROXY_URL`, so a second IP gives no failover.
- Fly.io: "Nobody has shown that it can accept proxy connections" is not a reason.
  - Fly sells app-scoped static egress IPs: "a pair of static egress addresses, IPv4 and IPv6, for your app in a region", "$3.60/mo", and they "persist across Machine destruction and deployments".
  - It is a host for the own-server option. Rule it out for the same reason as that option (we would build and run it).

**S8. The key security quote drops a qualifier** (lines 92-93)
- The draft quotes "are not visible to the proxy". QuotaGuard's privacy FAQ ends "…are not visible to the proxy in ordinary operation". It likewise says it does not decrypt "in ordinary operation".
- Correction: quote it in full. The hard guarantee comes from CONNECT plus our runtime checking api.moyasar.com's certificate, not from the vendor's wording.

## NITS
- **N1. Bandwidth caps are omitted.** QuotaGuard Starter and Shield Starter: 10 GB. Fixie Cruiser: 10 GB. Fixie free: 100 MB. These do not matter at our volume.
- **N2. Fixie's log retention conflicts across its own pages.** The features page says "months of logs". The security page and terms §8.4 say 7 days ("expired … within 7 days of creation"). The terms back the draft.
- **N3. Fixie's location is not "not stated".** Its features page says "Fixie operates in the same data center as Heroku's US region", and its subprocessor list names AWS "USA, Ireland". Expect US-East, with Ireland at best. Keep the question for Fixie.
- **N4. Fixie also publishes a Supabase guide** (usefixie.com/documentation/static-ip/deno/supabase/api, `Deno.createHttpClient({ proxy: { url } })`). QuotaGuard's is closer to our code (credentials split into `basicAuth`) and is the only one with a version claim, so §2 reason 2 should be softened rather than presented as unique.
- **N5. §2 reason 2 needs §4's hedge.** "Verified on v1.73.x" sits under QuotaGuard's "Deno.createHttpClient Not Available" troubleshooting heading, and the same page says local runs "do not confirm behavior on the hosted runtime".
- **N6. The QuotaGuard trial can be extended.** Its register-account page says to email support "so we can push that date out for you". Worth mentioning next to "3 days" (line 188).
- **N7. The NAT Gateway citation does not show $38.** aws.amazon.com/vpc/pricing only shows US East (Ohio) at $0.045/h (about $33 a month). The $38 figure is Frankfurt's $0.052/h from elsewhere. Add the NAT's own public IPv4 at $0.005/h and per-GB processing.
- **N8. Function region can be pinned.** Supabase allows `x-region` or `?forceFunctionRegion=` to run payment functions in eu-central-1, next to a Frankfurt proxy. This is relevant to lines 57-60.
- **N9. QuotaGuard quotes Shield Enterprise at two prices.** Its comparison post says $259; the pricing page says $269. The draft's $269 matches the authoritative pricing page.
- **N10. The own-server row understates what it needs.** The proxy needs a DNS name, because our code checks the certificate against the host name. Squid needs a `--with-openssl` or `--with-gnutls` build, and `https_port` is "not available in the v8 version of Squid".
- **N11. Static's plain hop exposes more than the password.** It also exposes the CONNECT destination host and port. QuotaGuard's guide notes that Shield "encrypts proxy credentials and destination host:port on the wire".

## CONFIRMED (no change needed)
**QuotaGuard**
- Static Starter: $19, 20,000 requests.
- Shield Starter: $29, 20,000 requests.
- 3-day trial (7-day on Enterprise). Enterprise: $219 Static, $269 Shield.
- Ports: Shield `https` 9294, Static `http` 9293, SOCKS5 1080. Static has no TLS endpoint (non-Shield HTTPS was deprecated).
- CONNECT is stated in writing for both products.
- Logs kept about 60 days, including byte counts. Data may leave the EU. A DPA needs a signed agreement.
- Frankfurt is offered (EU-Central-1; status nodes `eu-central-shield-01` and `eu-central-static-01`). Region is chosen at signup.

**Fixie**
- Cruiser $19 / 25,000 requests; Commuter $5 / 2,500; free plan 500.
- TLS on 443, HTTP proxies only. Use the host name for the certificate.
- "no ability to inspect or alter". Two IPs per proxy group.
- SOC 2 Type 1 and Type 2.

**Own server and other platforms**
- DigitalOcean $4 droplet. Reserved IP is free while assigned ($5 a month when not).
- Lightsail $5, static IP free while attached.
- AWS IPv4 $0.005/h. t4g.nano $0.0048/h in Frankfurt. EC2 single-instance SLA 99.5%.
- Cloudflare dedicated egress is Enterprise add-on only, with no username/password sign-in.
- Supabase Dedicated IPv4 is inbound only. Only ports 25 and 587 are blocked. Functions run in the region closest to the caller. Supabase recommends an outbound proxy.

**Supabase runtime source**
- `createHttpClient` is absent at v1.68.0 and present at v1.69.0 and v1.77.9.
- `proxy.rs` at v1.77.9 handles `http`, `https` and `socks5`, basic auth and CONNECT.

**Moyasar**
- All of §5 matches the page (updated Nov 11, 2026), including "Each block counts toward the 100 entries".
- `api.moyasar.com` resolves to A records 104.18.24.246 and 104.18.25.246, with no AAAA record.

**Our code**
- It accepts only `http` and `https` proxy URLs and drops the path.
- The per-order call count matches the code. Extra invoice lookups happen only on a reused attempt that has no invoice, or after a network error on create.

## VERDICT
The recommendation (QuotaGuard Shield Starter, Frankfurt, $29) holds, and the corrected facts strengthen it:
- QuotaGuard has soft limits; Fixie stops at quota with 407.
- Both vendors document that their IPs don't change.
- QuotaGuard's SLA exists but only on Enterprise.
- Both vendors' entry tiers are probably shared.

Not ready to send as-is. Fix S1-S8, especially S1 and S3, before the owner relies on it. The nits are optional.