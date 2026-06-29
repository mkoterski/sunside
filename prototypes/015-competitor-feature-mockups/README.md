# 015 — Competitor-feature integration mockups

Static, annotated mockups exploring how the useful features from existing
"which-side-is-shaded" apps fit into SunSide's own design system — rather than
bolting on a foreign UI. One self-contained `index.html` renders four phone
screens side by side; each extends an existing prototype component.

Open `index.html` directly — no build, no network, no dependencies. The PNGs are
the rendered screens for quick reference.

## Why this exists

Web research turned up several shipping apps that already do shade-side
prediction (ShadeSide, Sunseat, SunRide, Sit In Shade, Sunny Side, Veyil). Before
building more, the question was: what have they proven worth having, and what's
the honest gap SunSide fills?

The short version: **all of them route point-to-point from typed place names
(road/rail geometry or straight lines) — none integrate a real transit network.**
That's the moat. Sit In Shade's own reviewer noted its drawn route didn't match
any actual bus line. SunSide's per-segment, VBB-fed geometry is what makes its
verdict trustworthy on a winding tram route, and it's the one thing the field
can't copy without transit data.

So the goal here was narrow: take the *genuinely good* features, verified by
reading the apps rather than their marketing, and re-express each one in SunSide's
tokens, voice, and the route-spine semantics from the design brief.

## What's in each screen

| # | Screen | Feature folded in | Borrowed from |
|---|--------|-------------------|---------------|
| 1 | Where to sit (result) | **Confidence ring** + **per-side %** + **return-trip toggle** | Sunseat; Sunny Side / Sit In Shade; ShadeSide |
| 2 | Where to sit (result) | **Best-departure finder** tied to real scheduled trams | ShadeSide |
| 3 | Optional map view | **Three-state route map**, extended to be underground-aware | Sit In Shade |
| 4 | Follow the ride (live) | **Honest accuracy framing** + live confidence | SunRide |

### Screen 1 — verdict card, extended
A confidence ring sits top-right of the existing verdict; the shade meter's key
now carries a percentage beside each shaded-km figure. A return-trip toggle (ink
segmented control) lets you check the way back without re-entering the journey.
The confidence number is honest *and* a selling point: per-segment scoring
justifies a higher-confidence claim than any straight-line competitor can make.

### Screen 2 — best-departure finder
ShadeSide compares departure times; SunSide can do it **against real VBB
departures**. Each row is an actual scheduled tram ("in 4 min", "in 9 min"); the
bar shows how much of the ride the *sunny* side is exposed (shorter = shadier),
coloured shade-indigo / sun-amber / tram-red. Tapping a departure recomputes the
verdict below. This is the highest-value feature the competitors structurally
cannot match, because it needs live schedule data.

### Screen 3 — three-state route map
Sit In Shade colours the route line by which side catches sun. Redrawn in SunSide
colours (amber = sun-left → sit right, indigo = sun-right → sit left, grey =
even), and extended with a fourth real state the brief already requires: a
**dashed underground leg** (U6) the shade logic skips, with a plain-language band
explaining it. The map stays a *secondary* view — the brief is explicit that the
spine is the default; this is the optional glance.

### Screen 4 — live ride, honest framing
SunRide is unusually candid that it can't know your specific vehicle. That
candour, made calm and specific: the footer states what the model can't see
(cloud cover, window tint, how loaded the tram is), and the live status card
carries the current leg's confidence so a close call reads as a hint, not a
promise.

## Design fidelity

Everything derives from `misc/SunSide-design-brief.md`:

- **Tokens** — `--sun #F4A024`, `--shade #2B3A55`, `--paper #FBF7EF`,
  `--tram #D6492F`, etc., used verbatim.
- **Semantic colour rule** — amber marks where the sun *hits*; indigo marks
  shade; neutral grey = sun ahead/behind or underground. The new map and meter
  obey this, so colour means the same thing everywhere.
- **Spine** — the signature component is reused unchanged (rail tint, ring dots,
  `board` / `flips` / `exit` / `now` flags, mono bearings + distances).
- **Voice** — plain, calm, a little warm. "Leave a bit later?", "sit anywhere",
  "a hint, not a promise".
- **Phone frame, verdict card, status card** — all match the existing prototypes.

## Deliberate non-choices

- **No natural-language input** (SunRide's parser). For a stop-picker flow it's
  worse than the type-to-filter the prototypes already have — adopting it would be
  copying cleverness, not value.
- **Map kept secondary.** The brief says the spine wins; the map is the optional
  second view, not the landing.
- **Confidence shown, not hidden.** Competitors tend to overpromise a single
  left/right. Surfacing uncertainty (especially on near-midday or twisty routes)
  is more useful and more honest, and SunSide's geometry earns it.

## Provenance / honesty note

ShadeSide and Sunseat were read from their store listings only; their exact
routing method isn't stated there, so "they don't use transit data" is a strong
inference for those two, not a confirmed fact. SunRide and Sit In Shade state
their method (OpenStreetMap routing from typed names), so the differentiation
argument is verified for them. Treat the competitor column as "best reading of
the evidence", not gospel.

## What's real vs mockup

- **Real / from the brief:** all tokens, the spine semantics, the colour rule,
  the tram-50 worked example geometry, the U6→M21 underground case.
- **Mockup stand-ins:** the confidence percentages, departure times, and the
  simplified schematic map (a real build draws the line from VBB trip geometry).
  These are illustrative values to show the *layout*, not computed output.

## Possible next steps

- Wire any one screen into the live `010` (result) or `014` (M21/X21) prototype
  as working code against the existing sun-position maths.
- The best-departure finder is the strongest candidate to prototype for real,
  since it's the clearest transit-native differentiator — needs a few scheduled
  departures and a verdict run per departure.
