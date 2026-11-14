# Moyasar static-IP proxy: comparison and recommendation (draft)

> **Status: DRAFT, engineering-written 2026-11-13, for the owner.** Nothing has
> been bought, configured or changed. Prices and features were read from the
> vendors' own pages on 2026-11-13 and can change, so re-check the price on the
> day you buy. Later the same day, an adversarial check of the prices and
> capabilities found mistakes in how the risks were described. They are
> corrected below, and the Review log at the end lists each one. A second
> check, of compatibility and security, found that the TEST-mode proof in §3
> could leave the working TEST setup broken, with no known way back. The steps
> now run in a safer order, and the Review log lists that change too. A final
> review on 2026-11-14 corrected what this draft said about cash orders during
> an outage, the load a stuck refund adds, QuotaGuard's soft limits and which
> Allowed IPs list to change. The Review log lists each correction.
>
> **First, before starting any trial:** send the two emails in §7, to QuotaGuard
> and to Moyasar, and wait for the replies (§3 step 1).
>
> **Your decision:** which service to use (§2). This is `OWNER_ACTIONS.md` §47.10.
> The steps after it (§47.11 to §47.13) each need their own approval under
> CLAUDE.md §5.

**Why we need this.** In live mode, Moyasar accepts calls made with our secret
key only from internet addresses we list in its dashboard (Allowed IPs). Our
payment code runs on Supabase, which has no fixed address. The calls therefore
have to leave through a **proxy**, a relay service with fixed addresses. The
code is already built for this. It needs one setting, `MOYASAR_PROXY_URL`, and
the proxy's addresses on Moyasar's list.

Two terms used below:

- **Encrypted link to the proxy** (an `https://` proxy address) protects the
  proxy's own password, and the name of the service we are calling, on their way
  to the proxy.
- **Tunnel** (the technical name is CONNECT): the proxy passes our encrypted
  traffic along without being able to read it. It never sees our Moyasar secret
  key or anything else we send to Moyasar. All four options below work this way.

---

## 1. The options that work with our setup

| | **QuotaGuard Shield** (Starter plan) | **Fixie** (Cruiser plan) | **QuotaGuard Static** (Starter plan) | **Our own small server** |
|---|---|---|---|---|
| Cost a month | **$29**: 20,000 requests and 10 GB of data. 3-day free trial (card details needed) | **$19**: 25,000 requests and 10 GB. A free plan covers 500 requests and 100 MB | **$19**: 20,000 requests and 10 GB | **$4 to $8** per server (DigitalOcean $4, AWS Lightsail $5, AWS EC2 about $8), about double with a standby |
| Fixed addresses | 2, used in turn | 2, used in turn | 2, used in turn | 1 per server |
| Addresses ours alone? | **No.** The price page says "Shared static IP pair". A private pair needs Enterprise ($269) | **Unclear.** Fixie says "a dedicated static IP"; QuotaGuard, a competitor, says Fixie's are shared. Ask | **No**, as for Shield | Yes |
| Over the monthly limit | Calls keep working through a brief spike ("soft limits"). Sustained use above the plan means an upgrade, and QuotaGuard gets in touch | **Every call fails** until you upgrade or the month resets | As for Shield | No request limit |
| Uptime guarantee (SLA) | None. QuotaGuard's covers Enterprise only | None. Its terms disclaim one | None, as for Shield | AWS: 99.5% for one EC2 server. Others not checked |
| Encrypted link to the proxy | Yes (port 9294) | Yes (port 443) | **No**: `http://` only (port 9293) | Yes, once we install a free certificate, which needs a domain name |
| Tunnel, so the proxy cannot read our key | Yes, in writing | Yes, in writing | Yes, in writing | Yes, if we set it up that way |
| Location | Frankfurt | Not stated for a direct account; its pages point to the US. Ask | Frankfurt | Frankfurt |
| Setup effort | Low. QuotaGuard publishes a Supabase guide whose code has the same shape as ours | Low. Fixie also publishes a Supabase guide | Low | Medium: about half a day to build (a domain name, a certificate, and proxy software built with encryption support), then 1 to 2 hours a month |
| Main risk | Shared addresses, and no uptime guarantee at this price. Connection records are kept about 60 days | The hard monthly limit. Location and sharing not confirmed | The proxy's password, and the name of the service we call, cross the internet unencrypted on every call | One server is a single point of failure. Updates and certificate renewals fall on us |

**Sizing: the app has not launched, so there is no customer volume yet.** The
Production `orders` table holds only development test orders: 82 since 8 July,
from 7 team accounts, none paid with real money (the three in the last 30 days
are 0.00 SAR test orders from one account). So size the plan from the volume
you EXPECT. Measured from our code, one card order costs about **3 to 6 Moyasar
calls**: one to create the invoice, about one per payment check (when the
customer returns to the app, reopens the screen or taps "check again"; the app
does not poll), about one per Moyasar notification for that payment, and two
more only if it is refunded. At 6 calls an order, a 20,000-request plan covers
about **3,300 card orders a month, about 110 a day**; at 10 (a deliberately safe
figure) about 2,000 a month. If you expect more, the next tier up is the answer
(for Shield: Production, $59 a month for 100,000 requests). Both vendors say a
plan change keeps the same two addresses, so Moyasar's list would not need
touching. The one exception is QuotaGuard's private pair (Enterprise), which
comes with new addresses. With Fixie, leave more room than with QuotaGuard,
because Fixie says calls fail once its limit is reached (§2). The 10 GB of data
is not a constraint: each call moves a few kilobytes, so even 20,000 calls come
to well under 1 GB (an estimate).

