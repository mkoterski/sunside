# Handoff: SunSide v2A — verdict, finder & spine UI

## Overview

This bundle specifies the UI changes that take **SunSide Berlin v0.13** to the design
direction approved as **v2A**. It is a *design-language-preserving* upgrade: the app's
existing v0.13 look (DM Sans, warm-grey paper, oklch tokens, blue-left / red-right
verdict semantics) stays exactly as-is. What changes is that the app finally **shows the
per-segment analysis it already computes**, and picks up the missing pieces of the
design brief's flow.

The single biggest item: `calcSun()` already walks every leg of the trip and reports
`"17 segments"` in the data grid, but **the segments are never rendered**. v2A adds the
route spine that visualises them, plus a shade meter with per-side kilometres. That is
the product's whole argument, currently invisible.

## About the Design Files

The files in this bundle are **design references created in HTML** — prototypes showing
intended look and behaviour, not production code to copy directly.

`SunSide v2A.dc.html` is a self-contained prototype built on a small in-house component
runtime (`support.js`). **Do not port that runtime, and do not copy the file into the
repo.** It is a specification you read; the delivery target is the real codebase.

### The target environment (important — it is not a framework app)

The canonical client is `public/index.html`: **one file** holding all markup, CSS and JS.

- No build step, no framework, no dependencies, no bundler.
- Two external scripts only: `history.js` (local, encrypted history) and `suncalc@1.9.0`.
- Styling is CSS custom properties in `:root` / `[data-theme="dark"]`, plus a
  `@media (prefers-color-scheme: dark)` block for the un-toggled default.
- Screens are `.screen` divs toggled by `show(id)` adding/removing `.active`.
- Dynamic UI is built with template literals into `innerHTML`, rendered by `render*()`
  functions.
- All third-party strings (stop names, line names, directions) go through `esc()` before
  reaching `innerHTML`.
- All copy lives in the `STR` dictionary with `de` and `en` keys, read at render time via
  `t('key')`; German is the default. **Every new string must be added to both languages.**

So: implement this by **editing `public/index.html` in that same vanilla style** — extend
the `:root` token block, add CSS rules alongside the existing ones, add `STR.de` /
`STR.en` entries, and add `render*()` functions that emit template-literal HTML. Match
the file's existing conventions (naming, comment style, `esc()`, `t()`), not this
prototype's conventions.

⚠️ Two live traps in this codebase, both already recorded as fixed bugs in the changelog
— do not reintroduce them:
1. **Never name a local variable `t`** inside a render function; it shadows the
   translation function `t()`. The file uses `tm` for times, with a comment saying why.
2. **Never write a literal `</script>`** anywhere, including inside comments — it ends
   the inline script element early and breaks all JS.

## Fidelity

**High-fidelity.** Colours, type, spacing, radii and interaction states below are final
and exact. Reuse the repo's existing CSS variables wherever one exists (the values quoted
here are the light-theme resolutions of those variables) and add new tokens only where
this document says so. Every new colour must also get a `[data-theme="dark"]` value.

## Scope: what is new vs. what already exists

**Already in v0.13 — leave alone:** permission screen, nearby departures board with
LIVE/delay tags, exit-stop picker, seat diagram, verdict card and its tinting, flip
warning callout, low-sun warning, data grid, best-departure finder, radar vehicle strip,
DE/EN toggle, light/dark themes, encrypted history card, skeleton loaders, error states.

**New in v2A — build these:**

| # | Item | Where |
|---|---|---|
| 1 | **Route spine** — per-segment shade visualisation | Result screen, below the data grid |
| 2 | **Shade meter** + per-side km key | Inside the verdict card, under the explanation |
| 3 | **Sun bar upgrade** — trip-relative, not just clock | Existing `#sun-bar` |
| 4 | **Follow-the-ride screen** — auto-advancing journey view | New screen after the result |
| 5 | **Motion & affordance polish** | Departure/stop cards |
| 6 | **Accessibility pass** | Global |

Items 1 and 2 are the priority; 4 is the largest and can ship separately.

---

## 1. Route spine (the signature component)

A vertical list of the trip's stops where the rail **between** stops is tinted by which
side is shaded on that segment. Renders on the result screen, statically.

### Data

