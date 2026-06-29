# SunSide — Design Brief

A design specification for **SunSide Berlin**, a mobile-first web app that tells public-transit
riders which side of a vehicle (left or right, relative to travel direction) stays in the shade,
based on the sun's position and the route's geometry. This document is written to be imported into
Claude Design as the source of truth for recreating or extending the UI.

---

## 1. Product in one line

You're about to board a tram/bus/train in the sun. SunSide tells you **which side to sit on to stay
in the shade** — computed per segment of your specific trip, weighted by distance, with the
recommendation shifting by time of day.

## 2. Brand & voice

- **Tone:** practical, calm, a little warm. It's a small daily-life utility, not a serious transit
  app. Plain language ("Sit on the left"), never jargon.
- **Name styling:** "Sun" in ink, "Side" in sun-amber, set in a heavy uppercase grotesque.
- **Personality cue:** the whole UI should *feel* like sun and shade — warmth vs cool shadow — not
  like a data dashboard.

## 3. Design tokens

### Color
| Token | Hex | Use |
|---|---|---|
| `--sun` | `#F4A024` | Sun side, amber accents, progress, "Side" in logo |
| `--sun-soft` | `#FBD9A0` | Muted sun tints |
| `--shade` | `#2B3A55` | Shade side (deep indigo), shaded-side rail |
| `--shade-soft` | `#9FB0C9` | Muted shade text on dark cards |
| `--paper` | `#FBF7EF` | App background (warm daylight paper) |
| `--card` | `#FFFFFF` | Card surfaces |
| `--ink` | `#1C232E` | Primary text, dark status card |
| `--slate` | `#6B7280` | Secondary text, labels |
| `--tram` | `#D6492F` | Primary action, boarding marker, Berlin-tram red accent |
| `--line` | `#E4DDCE` | Hairline borders, inactive track |
| `--neutral` | `#C9C2B2` | Disabled, neutral rail (sun ahead/behind) |

**Semantic mapping (important):** the *shaded seat* is the recommendation. Sun-amber marks where the
sun hits; indigo marks shade. On a route segment, the rail is amber if the **left** seat catches sun
(so shade is right) and indigo if the **right** seat catches sun. Neutral grey = sun ahead/behind, no
clear side.

### Type
- **Display / headings:** Helvetica Neue / Arial, weight 800, tight letter-spacing (`-0.02em`),
  uppercase for the wordmark and section eyebrows.
- **Body:** system sans (-apple-system / Segoe UI / Roboto), 0.8–0.95rem.
- **Data (bearings, distances, times, counts):** monospace (`ui-monospace`, SF Mono, Menlo) — the
  numbers should read like instrument readouts.
- **Eyebrows / labels:** 0.64rem, uppercase, letter-spacing `0.12–0.15em`, slate, weight 700.

### Shape & depth
- Radii: cards 12–14px, pills 4–9px, buttons 11–13px, circular markers/badges full.
- Borders: 1px `--line` for cards; 1.5px `--ink` for emphasis/selected.
- Shadows: soft and sparing. Phone frame uses a large soft drop shadow + 9–10px solid `#111` ring.
- Spacing: 1.1rem screen padding; 0.5–0.7rem between list rows.

### Motion
- Gentle. Transitions ~0.4–0.6s ease. The seat-recommendation arrow does a small directional nudge.
- **Always** honor `prefers-reduced-motion: reduce` (disable animations/transitions).

## 4. Signature visual: the route spine

The defining component. A vertical list of stops where each segment between stops is **tinted by which
side is shaded**:
- Left rail of each row: amber (`--sun`) if sun hits left → shade right; indigo (`--shade`) if sun
  hits right → shade left; neutral grey if ahead/behind.
- Each stop = a small ring dot on the rail. Boarding = filled tram-red, larger. Exit = filled ink.
  Current (in journey mode) = amber fill, tram-red border, amber glow.
- Each row shows: stop name (+ flags), and below it the segment's bearing + distance in mono
  (`211° SW · 0.42 km`). Right-aligned: `shade →` / `← shade` / `even`.
- **Flags:** `board` (tram-red), `exit` (ink), `flips` (amber — shade side changes here),
  `now` (amber — current position in journey mode).

This spine appears on the result screen (static) and the journey screen (with live current-position
highlight + vertical progress bar).

## 5. Components

- **Phone frame:** max-width ~400px, radius 30–34px, solid dark ring, notch. (Prototype framing; the
  real app is full-bleed responsive.)
- **Context bar:** rounded card holding editable Location / Date / Time / Radius. Date & time are
  native inputs (mono font); radius is a slider with a mono value readout.
- **Stop card:** white rounded card; stop name, a row of line pills, distance in mono on the right.
- **Line pill:** small colored rounded chip with the line number. Color by mode — tram `--tram`,
  bus `#6b4ea0`, U-Bahn `#1f6fb2`, S-Bahn `#2e8b57`.