**Until gap PG-01 is fixed, one stuck refund can use more than the whole plan.**
A refund that gets no clear answer from Moyasar (Moyasar refusing our address,
a proxy or network error, or an error on Moyasar's side) stays pending and is
tried again 5 times in every run of the refund job. The job runs every 5
minutes once §47.16 turns it on. Each try is at least one call to Moyasar: at
least 1,440 calls a day, about 43,000 a month, more than twice the Starter
plan's 20,000. Neither vendor says whether calls that share one connection
count as one request, so the vendor's count may be lower; plan for the higher
figure. With Fixie, reaching the limit stops every card payment, payment check
and refund until the month resets or you upgrade. With QuotaGuard, this is
sustained use, which its soft limits do not cover (§2), so expect QuotaGuard to
ask you to upgrade. Whichever you choose, send the vendor's usage alerts to an
inbox someone reads (gap PG-19).

**Location.** Neither QuotaGuard (12 AWS regions, none in the Middle East) nor
Fixie (its pages point to the US) offers a Gulf location. Some scraping-proxy
sellers do sell Saudi and UAE addresses (Oxylabs lists both), but they are ruled
out below for other reasons, and Supabase has no Middle East region for its
functions either. Moyasar does not need a Saudi address, and it accepts any
public one. Frankfurt is the sensible choice: our database is there, and the
city is central. Supabase runs each call close to whoever triggered it. In the
last 24 hours, our payment functions ran in Mumbai, Zurich and N. Virginia.
Whichever city you pick, some calls will therefore travel to it. Each Moyasar
call is allowed 12 to 15 seconds, and the detour should add about a second at
most (an estimate). If that ever matters, Supabase lets a caller ask for a
region (an `x-region` header, or a `forceFunctionRegion` setting in the
address), so engineering could run the payment functions in Frankfurt, next to
the proxy. The cost is that Supabase does not re-route a pinned call when that
region has an outage. It is not needed to start.

**Whatever you choose:** if the proxy is down, card checkout cannot start, and
payment checks and refunds wait until it is back. With Fixie, the same happens
when the month's limit is used up. **Cash orders are affected on some phones**
(gap PG-04). A phone whose card payment page was opened and left unpaid cannot
place any order, cash included, until that payment expires, 30 minutes after it
was opened. If the proxy or Moyasar cannot be reached when that time is up, the
lock lasts until our server can reach Moyasar again. A phone that tries to pay
by card while the proxy or Moyasar cannot be reached (or, with Fixie, while it
is over its limit) cannot place a cash order either, for up to 30 minutes,
until its checkout session expires. Other phones can still order in cash.

**Ruled out** (sources in §6):

- **Anything that offers only a `socks5://` address**, such as Fixie Socks or
  QuotaGuard's port 1080. Our code accepts only `http://` or `https://`, so
  every Moyasar call would be refused, TEST included.
- **Supabase's "Dedicated IPv4" add-on.** It fixes the address for incoming
  traffic only, not for our outgoing calls.
- **Proxy sellers built for web scraping** (IPRoyal, Bright Data, Decodo,
  Oxylabs). They sell addresses priced one by one, and none of the pages we read
  promises in writing that the proxy cannot read the traffic. For some of its
  products, Bright Data asks customers to install its own certificate, which
  would let it read the traffic.
- **Cloudflare dedicated egress.** It comes only with an enterprise contract, and
  it cannot sign us in with a username and password.
- **AWS NAT Gateway.** In Frankfurt it costs about $38 a month ($0.052 an hour),
  plus $0.052 for each GB it handles and $0.005 an hour for its public address,
  and it still needs a proxy server.
- **Fly.io.** It sells fixed outgoing addresses for an app ($3.60 a month each,
  kept across redeploys), so it could host a proxy of our own. That makes it a
  version of "our own small server", with the same work: we would build and run
  it.

---

## 2. Recommendation

**Take QuotaGuard Shield, Starter plan, in Frankfurt, for $29 a month.**

Why:

1. **It is the only option that meets every requirement in writing.** The link to
   the proxy is encrypted. QuotaGuard says that inside the tunnel, headers,
   authorization headers and bodies "are not visible to the proxy in ordinary
   operation". The real protection does not rest on that wording: our server
   encrypts all the way to Moyasar and checks Moyasar's certificate, so the proxy
   only passes along traffic it cannot decrypt. It also has two fixed addresses
   and a Frankfurt location.
2. **A brief spike does not cut card payments off.** QuotaGuard uses "soft
   limits so a brief spike does not automatically break production traffic",
   and contacts you about upgrading if usage "materially exceeds the plan
   limits". It adds that soft limits are "a courtesy for unexpected spikes, not
   a way to run sustained traffic above the paid plan", so choose the plan for
   the volume you expect to sustain. Fixie, the fallback, says calls fail once
   its limit is reached.
3. **Its Supabase guide is the closest to our code.** It uses the same code shape
   our server already has, and says it was "verified on v1.73.x with HTTP,
   SOCKS5, and HTTPS proxies". That is a vendor claim, made under a
   troubleshooting heading, and the same page warns that local runs "do not
   confirm behavior on the hosted runtime" (§4). Fixie publishes a Supabase
   guide too, without a version claim.
4. **Its 20,000 requests a month cover roughly 2,000 to 3,300 card orders a month** (see Sizing in §1), as long as no refund is stuck (gap PG-01); check that against the volume you expect at launch.
5. **You can prove it before you pay**, during the 3-day free trial (§4). Sign-up
   asks for card details before the trial starts, and QuotaGuard's support will
   extend the trial if you ask.

What you accept:

- **It costs $10 a month more than Fixie.**
- **Other QuotaGuard customers share the two addresses.** QuotaGuard's price page
  lists Starter as a "Shared static IP pair", and a QuotaGuard blog post says
  pairs below Enterprise are "shared with a small group of other QuotaGuard
  customers". One QuotaGuard page (llms.txt) says each subscription gets "a
  dedicated pair", so ask which applies to us, but plan on shared. Sharing would
  not let anyone use our Moyasar account, because every call still needs our
  secret key. It would weaken the address list as a second lock if that key ever
  leaked. A guaranteed private pair costs $269 a month (Shield Enterprise), which
  is not worth it at our volume. Moving to it later changes the addresses, so the
  new ones would go on Moyasar's lists first, as in §5.
- **A shared pair also shares its outages.** If Moyasar, or Cloudflare in front
  of its API, limits requests per address, the limit is shared with the other
  customers on the pair. So is a block caused by another customer's traffic.
  Moyasar documents a 429 answer ("Too many requests hit the API too quickly")
  but not whether it counts per key or per address. Only a private pair, or our
  own server, avoids this.
- **No uptime guarantee.** QuotaGuard's service-level agreement (99.95% of each
  month, with credits) covers only Enterprise plans bought directly. It "does not
  apply to other plans, or to free, trial, or evaluation accounts". Fixie
  publishes none, and its terms disclaim any guarantee.
- **QuotaGuard keeps connection records for about 60 days.** These records show
  our server's address, `api.moyasar.com`, the times and the sizes, but never the
  content. QuotaGuard says the data may leave the EU even with an EU location.
  Getting a data processing agreement means signing one with QuotaGuard
  (support@quotaguard.com). Whether QuotaGuard goes into our PDPL records is a
  question for counsel. Card numbers never reach our server in any case, because
  customers type them on Moyasar's own page.

**Fallback: Fixie, Cruiser plan, $19 a month.** It has the same essentials: an
encrypted link on port 443, a tunnel it "has no ability to inspect or alter", and
two addresses. It also keeps records for less time (7 days, according to its
security page and its terms; its features page mentions "months of logs") and has
completed SOC 2 audits. **Its main drawback is a hard limit.** At 25,000 requests
or 10 GB in a month, Fixie's own article for Heroku customers says "requests will
fail with status code 407", so card payments would stop until the plan is
upgraded or the month resets. Choose a plan with room to spare. **Before buying,
ask Fixie two questions.** Can a direct account have its proxy in Frankfurt or
elsewhere in the EU? (Its pages point to the US.) Are the two addresses ours
alone? Switch to Fixie if QuotaGuard's trial fails for a reason specific to
QuotaGuard, or if QuotaGuard's answers do not satisfy you.

**Not recommended:**

- QuotaGuard Static. It costs the same as Fixie, but its proxy password, and the
  name of the service we call, cross the internet unencrypted.
- Our own server, unless you want to run a server.

---

## 3. What to get from the service, and the order of steps

### What to collect

**1. The proxy URL.** It has this shape:

```
https://USERNAME:PASSWORD@HOST:PORT
```

- QuotaGuard Shield: `https://USERNAME:PASSWORD@<region>-shield-01.quotaguard.com:9294`
- Fixie: `https://fixie:TOKEN@SUBDOMAIN.usefixie.com:443`

Copy the exact value from the vendor's dashboard. Our code applies these rules:

- **It must start with `https://`** (preferred) or `http://`. With any other
  start, such as `socks5://` or none at all, every Moyasar call fails before
  anything is sent, TEST included.
- **Keep the port.** Without one, `https://` means port 443, which is wrong for
  QuotaGuard (9294).
- **Use the vendor's host name, not an IP address.** With `https://`, the
  proxy's certificate is checked against that name.
- **Encode special characters.** A password containing `@ : / # ? %` or a space
  must be written encoded (`@` becomes `%40`). The vendor's ready-made URL
  usually is.
- **Anything after the port is ignored.**
- **The service must sign us in with the username and password in the URL,**
  not with a list of allowed source addresses, because Supabase's addresses
  change.

The URL contains the proxy's password. Type it only into the Supabase dashboard,
never into a chat or an email. Our code never logs it or shows it.

**2. Every outbound address.** Get both addresses of the pair from the vendor's
dashboard. Do not look up the proxy's host name to find them: that gives the way
in, not the way out. Moyasar's API has IPv4 addresses only today, so the IPv4
pair is what counts now. That could change (§5), so also ask whether the proxy's
outbound traffic is IPv4-only, and list any IPv6 outbound addresses it has as
well. List every address, because any call that leaves from an unlisted address
is refused.

**3. Answers in writing, before starting the trial.** The QuotaGuard email in §7
asks these. If you move to Fixie, ask Fixie the same before buying:

- What happens to the addresses if we cancel, or when the trial turns into a
  paid plan? (Both vendors already say the addresses never change otherwise,
  plan changes included.)
- Are the addresses ours alone?
- Can the proxy password be changed without changing the addresses? If the URL
  ever leaks, a new password should not mean new addresses on Moyasar's lists.
  With Fixie, leaked credentials could also use up the hard monthly limit and
  stop payments.
- Is the proxy's outbound traffic IPv4-only? If not, which IPv6 addresses can it
  leave from?
- QuotaGuard only: is Shield Starter suitable for a small live checkout? Its
  price page labels it "For compliance dev and test environments".