`calcSun()` already builds exactly what this needs via `buildLegs(stops, stopIdx)`,
returning `{from, to, bearing, km}` per leg, and classifies each with
`sideForBearing(sunAz, bearing)` → `'left' | 'right' | 'neutral'`.

Note the existing semantic carefully: `sideForBearing` returns **where the sun is**, so
the *recommendation* is the opposite side. The repo already encodes this as
`shadeOf = s => s==='left' ? 'right' : s==='right' ? 'left' : null`. The spine colours the
rail by the **sunny** side, consistent with the brief:

| Sun strikes | Rail colour | Token | Right-aligned label |
|---|---|---|---|
| `right` (shade is left) | blue | `var(--left)` `#1a6fbf` | `← shade` |
| `left` (shade is right) | red | `var(--right)` `#c0392b` | `shade →` |
| `neutral` (ahead/behind) | grey | `#d9d5ca` (add `--rail-neutral`) | `even` |
| sun below horizon | grey | `--rail-neutral` | `sun down` |

### Structure, per row

```
[ dot ][ rail ]   Stop name                      ← shade
                  [flags]  208° SSW · 0.47 km
```

- **Row:** `display:flex; gap:12px; min-height:46px`. Left gutter column is 18px wide,
  `display:flex; flex-direction:column; align-items:center`.
- **Dot** (`z-index:2`, sits over the rail):
  - boarding (first): 15px, filled `var(--accent)` `#e05500`, no border
  - exit (last): 13px, filled `var(--text)` `#1c1a15`, no border
  - intermediate: 9px, fill `var(--bg)` `#f4f2ee`, `2px solid <that segment's rail colour>`
- **Rail:** `flex:1; width:4px; border-radius:3px; margin:2px 0`, background = segment
  colour. The **last row has no rail** (no segment departs the exit stop).
- **Right column:** `flex:1; min-width:0; padding-bottom:14px`.
  - Stop name: 0.9rem / 700, single line, `overflow:hidden; text-overflow:ellipsis`.
  - Shade label: 0.72rem / 800, `white-space:nowrap`, coloured to match the rail
    (use `#c28321` rather than `--right` if the red reads too alarming on amber routes —
    the prototype uses the rail colour directly).
  - Meta line, 4px below: 0.7rem, `var(--faint)` `#b5b2a4`, tabular numerals,
    format `` `${Math.round(bearing)}° ${cardinalFromAz(bearing)} · ${km.toFixed(2)} km` ``.
    `cardinalFromAz` already exists.
- **Flags** (before the meta text, `display:flex; gap:6px; flex-wrap:wrap`):
  0.6rem / 800, uppercase, `letter-spacing:.04em`, `padding:1px 7px`, `border-radius:999px`.
  - `board` — bg `var(--accent)`, text `#fff`, on the first row
  - `exit` — bg `var(--text)`, text `#fff`, on the last row
  - `flips` — bg `var(--sun)` `#f5a623`, text `#1c1a15`, on the row where the
    recommended side changes. Use the **existing** flip-detection loop in `calcSun()`
    (it already finds `flipAt`); tag that stop rather than writing a second detector.

Section eyebrow above the spine: `The route` / `Die Route` — 0.68rem, 700, uppercase,
`letter-spacing:.07em`, `var(--muted)`.

### Bearing direction

The spine renders the legs in travel order from the boarding stop. `buildLegs` already
computes bearings in travel direction, so no reversal is needed — but if you ever render
a reversed trip, flip each bearing by 180°.

## 2. Shade meter (inside the verdict card)

A single horizontal bar under the verdict explanation, showing distance-weighted shares.

- Bar: `display:flex; height:9px; border-radius:5px; overflow:hidden;`
  background `var(--offset)`.
- Three children, `width` = percentage of total km:
  blue `var(--left)` (shade-left km) · grey `--rail-neutral` (even km) · red
  `var(--right)` (shade-right km).
- Key row below, **8px gap, and it must not wrap** — a naive three-item
  `justify-content:space-between` row overflows at this font size. Use:
  `display:grid; grid-template-columns:1fr auto 1fr; align-items:center; gap:8px;`
  with each cell `min-width:0; white-space:nowrap;` and short labels:
  `← 1.6 km` (left) · `2.7` (even, centred) · `4.2 km →` (right).
  0.66rem, tabular numerals, `var(--muted)`; the `■` swatch before/after each takes the
  matching colour.

