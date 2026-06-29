# SunSide demo — Tram 50 shade analysis

A self-contained, offline demo of SunSide's segment-aware shade logic, built around
one real Berlin trip: **tram 50 between Hugenottenplatz and U Seestraße**.

Open `index.html` in any browser. No server, no API, no build step, no external
dependencies — coordinates and sun-position maths are baked in.

## What it shows

- **The verdict** — which side of the tram (left or right, in the direction of
  travel) stays shaded for most of the ride, with the distance margin and a
  plain-language explanation.
- **A shade meter** — the three-way split of the route by shaded side
  (right / even / left), weighted by distance.
- **Stop-by-stop breakdown** — all 28 segments, each with its compass bearing,
  length, and which side the sun strikes. The rail tint encodes the shaded side;
  flags mark boarding, the exit stop, and any point where the shaded side flips.
- **A time slider and direction toggle** — scrub through the day to watch the
  recommendation shift as the sun moves, or reverse the trip.
- **An optional map view** — tap "Show map" to plot the route on OpenStreetMap
  (via Leaflet), with the line colored by shaded side per segment. This is the one
  feature that needs a connection (for map tiles and the Leaflet library); it loads
  only when you open it, so the rest of the demo stays fully offline. If it can't
  load, it falls back to a clear message and the offline list still works.

## Why it exists

The live app needs VBB's API to fetch trip geometry. This demo hardcodes one real
route so the segment logic can be shown end-to-end without any network call — useful
for demonstrating the idea when the public API is slow or down, and as a visual
reference for how the per-segment weighting produces a single recommendation.

## Notes on accuracy

- Stop coordinates are real (anchor stops from public map data; a few intermediate
  stops are interpolated along the known street route). The stop *list* itself is
  approximate — public route maps disagree on a stop or two, and the full line runs
  ~32 stops end to end while this trip is a subset. The authoritative per-trip
  sequence and exact coordinates come from VBB's live trip data in the real app.
- Sun position uses an inline NOAA-based algorithm, verified to match the SunCalc
  library within 0.1° across a full day.
- The midday verdict for this route is genuinely close (the route runs largely
  toward the southern sun, so much of it shades neither side); the recommendation is
  clearest in the morning and evening when the sun is low and to one side. The slider
  makes this easy to see.
