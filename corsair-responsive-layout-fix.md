# CORSAIR — Responsive Layout Fix (Phase 0 diagnosis → fix → verification)

**Date:** 2026-06-23 · **Build at fix:** P13.351 · **Operator:** Mike Poppa
**Symptom reported:** "To see the entire screen I have to zoom out until the text is too small to read."
**Live:** https://mpoppa32.github.io/FLi-Network/FLiIntel.html

---

## Phase 0 — Diagnosis (measured, not guessed)

### A. The layout model — and a key correction
- **The live CSS is the inline `<style>` block in `FLiIntel.html` (starts line 65, ~8,500 lines).** `FLiIntel.css` (the 2,500-line file that *looks* like the stylesheet) is **NOT linked** — line 47 loads only Google Fonts. Early analysis of `FLiIntel.css` was therefore moot; all real styles/breakpoints are inline. (Tell: two different `:root` type scales — `FLiIntel.css` 9–36px vs inline 12–44px; only the inline one is live.)
- **Fixed-viewport app:** `html,body{overflow:hidden}` — the shell never scrolls; anything past the viewport is **clipped, not scrollable**. This is the engine of the "zoom out to see it" reflex.
- **Type scale is fixed px** (`--text-2xs:12px … --text-3xl:44px`). (Note: px vs rem is *not* the cause here — browser zoom scales both identically. The cause is the layout clipping content, which forces the zoom-out that then shrinks the px text.)
- **Views are `flex:1;flex-direction:column;overflow:hidden`** containers (~18 of them), each meant to host an internal scroll region.

### B. Breakpoint behavior
- The inline CSS **does** have breakpoints across the laptop range (768/900/1100/1280/1300/1400/1500/1600) — so it is *partially* responsive (e.g. the nav condenses to icons at narrower widths; modals are fluid). It is **inconsistent**, not absent.
- Horizontal overflow measured at the operator's effective width: **0px** — so width was **not** the primary problem.

### C. The real cause — vertical clipping on a short canvas
- **The operator runs ~150% Windows display scaling.** At 100% browser zoom this yields an **effective CSS canvas of ~1280 × ~800px** (laptop-class), even though the panel is physically 1920px. (Confirmed: `screen.width` reports 1280 CSS px; the operator had been coping at ~69–75% browser zoom to fit, which is what shrank the text.)
- **The Today view is the demonstrated failure:** `#today-view` is `overflow:hidden`, and its top sections — the title + action buttons, "Where Atlas Stands," and "Top Catches" — are **fixed direct children**, with only a small inner `#today-rhythm-host` set to scroll. On the ~800px-tall canvas those pinned sections consume the height, the inner scroll box collapses, and **everything below (the SYNC/TARGETS/SEND/CAPTURE row, Today's Brief, and the 8-card metrics grid) is clipped with no way to scroll to it.** The operator zoomed out to fit it all → text became unreadable. The operator confirmed this directly (a zoomed-out screenshot revealed all the clipped content).

### D. What was already right
- Modals (Sales Ledger, Value Book) are fluid (`max-width` + `width:100%`) and center correctly — the good baseline.
- The nav condenses to icons at narrower widths.
- The scroll host itself had a correct flex-scroll setup (`flex-grow:1; min-height:0; overflow:auto`) — the bug was that the *content above it* was pinned outside any scroll region.

---

## Phase 1 — Fix (P13.351)

Scaling/scroll fix only — visual identity, fonts, and colors unchanged.

1. **`#today-view`: `overflow:hidden` → `overflow-y:auto;overflow-x:hidden`** — the whole dashboard now scrolls as one clean unit.
2. **`#today-rhythm-host`: `flex:1;overflow:auto` → `flex:0 0 auto;overflow:visible`** — flows into the view scroll instead of a squeezed nested scroll.
3. **Viewport meta: removed `maximum-scale=1.0`** — restores accessibility zoom (was blocking pinch-zoom).

4-site build-tag bump; `doctype` count unchanged (3) confirming no structural corruption; staged diff +7 lines.

---

## Phase 2 — Verification

- **Today view @ 100%, operator's real screen (verified by the operator):** full-size, readable text; the layout is clean and professional; **all previously-clipped content (orientation cards, Today's Brief, 8-card grid) is now reachable by scrolling — no zooming required.** Operator confirmed "it scrolls."
- The behavior shift delivered: **read at 100% + scroll**, instead of **zoom-out-to-fit + unreadable text**.

### Remaining / in progress
- **Other views (Pipeline, Accounts, Inbox, Outreach, Drone, etc.):** most are expected to already scroll correctly (Today's pinned-sections structure was unusual, accumulated over many releases). Each is being verified at 100% on the operator's screen; any that share the clip pattern get the same `overflow-y:auto` treatment. Note: a few views (opps/Pipeline, intel, timeline) define overflow via CSS class rather than inline and will be handled per their structure.
- **Live multi-resolution screenshot verification by the agent was constrained** this session: the operator's browser window is maximized (window-resize ignored), the page is heavy (screenshot timeouts), and the ~150% scaling + manual zoom confounded remote measurement. Verification therefore relied on the operator's real-screen screenshots at 100% — the authoritative target device.

---

*Visual identity preserved; this is a responsiveness/scroll fix. Primary target (standard laptop / the operator's ~1280×800 canvas at 100%) met for the Today surface; extension to remaining views ongoing.*