Accumulate the three km totals in the same loop that already weights
`weight[side] += l.km` in `calcSun()` — the numbers exist, they are simply not surfaced.

## 3. Sun bar upgrade

`#sun-bar` currently shows azimuth, elevation, cardinal and **wall-clock time**, updated
on a 60s interval, and is always the *current* sun. Two changes:

- Show the sun **at the analysed departure time**, not `new Date()`, whenever a trip is
  selected — otherwise the bar contradicts the verdict when the user picks a later
  departure in the finder. `sunInfo(lat, lon, when)` already accepts a time.
- When the sun is below the horizon, render `—` for azimuth and cardinal instead of a
  misleading negative-elevation azimuth.

Keep the existing markup, tokens (`--sun-bg`, `--sun-border`, `.sun-dot`, `.sb-val`,
`.sb-sep`) and the pulsing dot exactly as they are.

## 4. Follow-the-ride screen (largest item; ships independently)

A new `.screen` (`id="scr-journey"`), reached from a full-width primary button at the
bottom of the result card: `▶ Follow the ride` / `▶ Fahrt folgen`. Uses the existing
`.btn .btn-primary` (pill, `var(--accent)`, `#fff`, 700).

### Status card (pinned, does not scroll)

Dark card, `background:var(--text)` `#1c1a15` (in dark theme use a deeper `#0f1218`),
`border-radius:16px; padding:15px 16px`, text `var(--inv)`:

- Eyebrow, 0.64rem, uppercase, `letter-spacing:.09em`, `var(--sun)`:
  `Now · stop 4 of 16` / `Jetzt · Halt 4 von 16`.
- Source badge, right-aligned, 0.68rem, `#9FB0C9`: `clock estimate` / `Uhrzeit-Schätzung`
  before the vehicle is located, `Live GPS via VBB radar` / `Live-GPS via VBB-Radar` once
  radar has it — with the existing green pulsing `.live-dot` when live. Reuse
  `radarVehicle` / `radarActive`; do not invent a new source concept.
- Current segment, 1.02rem / 800, `letter-spacing:-.02em`: `A → B`.
- Shade line, 0.8rem: `Shade on the left ←` / `Shade on the right →` /
  `No clear shaded side`, coloured `#8FA8CE` (left) or `var(--sun)` (right).
- Play/pause: 44×44 circle, `var(--accent)`, `#fff` glyph, `▶` / `❚❚`, and `↺` in the
  arrived state. `aria-label` required.

### Route list

The same spine as item 1, with three additions:

- **Current stop:** 14px dot, fill `var(--sun)`, `2.5px solid var(--accent)`,
  plus a `0 0 0 4px rgba(245,166,35,.28)` glow ring. Suppress the glow under
  reduced-motion.
- **Passed stops:** `opacity:.4`, `transition:opacity .4s ease`.
- **Vertical progress bar:** a separate gutter to the left of the spine — track
  `position:absolute; left:23px; top:10px; bottom:30px; width:3px`, `#e3dfd6`
  (`var(--border)`-ish; add a token); fill same geometry with `height` = progress,
  `var(--sun)`, `transition:height .6s ease`. Down = forward.

### Behaviour

- In production this is **clock-driven**, not a demo timer: compare `Date.now()` against
  the trip's `stopovers[].arrival` / `plannedArrival` (already fetched with
  `?stopovers=true`) to decide the current stop, and prefer the radar position when the
  vehicle is located. The prototype's fixed 1.7s tick is a stand-in for review only.
- Auto-scroll so the current stop sits **~70px from the top** of the list container
  (`list.scrollTop = Math.max(0, currentRow.offsetTop - 70)`).
  ⚠️ Do **not** use `scrollIntoView`.
- Play/pause suspends the follow/auto-scroll, not the data.
- Reaching the exit stop → **Arrived** state: stop advancing, eyebrow reads
  `Arrived` / `Angekommen`, source badge `✓ done` / `✓ fertig`, button becomes `↺` to replay.
- Leaving the screen must clear any interval — the prototype clears it in
  `componentWillUnmount` and whenever the screen changes; do the equivalent in `show()`.

## 5. Motion & affordance polish