- Fixie only: can the proxy be in Frankfurt or elsewhere in the EU?

### The order of steps (`OWNER_ACTIONS.md` §47.10 to §47.13)

First finish §47.7 to §47.9 (the TEST keys, the TEST webhook and the sandbox
test) **without** a proxy. That way a proxy problem cannot be mistaken for a
sandbox problem. Then:

1. **§47.10, ask, then choose.**
   - **Send the two emails in §7 first, before starting any trial,** and wait
     for the replies. QuotaGuard's answer to its question 1 decides the plan
     (Starter or Production). Moyasar's answer to its question 1 decides whether
     shared addresses are acceptable at all. If they are not, the choice is a
     private pair (Shield Enterprise, $269 a month), Fixie if it confirms in
     writing that its addresses are ours alone, or our own server (§1).
   - **Then start the QuotaGuard Shield trial** on that plan, in the Frankfurt
     region, and collect the URL and both addresses. Sign-up asks for card
     details before the trial starts. The trial lasts 3 days, so start it on a
     day you can also do step 2. If you need longer, email QuotaGuard's support
     and ask them to extend it.
2. **§47.11, set the secret, and leave Moyasar's TEST list as it is.** In the
   Supabase dashboard, open Edge Functions → Secrets. Add the name
   `MOYASAR_PROXY_URL` (exactly that; `HTTPS_PROXY` does nothing) with the URL as
   its value. Run **Test connection** in our console's Moyasar panel. It should
   say "Moyasar accepted the test key. Connection OK." On its own, that shows
   only that Supabase accepted the proxy setting and that an answer came back
   from Moyasar. It does not show which address Moyasar saw, because TEST still
   accepts any address.
   - **Then check that the proxy really carried the call** (recommended; it
     changes nothing at Moyasar). Supabase cannot show the secret's value, so
     paste the URL from the vendor's dashboard into the secret's value
     again, change one letter or digit of the password there (the part between
     `USERNAME:` and `@`, but not a `%` or the two characters after one), and
     save. Run Test connection. It must now say "Could not reach Moyasar",
     because the proxy turned the wrong password down. If it says "…is not an
     http:// or https:// URL…" instead, the change hit a `%` code: start again
     with another character. Then save the correct value, pasted unchanged from
     the vendor's dashboard, and run Test connection once more: "Connection OK"
     again. Together, the two results show that the call goes through the
     proxy, that the proxy can be reached, that its certificate is accepted and
     that it accepted our sign-in. If the wrong password still gives
     "Connection OK", the call is going around the proxy: put the correct value
     back and tell engineering (describe the message; never paste the URL or
     its password).
   - **If both results are right, keep the subscription.** If not, see §4. To
     stop, delete the secret and cancel before the trial ends. The TEST list
     was never changed, so TEST works exactly as before.
