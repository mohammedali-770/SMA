# Pen.dev output — defect log

> Round 1 findings, and the evidence that each was closed by the refinement pass.
> Reproduce the evidence at any time:
>
> ```bash
> python3 design/verify.py
> ```
>
> The harness parses the `.pen` sources rather than judging exports by eye, so
> every result below is checkable rather than an impression.
>
> Status key: `fixed` · `open` · `withdrawn` (raised in error) · `needs owner decision`.
>
> **Last run: 34 / 34 checks passed** — 2026-07-29, after the refinement pass.

---

## Cross-batch consistency

These mattered most: they are places where two batches disagreed with each other,
so left alone they compound.

| # | Defect | Batches | Status | Evidence |
| --- | --- | --- | --- | --- |
| C1 | **Numeral system disagrees.** Batch 02 rendered Arabic-Indic numerals on Arabic screens (٣٥ ر.س، ٤٨٠ سعرة); 03 and 05 rendered Western. Pen.dev's own design-system sheet specified Arabic-Indic in Arabic context, so 03/05 contradicted the system they were handed. | 02 vs 03, 05 | **fixed** | Owner decision: Western everywhere. `verify.py` §1 — **0 Arabic-Indic digits in rendered text across all 8 files**. Currency labels stay localised (`ر.س` / `SAR`). |
| C1b | The inconsistency spanned the admin surface too. | 06 | **fixed** | Same check; 06/07/08 all clean. |
| C2 | **Bottom tab bar labels disagree.** Batch 05 rendered الرئيسية / **القائمة** / حسابي, inventing a Menu tab. The product has exactly three tabs and no separate Menu — home *is* the menu. | 05 | **fixed** | `verify.py` §3 — `طلباتي` present and `القائمة` absent in both `02-core` and `05-account`. |
| C3 | **RTL sentence punctuation.** Full stops landed at the start of a wrapped Arabic line instead of the end (the below-minimum warning, the addresses hint). | 03, 05 | **fixed** | Arabic runs set RTL with right-aligned paragraphs; confirmed on the refined exports of 03 and 05. |
| C4 | **The admin sidebar was a different product between batches.** Batch 06 carried the real twelve tabs; batch 07 invented Dashboard, Orders, Menu, Branches, **Customers**, **Payments**, **Promotions**, **Delivery**, Reports, Operations — adding four tabs that do not exist and dropping Banners, Order Integrity, Operations Health and Legal Documents; batch 08 was a third variant. The sidebar is the shell every admin screen shares, so the set depicted three different applications. Cause: the prompt said "reuse the same shell" instead of pinning the twelve labels verbatim. | 06 vs 07, 08 | **fixed** | `verify.py` §2 — all three admin files contain the **12 canonical tabs and 0 invented ones**. |

## Batch 02 — ordering loop

| # | Defect | Status | Evidence |
| --- | --- | --- | --- |
| 2.1 | **Header mirrored backwards.** Arabic put the logo left and the language toggle right; English did the reverse. The brand belongs at the start of the reading direction — right in Arabic, left in English. The tab bars mirrored correctly, which made this an inconsistency rather than a misunderstanding of RTL. | **fixed** | Refined exports: Arabic brand right / toggle left; English brand left / toggle right. Branch bar, chevrons, search affordance and tab order all mirror correctly on both. |

## Batch 04 — twelve-state confirmation board

| # | Defect | Status | Evidence |
| --- | --- | --- | --- |
| 4.1 | **Prompt instruction leaked into visible copy.** The `accepted_no_pos_channel_unpaid` card ended with the literal words *"No payment language."* | **fixed** | `verify.py` §4 — 0 occurrences across all 8 files. Body now reads *"Your order has been received and is being processed."* |
| 4.2 | **Unrequested copy implied a branch step.** `accepted_no_pos_channel` gained *"Awaiting branch assignment."* The point of that state is that no branch is involved. | **fixed** | `verify.py` §4 — 0 occurrences. Body now reads *"Your order is being processed through the delivery channel."* |

## Batch 06 — admin dashboard

| # | Defect | Status | Evidence |
| --- | --- | --- | --- |
| ~~6.1~~ | ~~Orphaned sidebar artboard.~~ **MISDIAGNOSED — not a defect.** The standalone sidebar (`YgURS`) is the master **component definition**, flagged `reusable: true`; all three screens are instances referencing it (`wb0nD`, `SUeZF`, `xWYl3`). Same for Nav Item, Nav Item Active and KPI Tile. Deleting any would break every screen pointing at it. | **withdrawn** | Parsed from the `.pen`: 4 definitions, 28 instance refs. Pen.dev's agent refused the instruction and explained why; independently confirmed. `verify.py` §6. |