Applies to `.dep-card` and `.stop-item`. The repo already has `--ease:180ms
cubic-bezier(0.16,1,0.3,1)`, `@keyframes fade-up`, `.anim`, and a global
`button:active{transform:scale(0.97)}` — extend, don't duplicate.

- Staggered entrance for list items: `animation-delay: ${i * 35}ms` (the departures list
  already does this — apply the same to the exit-stop list and the spine rows).
- Hover lift on tappable cards: `transform:translateY(-1px)` plus shadow `--sh-sm` → `--sh-md`.
- Keep every transition inside the existing `@media (prefers-reduced-motion: reduce)`
  override, which already neutralises animation and transition durations globally.

## 6. Accessibility

- `aria-label` on every icon-only button — the theme, language, back and play/pause
  controls. The theme and language toggles already set theirs from `STR`
  (`themeAria`, `langAria`); add `backAria` and `playAria` in both languages.
- Minimum 44px touch target on every tappable row and control (`.stop-item` is currently
  smaller than that — raise it via `min-height`).
- Visible focus: the repo uses `outline:2px solid var(--accent); outline-offset:-1px` on
  `.hist-input`. Apply the same treatment to buttons and card-rows rather than relying on
  the default ring.
- Colour is never the only signal: the spine always pairs its rail colour with a text
  label (`← shade` / `shade →` / `even`), and the meter pairs each colour with a number.
  Preserve that when restyling.
- The `board`/`exit`/`flips` flags are meaningful text, not decoration — do not replace
  them with colour-only dots.

---

## Design tokens

All of these already exist in `:root` in `public/index.html` — reuse the variables, do not
hard-code the hexes. Light-theme values shown for reference.

| Token | Light | Dark | Use in v2A |
|---|---|---|---|
| `--bg` | `#f4f2ee` | `#131109` | Intermediate spine dot fill |
| `--surface` | `#faf9f7` | `#1b1916` | Cards |
| `--offset` | `#edeae4` | `#2a271f` | Meter track, finder bar track |
| `--border` | `oklch(0.3 0.01 80 / 0.11)` | `oklch(0.9 0 0/0.08)` | Hairlines |
| `--text` | `#1c1a15` | `#d5d1c5` | Exit dot, status card bg |
| `--muted` | `#6b6960` | `#888478` | Eyebrows, meter key |
| `--faint` | `#b5b2a4` | `#56534b` | Segment meta line |
| `--accent` | `#e05500` | `#ff7c33` | Board dot, primary button, current-dot border |
| `--sun` | `#f5a623` | `#ffc040` | `flips` flag, progress fill, current-dot fill |
| `--left` | `#1a6fbf` | `#5599e8` | Rail where sun is on the right (shade left) |
| `--right` | `#c0392b` | `#e86060` | Rail where sun is on the left (shade right) |
| `--ok` | `#2d7a3a` | `#2db84a` | LIVE badge |
| `--sh-sm` / `--sh-md` | see file | — | Card rest / hover |
| `--r-md` `.625rem` · `--r-lg` `1rem` · `--r-xl` `1.375rem` · `--r-full` | — | — | Radii |
| `--ease` | `180ms cubic-bezier(0.16,1,0.3,1)` | — | All transitions |

**New tokens to add** (both themes):

```css
--rail-neutral: #d9d5ca;   /* dark: #3a4048 — neutral segment rail */
--progress-track: #e3dfd6; /* dark: #2a271f — journey progress gutter */
--status-bg: #1c1a15;      /* dark: #0f1218 — journey status card */
```

Type: `--font: 'DM Sans', system-ui, sans-serif`; weights 700 / 800 / 900 for name,
headline, badge. Numeric readouts use `font-variant-numeric: tabular-nums` — note the
repo standardised on this rather than a monospace family, so **do not** introduce the
design brief's `ui-monospace` stack.

## New strings (add to both `STR.de` and `STR.en`)