3. **Extra check, optional, in TEST mode only, and only once you have decided to
   keep the service.** It proves the addresses before LIVE does, but it may not
   be reversible.
   - **First, know what it commits you to.** Moyasar's page does not say whether
     a restricted TEST list can be put back to "any address" (Not verified #6).
     That is question 3 of the email in §7 (also in §47.19). Do not change this
     list, or any Allowed IPs list, before Moyasar has answered questions 1 and
     3 in writing. If the answer to question 3 is not a clear yes, treat the
     change as permanent. From then on, every TEST call must leave from a
     listed address:
     Test connection, the sandbox checkout and its result, payment checks, and
     the payment lookup made for each Moyasar notification. A later change of
     vendor then means changing the TEST list too, and dropping the proxy would
     leave TEST refused unless the list can go back to "any address".
   - **Then do it.** In the Moyasar dashboard, in TEST mode, open Settings → API
     Keys and the Allowed IPs list under the test keys (read the heading above
     it). Choose *Specific addresses*, add both addresses and save. Run Test connection again. "Connection OK" now proves that Moyasar
     saw one of the listed addresses, and a sandbox checkout confirms it (see
     the note under the table in §4). "Moyasar refused the test key from the
     proxy…" means an address is missing (§4).
   - **Skipping it is fine.** The addresses are then proven at §47.13.
4. **§47.12, Moyasar's LIVE list, only after Moyasar's written answers to
   questions 1 and 3 in §7.** In Moyasar's dashboard, switch to **LIVE** mode
   first: §47.8 left it in test mode. Then open Settings → API Keys, where each
   environment has its own Allowed IPs list under its keys, and change only the
   list under the live keys: add both addresses, read the heading above the
   list, and save. Saving the
   LIVE list asks for a 6-digit code. If no code is asked for, you are on the
   TEST list: do not save anything more. Moyasar saves a TEST change at once,
   without a code, so that list may now be restricted: tell engineering, and
   see step 3 and Not verified #6. Once saved, the live list can never be
   emptied again. The live secret key becomes visible only after this.
5. **§47.13, go live in the console.**
   - Switch the Moyasar card to live.
   - Save the live secret key, the live publishable key and the live webhook
     token.
   - Register the live webhook in Moyasar, then enter its code within 30
     minutes.
   - Run **Test connection** (LIVE). "Connection OK" proves the whole route,
     with the caveat in the note under the table in §4.

Then carry on at §47.14. No customer can start a card payment in the app during
these steps, because the Online Payment switch is turned on only at §47.18. From
§47.13 step 1, though, TEST mode no longer blocks the older order-first path,
which a direct API call can still use for three cancelled July orders
(`OWNER_ACTIONS.md` §47.13).

---

## 4. Will Supabase honour the proxy?

**It is not proven yet.** The evidence says it will, and three Test connection
runs in TEST mode settle it (§3 step 2).

**What we know:**

- **Measured today.** All 6,144 Edge Function log lines from the last 24 hours,
  across 5 regions, ran on `supabase-edge-runtime-1.77.9 (compatible with Deno
  v2.1.4)`.
- **The source code of that version supports exactly what our code sends.** It
  gives functions `Deno.createHttpClient`. It handles an `http://` or `https://`
  proxy with a username and password, and it opens a tunnel to Moyasar. Our code
  comment says the feature arrived in version 1.68.0; the source shows 1.69.0,
  which is what our runbooks now say. Correcting the comment can wait, and it
  changes nothing, because we run 1.77.9.
- **QuotaGuard's claim.** Under a troubleshooting heading, QuotaGuard says it
  verified the same code "on v1.73.x with HTTP, SOCKS5, and HTTPS proxies". That
  is a vendor claim, and the same page warns that local runs "do not confirm
  behavior on the hosted runtime". Fixie's Supabase guide uses the same function,
  without a version claim.

**What only a real call proves:**

- that Supabase's network lets a function reach the proxy's host and port.
  Supabase documents blocking only ports 25 and 587;
- that the proxy's certificate is accepted;
- that nothing on Supabase's side sends the call around the proxy. A `NO_PROXY`
  setting on the server that runs our functions would do that silently, even
  with our proxy set (§6). That is unlikely, and the wrong-password check in §3
  step 2 catches it;
- which addresses Moyasar actually sees.

**The cheap proof, before you pay anything.** Do step 2 of §3, with its
wrong-password check, during QuotaGuard's free trial. Everything happens in TEST
mode, with no real money, no customer and no order, and Moyasar's TEST list is
not touched. QuotaGuard asks for card details to start the trial. If you would
rather not give them, Fixie's free plan ($0, 500 requests a month) proves the
Supabase side equally well, although whether Fixie asks for a card was not
checked. Leave the TEST list open while you do that, because step 3 belongs to
the service you keep. You would then repeat step 2 with the paid service's URL,
and do step 3, if you choose to, with the paid service's addresses.

**What each Test connection result means.** Where a row says to tell
engineering, describe the message you saw. Never paste the URL or its password
into a chat or an email.

| Result | Meaning | What to do |
|---|---|---|
| "Moyasar accepted the test key. Connection OK." | **With the TEST list restricted (§3 step 3): proven.** Only the proxy's addresses are listed, so the call came through the proxy, on Supabase's real runtime. **With the TEST list still open (§3 step 2):** Supabase accepted the proxy setting and Moyasar answered. Whether the proxy carried the call is shown by the wrong-password check in step 2; which address Moyasar saw is not shown at all. | Keep the plan. Once Moyasar has answered questions 1 and 3 of §7 in writing, do step 3 if you choose to, then go on to §47.12. |
| "MOYASAR_PROXY_URL is set, but this runtime cannot route a request through a proxy…" | Supabase lacks the feature. Nothing was sent. | Delete the secret, cancel the trial and tell engineering. If you had already restricted the TEST list (step 3), also put it back to "any address", if Moyasar allows it: with no working proxy, every TEST call is refused. |
| "…is not an http:// or https:// URL…" or "…could not be used as a proxy…" | The value is mistyped, or starts with something other than `https://` or `http://`. During the wrong-password check, it means the changed character was a `%` or one of the two after it. | Copy it again from the vendor's dashboard. |
| "Could not reach Moyasar. Please try again." | No answer came back from Moyasar. For example: the proxy cannot be reached, or its host name does not resolve; its password is wrong; its certificate failed; it turned the tunnel down for another reason; (with Fixie) the month's limit is used up, which Fixie reports the same way as a wrong password; the connection to Moyasar inside the tunnel failed; or no answer came within the 12-second limit. Our code cannot tell which. | Copy the URL again. If the result persists, look in the vendor's dashboard: its usage figures, and its request log if it shows status codes. Our own logs will not help: Test connection does not record this failure. The most engineering can tell is that a run lasting about 12 seconds hit the time limit. Recording the cause would be a code change, with its own approval. Trying Fixie's free plan tells a vendor problem from a Supabase one. If you give up on this proxy after restricting the TEST list (step 3), also swap in the next proxy's addresses, or put the list back to "any address" if Moyasar allows it. |
| "Moyasar refused the test key from the proxy…" | Moyasar received a call from an address that is not on the TEST list. Usually an address is missing. | Add every address. If both are already listed, tell engineering: the proxy may not be in use. |
| "Moyasar refused the test key from this server's IP address…" | The TEST list is restricted and the call went direct, because the secret is not set. In the order of §3 this should not appear. | Set the secret again (§3 step 2). If you have dropped the proxy for good, put the TEST list back to "any address", if Moyasar allows it (Not verified #6). |
| "The test key authenticated but is not permitted to read payments." | Moyasar's side answered 403 (forbidden). Our console reads that as a key without permission, but Cloudflare, in front of Moyasar's API, also answers 403 when it blocks an address, for example a shared proxy address blocked because of another customer's traffic. | Tell engineering, and ask the vendor whether its addresses are being blocked. |

**What "Connection OK" covers.** Our console shows it for any answer from
Moyasar other than 401 and 403. So a rare temporary error on Moyasar's side, such
as 429 (too many requests) or 503 (maintenance), also reads "Connection OK", and
so, in LIVE, would 405, which Moyasar's error list gives as "Entity not activated
to use live account". For a firmer answer in TEST mode, also run the sandbox
checkout (§47.9): it reports success only when Moyasar actually creates the test
invoice. In LIVE, the small live payment at §47.18 is the firmer answer.

**Once the TEST list is restricted (§3 step 3),** TEST calls work only from a
listed address, which with our code means only through the proxy. To change
vendor, add the new pair to the TEST list first, as for LIVE in §5. Dropping the
proxy altogether would need the TEST list put back to "any address", and Moyasar
does not say whether that is possible (Not verified #6).

---

## 5. Moyasar's Allowed IPs rules

These come from Moyasar's page, which was last updated on 11 November 2026.

- **Only the secret key is restricted.** The publishable key is not.
- **LIVE and TEST have separate lists.** Adding an address to one does not add it
  to the other.
- **LIVE needs at least one address.** The live secret key stays hidden, and
  cannot be regenerated, until one is listed. Once a live list is saved, live can
  never go back to "any address".
- **TEST works from any address** until you choose *Specific addresses*.
- **Saving the LIVE list asks for a 6-digit code.** It comes from your
  authenticator app, or by email if you do not use one, and the emailed code
  expires in 10 minutes. TEST changes need no code.
- **The limit is 100 entries per environment.** Moyasar accepts:
  - single IPv4 or IPv6 addresses;
  - address blocks no wider than /16 for IPv4 or /32 for IPv6;
  - start-to-end ranges, for IPv4 only. Each is saved as the blocks that cover
    it, and each block counts as one entry.
- **Private, loopback and link-local addresses are rejected**, for example
  `10.x`, `192.168.x` and `127.0.0.1`.
- **A refused call gets 401 "This IP Address is not whitelisted to do this
  operation".** A wrong key gets the same status, with a different message
  ("Invalid authorization credentials"), and our console reads the message to
  tell the two apart. The message does not say which address was refused. Our
  console names the proxy when `MOYASAR_PROXY_URL` is set and the server when it
  is not, so a call that went around the proxy would still be reported as coming
  from the proxy.
- **A saved list applies from the next request.**

In practice:

- **List both addresses of the pair in the LIVE list** (§47.12). Put them in
  the TEST list only if you choose §3 step 3, which is optional, comes after the
  proxy is proven, after you have decided to keep the service and after
  Moyasar's written answers to questions 1 and 3 in §7, and may not be
  reversible (Not verified #6).
- **IPv4 is what counts today.** On 2026-11-13, Google's and Cloudflare's
  resolvers both gave `api.moyasar.com` two IPv4 addresses and no IPv6 record.
  That can change without notice: the name is served by Cloudflare, where IPv6
  is a single setting, on by default. A proxy with IPv6 could then reach Moyasar
  over IPv6, from an address that is not listed, and be refused. So ask the
  vendor whether its outbound traffic is IPv4-only (§3), and list any IPv6
  outbound addresses too; Moyasar accepts them.
- **To change vendor later,** add the new addresses first, then switch
  `MOYASAR_PROXY_URL` and test, and only then remove the old addresses. The
  100-entry limit leaves room for both sets.
- **The list covers our calls to Moyasar.** Moyasar's notifications to us
  (webhooks) are checked with their secret token instead. Moyasar's page does not
  mention webhooks, so this point is our inference.

---

## 6. Sources, and what is not verified

Every source below was read on 2026-11-13. Those marked "researcher-read" were
read by one of the researchers and were not re-read for this draft. Where a page
now redirects, the address given is where it lands.

**QuotaGuard**

- https://www.quotaguard.com/products/pricing/ :
  - plans, prices, requests and data: Static Starter $19 and Shield Starter
    $29, each with 20,000 requests and 10 GB; Shield Production $59 with
    100,000; Enterprise $219 for Static and $269 for Shield, with a dedicated
    pair;
  - every plan below Enterprise marked "Shared static IP pair", and the FAQ
    "Starter, Production, and Business use shared static IP pairs";
  - Shield Starter's label, "For compliance dev and test environments";
  - "We use soft limits so a brief spike does not automatically break production
    traffic. If usage materially exceeds the plan limits, we will contact you
    about upgrading or right-sizing the account. Soft limits are a courtesy for
    unexpected spikes, not a way to run sustained traffic above the paid plan"
    (re-read 2026-11-14; the plan cards say the same);
  - "Will my static IPs ever change? … No, unless you ask us to", and "Upgrading
    or downgrading your plan does not change your assigned IP addresses";
  - the 3-day trial (7 days on Enterprise);
  - the 12 regions, which include EU-Central-1 (Frankfurt) and none in the Middle
    East;
  - both "historic uptime" figures, 99.95% and 99.98%, on this one page.
- https://www.quotaguard.com/docs/support/service-level-agreement : 99.95% of
  monthly minutes, with credits of 10%, 25% or 50%, for "Enterprise plans and
  above purchased directly from QuotaGuard". It "does not apply to other plans,
  or to free, trial, or evaluation accounts".
- https://www.quotaguard.com/products/quotaguard-shield/ : the encrypted link to
  the proxy; "neither Static nor Shield decrypts your payload"; a pair of
  addresses; Frankfurt.
- https://www.quotaguard.com/products/quotaguard-static/ : "Your IPs are yours
  alone, with no sharing", in its answer about dedicated addresses, which "are
  available for Enterprise plans and above".
- https://www.quotaguard.com/docs/platforms/supabase/edge-functions-integration/ :
  - the URL formats and ports: Shield `https` on 9294, Static `http` on 9293,
    SOCKS5 on 1080;
  - Shield "encrypts proxy credentials and destination host:port on the wire";
  - the `Deno.createHttpClient` code;
  - "verified on v1.73.x…", under the heading "Deno.createHttpClient Not
    Available";
  - local runs "do not confirm behavior on the hosted runtime";
  - the addresses are in the dashboard, and the host name should not be looked
    up to find them.
- https://www.quotaguard.com/privacy-security-gdpr-faqs : CONNECT; paths,
  headers, authorization headers and bodies "are not visible to the proxy in
  ordinary operation"; the fields it logs; a 60-day retention target; data may
  leave the EU; a DPA only by signed agreement.
- https://www.quotaguard.com/llms.txt : "Standard plans use shared proxy
  infrastructure with a dedicated pair of static IPs per subscription"; "Uptime:
  99.95%, matching the SLA commitment"; Static uses a "blind CONNECT tunnel".
- https://www.quotaguard.com/blog/quotaguard-vs-fixie-comparison (QuotaGuard's
  own post, June 2026, so a competitor's view of Fixie):
  - pairs below Enterprise are "stable for the customer but shared with a small
    group of other QuotaGuard customers";
  - "Fixie has shared static IPs at every tier";
  - "Credit card required" for the trial;
  - Shield Enterprise at "$259/month". The price page, which we follow, says
    $269.
- https://www.quotaguard.com/products/dedicated-ip : moving to a dedicated pair
  "necessitates a change in your static IP addresses".
- https://health.quotaguard.com/ : the Frankfurt nodes `eu-central-shield-01` and
  `eu-central-static-01`.
- https://www.quotaguard.com/docs/getting-started/register-account/ :
  - payment details ("Add your payment details for Stripe") are entered before
    "Start Trial";
  - the region is chosen at signup;
  - support will "push that date out" for a longer trial;
  - "Changing plans does not affect your Static IP's".

**Fixie**

- https://usefixie.com/pricing : the plans (free with 500 requests and 100 MB,
  Commuter $5 with 2,500, Cruiser $19 with 25,000 and 10 GB); "a dedicated static
  IP"; "Upgrade or downgrade anytime and keep your IP addresses".
- https://usefixie.com/documentation/http-and-https-requests :
  - `https://…:443`, and use the host name for the certificate;
  - CONNECT, and "no ability to inspect or alter";
  - with an `http://` proxy, "the CONNECT request itself, which includes the
    hostname you are connecting to and your proxy credentials, travels
    unencrypted";
  - two addresses per proxy group, used in turn;
  - TLS for HTTP proxies only.
- https://usefixie.com/security : connection logs kept 7 days; no content kept;
  SOC 2 Type 1 and Type 2.
- https://usefixie.com/terms :
  - §8.4 and §8.5: request metadata is "expired from Fixie's database within 7
    days of creation";
  - §8.5: "Aggregate usage data is used to enforce Fixie plan limits";
  - §19: "We do not guarantee continuous, uninterrupted or secure access to the
    Platform".
- https://usefixie.com/features : "Fixie operates in the same data center as
  Heroku's US region"; "months of logs".
- https://usefixie.com/subprocessors : Amazon Web Services, processing country
  "USA, Ireland".
- https://usefixie.com/documentation/supabase : "Your pair of Fixie IP-addresses.
  These will never change"; "Changing the plan won't affect your outbound IP
  address".
- https://usefixie.com/documentation/static-ip/deno/supabase/api : the
  `Deno.createHttpClient` code, with the whole URL passed as the proxy.
- https://devcenter.heroku.com/articles/fixie (Fixie's article for Heroku
  customers): "When you reach 100% utilization, Fixie will send another
  notification via email and requests will fail with status code 407"; ">99.99%"
  availability.
- https://elements.heroku.com/addons/fixie : "99.98% uptime"; Frankfurt is listed
  only for Heroku Private Spaces.
- https://vercel.com/marketplace/fixie : 99.98% uptime.

**Our own server**

- https://www.digitalocean.com/pricing/droplets : the $4 droplet.
- https://docs.digitalocean.com/products/networking/reserved-ips/details/pricing/
  (researcher-read): a Reserved IP is free while it is assigned.
- https://aws.amazon.com/lightsail/pricing/ : the $5 plan, with a static IP
  included.
- https://aws.amazon.com/vpc/pricing/ : a public IPv4 address costs $0.005 an
  hour.
- https://aws-pricing.com/t4g.nano.html (a third-party tracker, researcher-read):
  the t4g.nano instance costs about $0.0048 an hour.
- https://aws.amazon.com/compute/sla/ : a single EC2 instance has a 99.5% SLA.
- https://www.squid-cache.org/Doc/config/https_port/ : the Squid proxy can accept
  connections over `https://`, but only in a build made `--with-gnutls or
  --with-openssl`, and "This directive is not available in the v8 version of
  Squid".

**Supabase**

- https://supabase.com/docs/guides/troubleshooting/why-supabase-edge-functions-cannot-provide-static-egress-ips-for-whitelisting-3d78b0 :
  there is no static outbound address, and an outbound proxy is recommended.
- https://supabase.com/docs/guides/platform/ipv4-address : the Dedicated IPv4
  address is static for incoming traffic only.
- https://supabase.com/docs/guides/functions/limits : "Outgoing connections to
  ports `25` and `587` are not allowed", and no other outbound port is named.
- https://supabase.com/docs/guides/functions/secrets : "Your functions read a new
  secret immediately, so you don't need to redeploy", which is what lets the
  wrong-password check in §3 step 2 work.
- https://supabase.com/docs/guides/functions/regional-invocation :
  - a function runs in the region closest to whoever calls it;
  - a caller can pin a region with an `x-region` header or the
    `forceFunctionRegion` parameter, and a pinned call is "NOT automatically
    re-routed to another region" during an outage;
  - the regions list has none in the Middle East.
- The runtime source, at tag v1.77.9:
  - https://github.com/supabase/edge-runtime/blob/v1.77.9/ext/runtime/js/denoOverrides.js
    exposes `createHttpClient`;
  - https://github.com/supabase/edge-runtime/blob/v1.77.9/vendor/deno_fetch/proxy.rs
    handles the proxy and the tunnel. It then opens the encrypted connection to
    Moyasar's own host name, so Moyasar's certificate is checked. A proxy that
    answers the tunnel request with 407 (sign-in refused), or with anything but
    200, makes the call fail (lines 614-617). Before any proxy, ours included,
    it checks the server's own `NO_PROXY` setting (lines 395-400, read at line
    261);
  - https://github.com/supabase/edge-runtime/blob/v1.77.9/vendor/deno_fetch/lib.rs
    builds the proxies from the server's environment first and puts ours in
    front of them (lines 1060-1067);
  - https://github.com/supabase/edge-runtime/blob/v1.77.9/vendor/deno_fetch/26_fetch.js
    fails a timed-out request with the signal's reason, a `TimeoutError` (line
    426), and checks an outbound rate limit before sending (lines 398-416);
  - the feature is absent at
    https://github.com/supabase/edge-runtime/blob/v1.68.0/ext/core/js/denoOverrides.js
    and present at
    https://github.com/supabase/edge-runtime/blob/v1.69.0/ext/runtime/js/denoOverrides.js.
