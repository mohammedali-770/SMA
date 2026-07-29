# Pen.dev output — defect log (round 1)

> Findings from reviewing the first generated pass, batch by batch. Each entry
> is a correction to apply in a refinement pass, **not** a reason to regenerate
> the batch — the underlying screens are sound.
>
> Status key: `open` · `fixed` · `needs owner decision`.
> Last updated 2026-07-29.

---

## Cross-batch consistency

These matter most, because they are places where two batches disagree with each
other. Left alone they compound.

| # | Defect | Batches | Status |
| --- | --- | --- | --- |
| C1 | **Numeral system disagrees.** Batch 02 renders Arabic-Indic numerals on Arabic screens (٣٥ ر.س, ٤٨٠ سعرة); batches 03 and 05 render Western (78.00, 240). Pen.dev's own design-system sheet (batch 01) specifies Arabic-Indic in Arabic context, so 03/05 contradict the system they were handed. | 02 vs 03, 05 | **needs owner decision** |
| C1b | The numeral inconsistency now spans the admin surface too — batch 06's Live Orders and Financial Reports use Western numerals. Whatever C1 resolves to must be applied to both surfaces. | 06 | **needs owner decision** |
| C2 | **Bottom tab bar labels disagree.** Batch 02 is correct — الرئيسية / طلباتي / حسابي (Home / Orders / Account). Batch 05 renders الرئيسية / القائمة / حسابي, inventing a "Menu" tab. The product has exactly three tabs and no separate Menu tab: home *is* the menu. | 05 | open |
| C3 | **RTL sentence punctuation.** Full stops land at the start of a wrapped Arabic line instead of the end (e.g. the below-minimum warning, the addresses hint). A bidi/pilcrow handling issue in the text runs. | 03, 05 | open |

## Batch 02 — ordering loop

| # | Defect | Status |
| --- | --- | --- |
| 2.1 | **Header mirrored backwards.** The Arabic screen puts the logo on the left and the language toggle on the right; the English screen does the reverse. It should be the opposite — the brand sits at the start of the reading direction, so right in Arabic and left in English. The bottom tab bars mirror correctly, which makes this an inconsistency rather than a misunderstanding of RTL. | open |

## Batch 04 — twelve-state confirmation board

| # | Defect | Status |
| --- | --- | --- |
| 4.1 | **Prompt instruction leaked into visible copy.** The `accepted_no_pos_channel_unpaid` card ends with the literal words "No payment language." — that was an instruction to the generator, not customer copy. | open |
| 4.2 | **Unrequested copy implies a branch step.** The `accepted_no_pos_channel` card gained "Awaiting branch assignment." The entire point of that state is that no branch is involved, so nothing may imply a branch step is pending. | open |

## Batch 06 — admin dashboard

| # | Defect | Status |
| --- | --- | --- |
| 6.1 | **Orphaned sidebar artboard.** The sheet contains a standalone sidebar with no screen attached — scratch geometry from building the reusable component, shipped in the export. Same class of problem as 1.1. | open |

## Batch 01 — design system

| # | Defect | Status |
| --- | --- | --- |
| 1.1 | **Stray scratch geometry above the sheet** — a leftover quantity stepper, text field, button and colour swatch float outside the main artboard. Cosmetic, but it ships in the export. | open |
| 1.2 | **Dark-mode contrast unverified.** The dark palette looks right but has not been measured. Every dark token pair needs a computed contrast ratio against its ground before sign-off (body text ≥ 4.5:1, UI affordances ≥ 3:1). | open |

---

## What is NOT a defect

Recorded so these are not "fixed" by mistake later:

- **Gradient blocks instead of food photography.** Deliberate. Inserting image
  assets crashes the pen.dev save step (`IPCError: Both URIs must be absolute!`),
  losing the entire batch after the work is done. Placeholder crops are standard
  mockup practice; production swaps in real product shots at the same crop.
- **"No flags" chips on the state board.** That board is a spec artefact, not a
  customer screen — the chips document which states carry a success check, a
  resend action or a branch number.
- **Masked phone number** (`+966 5X XXX XX89`) on the profile screen.

---

## Fix strategy

Apply as **one refinement pass per affected `.pen` file** once all eight batches
exist, rather than regenerating batches individually:

```bash
pen -i /home/user/SMA/design/0N-name.pen -o /home/user/SMA/design/0N-name.pen \
    -e /home/user/SMA/design/exports/0N-name.png --export-scale 2 \
    -p "<targeted correction, no other changes>"
```

Regenerating would re-roll screens that are already correct and would risk
introducing new inconsistencies; a targeted edit preserves what works.