- **Direction bar:** active-direction heading ("→ toward X") with a "⇄ Flip" button; a small
  "Other way: …" hint below.
- **Filter input:** full-width rounded text field, "Type a destination stop…" placeholder.
- **Stop row (destination list):** rounded card, stop name + "N stops" in mono.
- **Verdict card:** bordered card. Eyebrow "Where to sit"; large headline "Sit on the **left/right**"
  with the direction word in tram-red and a **directional arrow badge** (rounded tram-red square,
  white chevron) pointing left or right; a one-line plain-language explanation. Below: a horizontal
  **shade meter** (three proportional segments: right=indigo, even=neutral, left=amber) with a key
  showing shaded-km per side.
- **Directional arrow:** shown only when one side clearly wins and the sun is up; hidden for
  "either side" / sun-down. One SVG chevron, mirrored via `scaleX(-1)` for the right case.
- **Status card (journey):** dark (`--ink`) card; amber eyebrow "Now · stop N of M"; current segment
  "A → B"; shade line; a play/pause button (amber circle) with status text; a source badge
  ("◐ clock" / "📡 GPS").
- **Vertical progress bar (journey):** thin track down the left of the route list; amber fill rising
  to the current stop; a glowing amber dot marking current position. (Approved as a separate gutter
  beside the route's own shade rail.)
- **Primary button:** full-width, tram-red, white, weight 700, radius 13px. Ghost variant = white
  with ink border.

## 6. Screens & flow

The app is a four-step journey. Selections advance immediately — **no confirm buttons**; tapping a
choice navigates.

### Screen 1 — Stops near you
- Wordmark header.
- Context bar: Location (auto, editable), Date (auto, editable), Time (auto, editable), Radius slider
  (200–1200 m). Changing date/time changes the sun and therefore every downstream recommendation.
- List of nearby stop cards within the radius, each with line pills + distance. Tapping a stop →
  Screen 2.

### Screen 2 — Line → destination
- Title = the chosen stop. Step A: "Choose your line" — tap a line pill row.
- Step B: "Where are you going?" — shows **only the forward direction's stops** by default under a
  "→ toward X" heading, with a "⇄ Flip" button to switch direction, and a type-to-filter field.
  Tapping a destination stop → Screen 3. (Direction is inferred from the chosen stop; never asked.)
- Back is step-aware: from stop list → line choice; from line choice → Screen 1.

### Screen 3 — Where to sit (the result)
- Line pill + "boarding → destination" route summary.
- Verdict card: arrow + "Sit on the left/right" + explanation + shade meter + per-side km.
- "▶ Follow the ride" button → Screen 4.
- The full route spine (static), with `board`, `flips`, `exit` flags.

### Screen 4 — Follow the ride (auto-advancing) — **v2**
- Status card pinned at top with the current segment, shade side, and **play/pause** control.
- The ride **auto-advances on a timer** (no dragging). In the real app this is driven by the live
  clock against scheduled stop times, switching to **GPS** (transit radar) when the vehicle is located
  — the source badge reflects which is in use.
- The route list **auto-scrolls** to keep the current stop **near the top** (~70px down), with
  upcoming stops below and passed stops dimmed above.
- A **vertical progress bar** down the left tracks position (replacing any horizontal slider); its
  fill and glowing dot mark how far along the ride you are. Bar direction = list direction (down =
  forward).
- Arriving at the destination stops the timer and shows an "Arrived" state (tap to replay).

## 7. Worked example (use as the canonical demo data)

**Tram 50, Hugenottenplatz → U Seestraße, Berlin.** A long ride that runs south through Pankow then
turns west into Wedding — so the shaded side can flip mid-trip, which is the whole point of
per-segment analysis. ~28 segments. Real stop coordinates exist for this route. At low morning/evening
sun the verdict is a strong single side; near midday it's a narrow call because much of the route runs
toward the southern sun (neither side shaded).

## 8. Accessibility & states

- Honor reduced-motion.
- Empty/no-match states: friendly text ("No stops within X m — widen the radius"; "No stops match …
  — flip the direction").
- Sun-below-horizon: verdict becomes "either side", arrow hidden, copy explains no direct sun.
- Touch targets ≥ ~40px; selection = navigation, so every tappable row must feel tappable
  (active-state scale ~0.99).

## 9. Out of scope / notes for design

- Map view (route on OpenStreetMap) is an *optional* secondary view, not the default — a glance-first
  utility favors the spine over a map.
- A faster future flow worth exploring: type-to-search the destination directly and skip line
  selection (line + direction both fall out of the destination).
- Real data (stops, lines, trip geometry, live position) comes from the VBB transit API in the
  production app; prototypes use fixed sample data.