- Our project's Edge Function logs, read-only, for the 24 hours to 2026-11-13
  19:26 UTC: the runtime version, the regions, and where the payment functions
  ran.

**Moyasar**

- https://docs.moyasar.com/guides/dashboard/setting-up-your-ip-whitelist : every
  rule in §5. Re-read on 2026-11-13; it is dated "Last updated on Nov 11, 2026".
  For TEST it says only "Works from any IP address until you choose Specific
  addresses", and it says nothing about putting TEST back, removing every entry,
  or webhooks.
- https://docs.moyasar.com/api/errors : 401 "Invalid authorization credentials"
  for a bad key; 403 "credentials not enough to access resources"; 405 "Entity
  not activated to use live account"; 429 "Too many requests hit the API too
  quickly", without saying how it is counted; 503 for maintenance.
- DNS lookups through https://dns.google and Cloudflare's resolver on
  2026-11-13: `api.moyasar.com` resolves to `104.18.24.246` and `104.18.25.246`,
  with no IPv6 record, and its HTTPS record carries only an `ipv4hint`. The name
  servers are Cloudflare's.
- https://developers.cloudflare.com/network/ipv6-compatibility/ (about the
  network in front of Moyasar's API): IPv6 is on by default for a domain served
  through Cloudflare, and only an Enterprise zone can turn it off (Network →
  IPv6 Compatibility).