| Key | de | en |
|---|---|---|
| `route` | `Die Route` | `The route` |
| `flagBoard` | `einstieg` | `board` |
| `flagExit` | `ausstieg` | `exit` |
| `flagFlips` | `wechsel` | `flips` |
| `shadeLeftLbl` | `← Schatten` | `← shade` |
| `shadeRightLbl` | `Schatten →` | `shade →` |
| `evenLbl` | `neutral` | `even` |
| `sunDownLbl` | `Sonne unten` | `sun down` |
| `follow` | `▶ Fahrt folgen` | `▶ Follow the ride` |
| `stopOf(n,m)` | `Jetzt · Halt ${n} von ${m}` | `Now · stop ${n} of ${m}` |
| `arrived` | `Angekommen` | `Arrived` |
| `done` | `✓ fertig` | `✓ done` |
| `clockSrc` | `Uhrzeit-Schätzung` | `clock estimate` |
| `shadeLineLeft` | `Schatten links ←` | `Shade on the left ←` |
| `shadeLineRight` | `Schatten rechts →` | `Shade on the right →` |
| `shadeLineNone` | `Keine klare Schattenseite` | `No clear shaded side` |
| `stayCool` | `Bleib kühl.` | `Hope you stayed cool.` |
| `backAria` | `Zurück` | `Back` |
| `playAria` | `Abspielen/Pause` | `Play or pause` |

Remember `applyLang()` re-renders the active screen on toggle — make sure the new screens
are covered there, or a language switch will leave the journey view in the old language.

## Suggested implementation order

1. Shade meter (item 2) — smallest, uses numbers already computed in `calcSun()`.
2. Route spine (item 1) — a `renderSpine(legs, stops, stopIdx)` returning a template
   literal, appended in `renderResult()`.
3. Sun bar upgrade (item 3) — small, removes a real inconsistency.
4. Accessibility + motion (items 5, 6) — cross-cutting, low risk.
5. Follow-the-ride (item 4) — new screen, clock/radar-driven; ship last.

Items 1–3 all live inside `renderResult()` / `calcSun()` and touch no fetching logic, so
they are safe to land without going near the Worker or the VBB calls.

## Testing

`npm test` runs two dependency-free suites: the bearing maths and sun-side classification
(including a curved-route flip scenario), and the encrypted history module. It should pass
before any commit.

Worth adding alongside item 1: an assertion that the per-side kilometre totals sum to the
trip's total distance, and that the flip-detection stop reported to the spine is the same
one the existing `flipAt` logic finds. Both are pure functions of `buildLegs` output, so
they fit the existing pure-logic suite.

## Assets

No new image assets. Two notes:

- **Wordmark:** the sun mark is the inline SVG already in the header of
  `public/index.html` (26×26, `circle r=5.5` + eight `line` rays, `stroke-width:2.2`,
  round caps, coloured via `currentColor`). Reuse it; do not substitute an emoji or
  glyph — an earlier prototype pass did exactly that and it was flagged.
- **Favicon:** the existing inline SVG data URI (sun half / shade half) stays as-is.
- Emoji already used in-app (📍 ⚠️ ↪️ 📡 🚋 🚌 🚆 🌙) are part of the current voice;
  the spine and status card use 🚋 and the play glyphs only.

## Files

In this bundle:

| File | What it is |
|---|---|
| `SunSide v2A.dc.html` | The approved v2A prototype — all four screens, interactive. Design reference. |
| `SunSide Review.dc.html` | Annotated prototype-vs-repo comparison with the reasoning behind each item. |
| `README.md` | This document. |
| `SunSide.dc.html`, `support.js` | Only so the two files above open and run offline (the Review page embeds the original v1 prototype). Not implementation targets. |

Open either `.dc.html` directly in a browser — no server needed.

In the repo (targets):

| File | Role |
|---|---|
| `public/index.html` | **The only file that needs to change.** SPA: markup + CSS + JS. |
| `public/history.js` | Encrypted history module — untouched by v2A. |
| `worker/src/index.js` | Caching proxy — untouched by v2A (no new endpoints needed). |
| `docs/design-brief.md` | Original design spec; the spine and meter come from its §4. |
| `test/` | Pure-logic suites to extend. |

Reference: repo `mkoterski/sunside`, branch `main`, at v0.13 (2026-09-01).

## One recommendation beyond the brief

The changelog lists F2's honest caveat: the app is one inline script, so the CSP the
history module's threat model recommends is not in place. Nothing in v2A changes that, but
every item here adds more `innerHTML` rendering of third-party strings — so keep routing
**all** API-derived text through `esc()`, and treat CSP as the next hardening step once
the inline-script constraint is revisited.
