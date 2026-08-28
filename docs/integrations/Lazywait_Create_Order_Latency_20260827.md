# Lazywait — `POST /pos/orders/create` response time, 2026-08-27

**Purpose: this is a support ticket to send to Lazywait, written so it can be
read by someone who does not know our system.** It asks one question — why does
Create Order sometimes take eight seconds? — and gives four timestamped
measurements to answer it against.

Everything below is measured from our own request/response logs. Nothing is
estimated or averaged.

---

## The question

`POST /pos/orders/create` on `apiv2-dev.lazywait.com` returns in **1.6 s most of
the time and 8.0 s sometimes**, for orders of the same size against the same
branch, minutes apart. We would like to know whether that is expected, and
whether there is anything on our side that causes it.

## The measurements

Four consecutive delivery orders, same branch, same client id, all accepted on
the **first attempt** with no retries. The timing is the gap between our
request leaving and the response arriving, isolated from everything else we do.

| Our order | Ticket | Lines | UTC placed | **Create Order call** |
| --- | --- | --- | --- | --- |
| SM-2026-000065 | #9 | 1 | 18:19:38 | **1.57 s** |
| SM-2026-000066 | #10 | 2 | 20:15:08 | **1.62 s** |
| SM-2026-000067 | #11 | 2 | 20:29:19 | **2.40 s** |
| SM-2026-000068 | #12 | 1 | 20:43:06 | **8.02 s** |

**The 8.02 s order was the SMALLEST of the four** — one line item. So it does
not scale with order size, and it is not a payload problem.

### How the call was isolated

Our worker makes one gated database write immediately **before** the HTTP request
leaves, and one immediately **after** the response is handled. Both are logged
with millisecond timestamps, and nothing else runs between them. The figures
above are the gap between those two log lines, so they slightly **over**state the
call (they include our own response handling); the true API time is a little
lower, never higher.

Worked example, SM-2026-000068:

```
20:43:08.271   rpc/begin_lazywait_create_attempt   (our pre-send gate returns)
               -> POST /pos/orders/create leaves here
               <- response arrives, we store the order_ref
20:43:16.294   PATCH /orders                       (we persist the ref)
               = 8.02 s
```

For contrast, the same two lines on SM-2026-000066 are `20:15:13.741` and
`20:15:15.358` — **1.62 s**.

## Why it matters to us

Our customer's checkout screen waits for this call so the branch number can be
shown on the receipt. Everything else in that path now takes about **1.2 s**
combined — we measured and removed our own overhead first, precisely so that
this question could be asked cleanly:

| Our side of SM-2026-000068 | |
| --- | --- |
| Worker start → configuration loaded | 1.08 s |
| Order claim + three catalog reads | 0.002 s |
| Reads → pre-send gate | 0.068 s |
| **Your Create Order call** | **8.02 s** |

So on that order, **82% of the wait was the Create Order call**, and we have
nothing left to optimise on our side.

## What we are asking

1. **Is a 1.6 s → 8.0 s spread expected** on `apiv2-dev.lazywait.com`, or does it
   indicate a problem?
2. **Is the dev host the right one for live orders?** It is the host we were
   given and every real order goes there, but if it is not sized for production
   traffic that would explain the variance.
3. **Is there a faster or asynchronous variant** of Create Order — one that
   acknowledges receipt and creates the ticket in the background?
4. **Does anything in our payload slow it down?** We send `client_id`,
   `branch_id`, `order_items[]`, `customer_name`, `source`, `order_details`,
   `delivery_address`, `customer_cell` / `country_code`, and the money fields
   (`subtotal`, `total`, `tax`). We do **not** send `order_deliveries[]`,
   coordinates, or `is_paid`.

If it helps, we can supply the exact request bodies for any of the four orders
above.

---

## Note for us, not for Lazywait

Do **not** work around this by pre-emptively shortening the Create Order
`timeoutMs` (currently 15 s in `lazywaitFetch`). That timeout is the boundary
between "proven not sent" and "may have been sent": a timeout is classified
`ambiguous` and routes the order to `confirmation_required` rather than a
resend, because Create Order has no idempotency key. Shortening it would convert
slow-but-successful tickets into orders a human has to verify by hand.

The customer-facing wait was addressed instead by cutting `SYNC_TIMEOUT_MS` in
`order-intake` from 11 s to 5 s — a different constant, which bounds how long
checkout waits without touching how the POS outcome is classified.

**That cut was reverted to 11 s on 2026-08-28** and is not currently in force. It
was correct in itself but shipped without the two mobile changes that make
returning mid-send presentable, and a customer was shown "we could not verify
whether the branch received this order" on an order that had synced as ticket #2
in 7.30 s. Re-cut it once a build ships the client half — detail in
`docs/ORDER_CONFIRMATION_FLOW.md`. **None of this changes the question being put
to Lazywait, or the four measurements it rests on.**