**Our code and data** (the default branch, read-only)

- `supabase/functions/_shared/moyasarHttp.ts`:
  - lines 60-80: the accepted URL shapes;
  - lines 116-143: the proxy client is created;
  - line 179: the request through the proxy;
  - lines 165-202: every Moyasar call goes through it, TEST included;
  - lines 99 and 190: its only log lines, for an unusable setting and for an
    Allowed IPs refusal.
- `supabase/functions/payment-test-config/index.ts`, lines 101-111 and 145-171:
  the Test connection messages. Any failure to reach Moyasar that is not a proxy
  setting error, a refused proxy sign-in included, becomes "Could not reach
  Moyasar. Please try again." (lines 109-111 and 169-170), and is not logged.
  The 12-second limit is line 160. Any answer other than 401 or 403 reads
  "Connection OK" (lines 162-168). Which address a refusal names depends only on
  whether `MOYASAR_PROXY_URL` is set (lines 101-106). The sandbox checkout
  reports success only with a created invoice (lines 256-274).
- `supabase/functions/_shared/moyasarVerify.ts`, line 75: a failed payment check
  logs only the error's type.
- A read-only read of the payment settings on 2026-11-13, yes-or-no values only,
  with no secret read out: Moyasar enabled in TEST mode, with an `sk_test_` key
  and a TEST webhook token, no live key, and online payment off. That is the
  working TEST setup that §3 leaves untouched until step 3.
- A read-only count of `public.orders` on 2026-11-13: 82 test orders from 7 team accounts, none paid with real money.
- The calls per card order, counted from `payment-initiate/index.ts:272` (create), `_shared/moyasarVerify.ts:534-560` (one invoice GET per check), `payment-webhook/index.ts:194` (one payment GET per notification) and `payment-refund/index.ts:180,235` (lookup and refund).

**Ruled-out options**

- IPRoyal, priced per proxy: https://iproyal.com/pricing/datacenter-proxies/
- Bright Data, including the certificate: its Residential, Web Unlocker API and
  SERP API products "require either KYC or SSL Certificate", KYC being an
  identity check: https://docs.brightdata.com/general/faqs
- Decodo, dedicated addresses "From $2.50/IP":
  https://decodo.com/proxies/datacenter-proxies/pricing
- Oxylabs, dedicated addresses from "$2/IP", with Saudi Arabia and the United
  Arab Emirates among its locations: https://oxylabs.io/products/datacenter-proxies
- Cloudflare (researcher-read):
  https://developers.cloudflare.com/cloudflare-one/policies/gateway/egress-policies/dedicated-egress-ips/
  and
  https://developers.cloudflare.com/cloudflare-one/networks/resolvers-and-proxies/proxy-endpoints/
- Fly.io: https://docs.fly.io/networking/egress-ips : "a pair of static egress
  addresses, IPv4 and IPv6, for your app in a region", "$3.60/mo" for each IPv4
  address, and they "persist across Machine destruction and deployments".
- AWS NAT Gateway: https://aws.amazon.com/vpc/pricing/ shows only a US East
  (Ohio) example, $0.045 an hour. The Frankfurt rate, $0.052 an hour and $0.052
  per GB processed, is from AWS's own price data, which that page's region
  selector reads:
  https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/ec2/USD/current/natgateway.json
  (published 2026-11-10).

### Not verified

1. **Whether the addresses are ours alone.** For QuotaGuard Starter, its price
   page (plan cards and FAQ) and a QuotaGuard blog post say shared, and its
   llms.txt says "a dedicated pair of static IPs per subscription". We plan on
   shared. For Fixie,
   its price page says "a dedicated static IP", QuotaGuard (a competitor) says
   Fixie's are shared at every tier, and Fixie's documentation says neither.
2. **Whether either vendor's addresses survive a cancellation, or a trial
   turning into a paid plan.** Both vendors say the addresses never change
   otherwise, including on a plan change.
3. **Sign-up terms:**
   - whether Fixie's free plan needs a card (QuotaGuard's trial does);
   - whether a direct Fixie account can be in Frankfurt or elsewhere in the EU.
     Its features page says it "operates in the same data center as Heroku's US
     region", and its subprocessor list names AWS in the "USA, Ireland".
4. **What happens at Fixie's limit for a direct account.** The 407 statement is
   in Fixie's article for Heroku customers. Its terms say usage data "is used to
   enforce Fixie plan limits" without saying how.
5. **That Supabase's hosted runtime honours the proxy**, until §3 step 2, with
   its wrong-password check, is done (§4).
6. **Whether Moyasar's TEST list can go back to "any address"** once it is
   restricted, or what removing every address from it does. The page says LIVE
   cannot, and says nothing about TEST or about webhooks. That is why §3 sets
   the secret while TEST is still open, and leaves restricting TEST to an
   optional last step, after you have decided to keep the service and Moyasar
   has answered questions 1 and 3 of the email in §7. Question 3 is this one
   (also in §47.19).
7. **Where Moyasar's servers are.** Its API sits behind Cloudflare, so the best
   location for the proxy is a judgement. "About a second" for the detour is an
   estimate.
8. **The figures for our own server.** The EC2 price comes from a third-party
   tracker. The disk cost and the SLAs of Lightsail and DigitalOcean were not
   checked, and the build and upkeep times are estimates.
9. **That webhooks are outside the Allowed IPs list.** This is our inference,
   because Moyasar's page does not mention webhooks.
10. **Whether `api.moyasar.com` stays IPv4-only,** and whether the vendor's
    outbound traffic is IPv4-only (§5).
11. **How Moyasar counts its 429 limit,** per key or per address. With a shared
    pair, per address would mean sharing it (§2).
12. **Whether the server that runs our functions sets `NO_PROXY`.** If it
    matched `api.moyasar.com`, calls would go around the proxy without an error.
    The wrong-password check in §3 step 2 would show it.

---

## 7. Two emails to send before starting the trial

Added 2026-11-13, after the research into how Saudi apps meet allow-lists
(`Saudi_Apps_Static_Egress_20261113.md`). Send both before starting the trial,
and wait for the replies before choosing (§3 step 1): the answers decide the
plan (Starter or Production) and whether shared addresses are acceptable at
all. Fill in the bracketed parts and send from the business
mailbox. Neither email contains a key, a password or one of our addresses, and
neither needs one. Keep the replies with this document: they are the written
answers §3 asks for.

### To QuotaGuard (support@quotaguard.com)

**Subject:** Shield for live payment-gateway calls: questions before we subscribe

> Hello,
>
> We plan to use QuotaGuard Shield to give our backend fixed outbound addresses
> for a payment gateway in Saudi Arabia (Moyasar), which accepts live API calls
> only from addresses on an allow-list. Our backend runs on Supabase Edge
> Functions. The traffic is HTTPS only, through a CONNECT tunnel, and low in
> volume: well under 20,000 requests a month at launch. We would use the
> Frankfurt region.
>
> 1. Your pricing page labels Shield Starter "For compliance dev and test
>    environments". Is Starter acceptable for live payment traffic, or do you
>    require Shield Production for that?
> 2. Are the two static addresses on Starter and Production shared with other
>    customers? Your pricing page says "shared static IP pairs", while your
>    llms.txt says "a dedicated pair of static IPs per subscription".
> 3. Do the addresses stay the same when the trial becomes a paid plan, and
>    when we change plan? What happens to them if we cancel?
> 4. Can we change the proxy password without changing the addresses?
> 5. Is the proxy's outbound traffic IPv4 only? If not, which IPv6 addresses can
>    it leave from?
> 6. Can we sign a data processing agreement with you?
>
> Thank you,
> [Name], Spicy Meal

### To Moyasar (through the dashboard's support channel)

**Subject:** Allowed IPs for live keys through a static-IP proxy, and our account's settings