## Batch 01 — design system

| # | Defect | Status | Evidence |
| --- | --- | --- | --- |
| ~~1.1~~ | ~~Stray scratch geometry above the sheet.~~ **MISDIAGNOSED — same cause as 6.1.** The floating stepper, field, button and swatch are the sheet's own component definitions, referenced by 116 instances. | **withdrawn** | `verify.py` §6 — 4 definitions, 116 refs, all resolving. |
| 1.3 | **Component definitions render in the export**, floating outside the sheet layout so PNGs read as cluttered. The real issue behind the 1.1/6.1 misreading — placement, not deletion. | **fixed** | Definitions moved into a labelled *Component library · مكتبة المكونات* section at the foot of the sheet; refs intact. |
| 1.2 | **Dark-mode contrast unverified.** The dark palette looks right but has not been measured. Every dark token pair needs a computed ratio against its ground (body ≥ 4.5:1, UI affordances ≥ 3:1). | **open** | Deferred — needs a computed contrast pass, not a visual judgement. |

---

## Craft pass (owner request)

The mobile screens read as templated: uniform card heights, brand purple on every
element, one typographic weight, flat colour chips standing in for food. Addressed
as a visual-craft pass with **no structural change** — no screen, control, field or
feature added, removed or renamed.

| Lever | Applied |
| --- | --- |
| Type contrast | Product and screen names heavier and tighter; descriptions lighter, smaller, cooler; price second-loudest on a card. |
| Spacing rhythm | Generous space above section starts, tighter within groups; varied rather than one repeated gap value. |
| Depth | Soft low shadows replace hairline borders; the food block bleeds to the card edge on lead cards. |
| Food blocks | Layered off-axis gradients with an offset highlight and a corner vignette; hue and angle vary per dish. |
| Brand restraint | Purple pulled back to primary actions, active navigation and one accent per screen; red reserved for destructive and error states. |
| Optical detail | Arabic aligned optically; consistent radii; tabular numerals so price columns line up. |

---

## What is NOT a defect

Recorded so these are not "fixed" by mistake later:

- **Gradient blocks instead of food photography.** Deliberate. Inserting image
  assets crashes the pen.dev save step (`IPCError: Both URIs must be absolute!`),
  losing the entire batch after the work is done. Placeholder crops are standard
  mockup practice; production swaps in real product shots at the same crop.
- **Component definitions on the canvas.** Good file structure — it is what makes
  these files editable rather than flat pictures. See 1.1 / 6.1.
- **"No flags" chips on the state board.** That board is a spec artefact, not a
  customer screen — the chips document which states carry a success check, a
  resend action or a branch number.
- **Masked phone number** (`+966 5X XXX XX89`) on the profile screen.

---

## Verification summary

| Check | Result |
| --- | --- |
| 1. Western numerals in rendered text | 8 / 8 |
| 2. Twelve canonical admin tabs, none invented | 3 / 3 |
| 3. Customer three-tab bar | 2 / 2 |
| 4. No leaked prompt text | 8 / 8 |
| 5. System constraints preserved | 5 / 5 |
| 6. Component libraries intact | 8 / 8 |
| **Total** | **34 / 34** |

Constraint strings asserted still present: *Order confirmed* · *please do not
re-order* · *nothing to refund* · *VAT incl* · *awaiting POS* · *Dormant* ·
*external delivery is disabled* · *no retry, refund, resend or mark-paid* ·
*Disabling both payment methods stops checkout* · *ضريبة القيمة المضافة* ·
*خصم الولاء*.

## Remaining open items

- **1.2 — dark-mode contrast** needs measuring against WCAG rather than eyeballing.
- **Layer-name hygiene** — `03-payment` retains 4 Arabic-Indic digits inside layer
  names. Never rendered; cosmetic only.
- **Order-tracking timeline** — still the owner's call (`PENDEV_BRIEF.md` §10);
  default remains status pills with no timeline.

---

## Fix strategy (used)

One refinement pass per affected `.pen` file, edited **in place** rather than
regenerated:

```bash
pen -i /home/user/SMA/design/0N-name.pen -o /home/user/SMA/design/0N-name.pen \
    -e /home/user/SMA/design/exports/0N-name.png --export-scale 2 \
    -p "<targeted correction, no other changes>"
```

Regenerating would have re-rolled screens that were already correct and risked new
inconsistencies. Instruction sets are kept in `design/refine/` so every change is
auditable.