> Hello Moyasar team,
>
> We are preparing to go live with Moyasar invoices (account: [account name]).
> Our server runs on Supabase Edge Functions, which have no fixed outbound
> address, so we plan to send our calls to api.moyasar.com through a static-IP
> proxy service. The proxy only tunnels the encrypted connection, so it never
> sees our secret key.
>
> Your Allowed IPs page says the live list "cannot be set back to any IP
> address" once saved, so we would like to confirm the following before we save
> it:
>
> 1. Do you accept addresses that a proxy service shares with its other
>    customers, or must the addresses be ours alone?
> 2. Do you recommend a provider for this? How do platforms such as Salla meet
>    the list for their merchants?
> 3. If we restrict the TEST list to specific addresses, can it be put back to
>    "any address" later?
> 4. Which payment methods and card schemes does the hosted invoice page offer
>    on our account? We expect mada, Visa, Mastercard and Apple Pay only.
>    Please confirm in writing that every other method and card scheme is off,
>    including SADAD, STC Pay, Samsung Pay and American Express.
> 5. What appears on a customer's card statement for our payments, and can we
>    change it?
> 6. Must our account hold a balance to cover a refund?
> 7. May we cancel an unpaid invoice through the API when a customer leaves the
>    payment page?
> 8. Is Apple Pay on the hosted invoice page supported inside an app's
>    WKWebView (iOS), with no scripts injected?
> 9. Does checkout.moyasar.com honour `?lang=ar` on the invoice address?
> 10. Can a 3-D Secure payment that is still in progress complete after its
>     invoice has expired?
> 11. Could the hosted page ever be served from a domain other than moyasar.com?
> 12. Is an unpaid invoice marked expired exactly at its expiry time, or can it
>     still be paid for a while after?
>
> Thank you,
> [Name], Spicy Meal

All twelve are the questions in `OWNER_ACTIONS.md` §47.19, asked in one message.
Questions 1 and 3 must be answered in writing before any Allowed IPs list is
changed, TEST or LIVE (§3 steps 3 and 4, §47.12). Question 4's answer is a gate
(gap PG-11): no method list is published, and §47.18 is not reached, until
Moyasar confirms in writing that only mada, Visa, Mastercard and Apple Pay are
on.

---

## Review log

An adversarial check of prices and capabilities (2026-11-13) raised no blocking
findings, eight should-fix findings (S1 to S8) and eleven nits (N1 to N11).
Each was re-checked against the page it cites before anything was changed.

| Finding | Outcome |
|---|---|
| **S1.** Fixie stops at its limit; QuotaGuard has soft limits. | **Applied:** table rows "Over the monthly limit" and "Main risk", Sizing, "Whatever you choose", §2 reason 2 and the Fixie fallback, and a fourth cause in the §4 "Could not reach Moyasar" row. The runtime source confirms that a 407 answer to the tunnel request makes the call fail, and our Test connection then shows "Could not reach Moyasar". Two notes on the evidence: the terms clause is §8.5; and the 407 sentence is in Fixie's article for Heroku customers, so whether a direct account behaves the same is listed as Not verified #4. |
| **S2.** Sharing was framed as QuotaGuard-only, on weak evidence. | **Applied, with one correction to the evidence.** The Static product page's "Your IPs are yours alone, with no sharing" answers a question about Enterprise dedicated addresses, so it is not a page saying Starter is unshared. The Shield page's "your dedicated IPs" comes from a general description of signup and says nothing about sharing. Only llms.txt says otherwise. For Fixie, the text says "unclear, ask" rather than "probably shared": the only source for sharing is a competitor's post, while Fixie's own price page says "a dedicated static IP". |
| **S3.** "Change only if you ask" IS on the cited price page. | **Applied:** Not verified #2 narrowed to cancellation and trial-to-paid; Sizing says the addresses survive a plan change; §2 notes that QuotaGuard's move to a private pair changes them; the §3 question is narrowed. Fixie's Supabase guide says the same ("These will never change"). |
| **S4.** QuotaGuard does publish an SLA. | **Applied:** SLA row in the table and a "No uptime guarantee" point in §2. Its SLA covers only Enterprise bought directly, so Starter has none. Both QuotaGuard uptime figures are on the price page, and Fixie's figures (Heroku and Vercel listings, Heroku Dev Center) are in §6. The item left Not verified, because it is now verified. |
| **S5.** QuotaGuard's trial needs card details. | **Applied:** table, §2 reason 5, §3 step 1, §4, Not verified #3. QuotaGuard's comparison post says the same ("Credit card required"). |
| **S6.** "No managed proxy service offers the Gulf" was too broad. | **Applied** in the Location paragraph. Oxylabs lists Saudi Arabia and the UAE, and Supabase's regions list has none in the Middle East. |
| **S7.** Two ruled-out reasons were wrong. | **Applied in part.** "Each sells one bare address" is removed: they price per address and sell several. The suggested replacement, that none of them puts a balanced pair behind one host name, was **not** adopted. Decodo's price page lists a "Single endpoint for bulk operations", and the other sellers' connection set-ups were not read, so that claim could not be checked. The bullet now rests on the reasons that were checked. Fly.io is now described as a host for our own server, ruled out for the same reason as that option. |
| **S8.** The security quote dropped "in ordinary operation". | **Applied** in §2 reason 1, quoted in full, with the technical basis: the tunnel, plus the runtime checking Moyasar's certificate (proxy.rs, §6). |
| **N1.** Data allowances omitted. | **Applied:** table cost row, and a line in Sizing. |
| **N2.** Fixie's log retention conflicts across its pages. | **Applied** in the Fixie fallback paragraph. The terms back 7 days. |
| **N3.** Fixie's location is not "not stated". | **Applied:** table, fallback and Not verified #3 (US data centre; AWS "USA, Ireland"). The question for Fixie stays. |
| **N4.** Fixie also has a Supabase guide. | **Applied:** table, §2 reason 3, §4. |
| **N5.** §2 needed §4's hedge. | **Applied** in §2 reason 3. |
| **N6.** QuotaGuard's trial can be extended. | **Applied:** §2 reason 5, §3 step 1. |
| **N7.** The NAT citation did not show $38. | **Applied:** the Frankfurt rate is now sourced to AWS's own price data ($0.052 an hour, so about $38 a month), with the per-GB and public-address charges. |
| **N8.** Function region can be pinned. | **Applied** in the Location paragraph, with Supabase's caveat that a pinned call is not re-routed during an outage. |
| **N9.** QuotaGuard quotes Shield Enterprise at $259 and $269. | **Applied** as a note in §6; $269, from the price page, is kept. |
| **N10.** Our own server needs more than stated. | **Applied:** a domain name for the certificate and proxy software built with encryption support, in the table; Squid's build options and its v8 note, in §6. |
| **N11.** Static's plain link exposes more than the password. | **Applied:** the two terms at the top, the table and "Not recommended". Fixie's documentation says the same of any `http://` proxy. |

**Beyond the review.** Re-reading QuotaGuard's price page turned up one thing
the review did not raise. It labels Shield Starter "For compliance dev and test
environments" and Shield Production ($59) "For production healthcare and fintech
applications". Its comparison table presents these as each plan's "Best Fit",
not as a rule, so the recommendation stands, and §3 adds a question for
QuotaGuard. Several source addresses now redirect (QuotaGuard's privacy FAQ and
sign-up guide, Fixie's documentation, Oxylabs and Fly.io), and §6 gives where
each one lands.

### Second check: compatibility and security (2026-11-13)

A second adversarial check looked at our code, the Supabase runtime and
Moyasar's rules. It found the security core sound: with an `https://` proxy,
the Moyasar secret key stays inside an encrypted connection to
`api.moyasar.com`, and the proxy's password inside an encrypted connection to
the proxy. It raised one blocking finding, two should-fix findings and seven
nits, prefixed CS- here to keep them apart from the table above. Each was
re-checked before anything changed.

| Finding | Outcome |
|---|---|
| **CS-B1.** The TEST proof restricted the TEST list before the proxy was proven, and no failure row undid it. | **Applied, as the review's option (a), with (b) and (c) folded in.** The evidence held. A read-only check (yes-or-no values only) shows a working TEST setup to lose: Moyasar enabled in TEST mode, an `sk_test_` key and a TEST webhook token, no live key, online payment off. Moyasar's page, re-read and dated 11 November 2026, says nothing about putting TEST back. §3 step 2 now sets the secret while TEST is still open. Restricting TEST is step 3: optional, done only after deciding to keep the service, and after asking Moyasar support (b). The undo (c) is in step 2's "to stop", rows 2, 4 and 6 of §4, the "Once the TEST list is restricted" paragraph under the table and Not verified #6. Two notes. Row 2 gets only half of (c): when the runtime cannot use any proxy, another proxy's addresses would not help. And the old step 2 showed Moyasar enforcing the list, by a refusal from the server's address; the new order drops that demonstration. Moyasar documents the enforcement, and a missing address still shows as a refusal at step 3 or at §47.13. |
| **CS-S1.** Row 1 said "proven" even without the TEST restriction, and a server-wide `NO_PROXY` could bypass the proxy silently. | **Applied** in row 1, §3 step 2, a bullet in §4 and Not verified #12. The source holds: in v1.77.9, `create_http_client` builds the proxies from the server's environment and puts ours in front (lib.rs:1060-1067), and `Proxies::intercept` checks `NO_PROXY` before any of them (proxy.rs:395-400, read at :261). The wrong-password check is marked recommended rather than optional, because with TEST open it is the only check before LIVE that the proxy carried the call. CS-B1 says an open-list "Connection OK" proves four things (runtime support, reachability, the certificate, the sign-in); CS-S1 says it proves only runtime support. Each is right in part: the four hold once the wrong-password check has shown that the call goes through the proxy, and the draft says so. |
| **CS-S2.** The "Could not reach Moyasar" row overstated its causes and what the logs show. | **Applied.** The 12-second limit is at `payment-test-config/index.ts:160`. Any tunnel answer other than 200 or 407 fails as "unsuccessful tunnel" (proxy.rs:617). The Test connection path logs nothing for this failure (`index.ts:169-171`; `moyasarHttp.ts` logs only at :99 and :190). The row now says "for example", points at the vendor's dashboard and says our logs will not help. One refinement: the payment-check path does log the error's type (`moyasarVerify.ts:75`), and a time-out has its own type there, `TimeoutError` (26_fetch.js:426). The row is about Test connection, which logs nothing, so the review's point stands for it. The runtime also checks an outbound rate limit before sending (26_fetch.js:398-416); a refusal there lands in the same row. Whether hosted functions set such a limit was not checked. |
| **CS-N1.** "Connection OK" covers more than success, and a 403 had no row. | **Applied:** a note under the table and a 403 row. Anything but 401 or 403 reads "Connection OK" (`index.ts:162-168`). Moyasar's errors page lists 429, 503 and, for LIVE, 405 "Entity not activated to use live account", so the note names them. It points at the sandbox checkout, which needs a created invoice (`index.ts:256-274`), as the firmer TEST check. |
| **CS-N2.** IPv4-only is true today but could change. | **Applied:** §3 item 2, a question for the vendors, §5 and Not verified #10. Re-checked: Google's and Cloudflare's resolvers both return `104.18.24.246` and `104.18.25.246`, no AAAA record, and an HTTPS record with only an `ipv4hint`. Cloudflare's page says IPv6 is on by default and only an Enterprise zone can turn it off, so a single setting is what keeps Moyasar IPv4-only. |
| **CS-N3.** A shared pair also shares outages. | **Applied:** a "What you accept" point in §2 and Not verified #11. Moyasar's errors page documents 429 without saying how it is counted. |
| **CS-N4.** §5 overstated what the console reads. | **Applied** in §5. Which address a refusal names depends only on whether `MOYASAR_PROXY_URL` is set (`index.ts:101-106`). Row 5's "the proxy may not be in use" was already right and stays. |
| **CS-N5.** The Fixie free-plan route missed repeating step 2. | **Applied differently.** The finding was right for the old order. In the new one, the free plan is used for step 2 only, with the TEST list open, so there are no addresses to swap. §4 now says so, and says to do step 3, if at all, with the paid service's addresses. |
| **CS-N6.** Ask whether the proxy password can change without the addresses. | **Applied** in §3's questions. |
| **CS-N7.** Citations. | **Applied** in §6. The Supabase limits page was re-read for this change. It says "Outgoing connections to ports `25` and `587` are not allowed", so it is no longer marked researcher-read. |

The review's "checked and confirmed" list needed no change. Its log count, 6,145
lines, is a separate reading of a rolling 24-hour window from §4's 6,144; both
show only runtime 1.77.9.

### Final review, 2026-11-14

An independent review of the whole pull request raised nine findings against
this file, and a second reader checked each one. None was refuted.

| Finding | Outcome |
|---|---|
| **R1** (blocking). §5 said to list the pair "in both lists", which restricts TEST with no condition. | **Applied.** §5 now says the LIVE list (§47.12), and the TEST list only through §3 step 3: optional, after the proxy is proven, after deciding to keep the service and after Moyasar's written answers to questions 1 and 3, and possibly permanent. Moyasar's page, re-read 2026-11-14 and still dated 11 November, says a TEST change needs no code. |
| **C3.** "Cash orders are not affected" was false, and Sizing ignored the stuck-refund loop. | **Applied, together with R8, in the second reader's corrected form.** The cash sentence names both locked cases (gap PG-04). A new paragraph after Sizing counts the loop: 5 tries a run, a run every 5 minutes once §47.16 turns the job on (live schedule `*/5 * * * *`, inactive today), so at least 1,440 Moyasar calls a day. It says the vendor may count calls sharing a connection as one, and to send usage alerts to an inbox someone reads (PG-19). It says "at least", not "up to": a try whose lookup works but whose refund call gets no clear answer makes three calls (`payment-refund/index.ts:210-261`). §2 reason 4 now holds only while no refund is stuck. |
| **R8.** The same sentence missed a phone that tries card during an outage. | **Applied** in the same rewrite. Re-checked: the app saves the checkout session before asking for an invoice (`CheckoutScreen.tsx:816`), and an attempt with no invoice reads pending while its session is open (`_shared/moyasar.ts:1065-1078`). The session lasts 30 minutes (live column default). |
| **X1.** "A busy month" promised more than QuotaGuard's visible text. | **Applied** in §2 reason 2, the §1 table and the §6 quote, as the second reader corrected it: soft limits are "a courtesy for unexpected spikes, not a way to run sustained traffic above the paid plan". |
| **R11.** Moyasar question 4 could be answered without meeting the drafts' gate. | **Applied, merged with X5.** Question 4 asks which methods and card schemes the page offers, and for written confirmation that every other one is off. The note after the emails names the gate (gap PG-11). The matching `OWNER_ACTIONS.md` §47.19 bullets were widened the same way. |
| **X5.** Question 4 did not name American Express or Samsung Pay. | **Applied** in the same question, which now names SADAD, STC Pay, Samsung Pay and American Express as examples. |
| **R16.** §3 step 1 started the 3-day trial before the emails were answered. | **Applied.** Step 1 now sends both emails first and waits for the replies, which decide the plan and whether shared addresses are acceptable, then starts the trial. |
| **C16.** Three timings for the emails, a stale version line and a stale "(add it to §47.19)". | **Applied.** This file now says one thing: send both before starting the trial (status, §3 item 3 and step 1, §7). The version line says only the code comment still reads 1.68.0. "(add it to §47.19)" is gone. `Saudi_Apps_Static_Egress_20261113.md` §5 was aligned the same day. |
| **R13.** The wrong-password check assumed the secret could be read back, and could hit a `%` code. | **Applied.** Step 2 says to paste the URL from the vendor again, change a letter or digit that is not a `%` or one of the two after it, and what the other message means; row 3 of the §4 table says the same. **Applied differently** for "tell engineering": one note above the §4 table, and the words in step 2, instead of repeating them in every row. |

**Beyond the findings.** §3 step 4 now follows the go-live order the other
documents share: switch Moyasar's dashboard to LIVE first (§47.8 left it in test
mode), change only the LIVE list, and change no list before Moyasar's written
answers to questions 1 and 3. Saving the LIVE list asks for a 6-digit code, and
if none is asked for, the list was the TEST one. Moyasar saves a TEST change at
once, so the step says to stop there and tell engineering rather than only "do
not save". Step 3, row 1 of the §4 table, Not verified #6 and the note after the
emails say the same.
