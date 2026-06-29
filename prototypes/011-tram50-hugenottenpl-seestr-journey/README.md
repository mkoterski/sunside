# SunSide journey prototype

A clickable, fully offline prototype of the whole SunSide user journey, in one
self-contained HTML file. No API, no network, no build — open `index.html`.

It uses the verified tram 50 (Hugenottenplatz → U Seestraße) route as the worked
example, with the same sun-position maths and shade logic as the live app.

## The four steps

1. **Stops near you** — a list of nearby stops within an adjustable radius. Location,
   date, and time are pre-filled (as if auto-detected) and all editable; changing the
   date/time changes the sun and therefore the recommendation.
2. **Pick line → destination** — tap a stop, tap a line, then tap where you're
   getting off. By default only the forward direction's stops are listed (under a
   "toward X" heading); a "⇄ Flip" button switches to the other direction. A
   type-to-filter field lets you jump straight to a destination by name. The
   direction is inferred from the chosen stop, so you never pick it explicitly, and
   every tap advances immediately — there are no confirm buttons.
3. **Where to sit** — the result screen (the previously built demo): the left/right
   verdict with directional arrow, the distance-weighted shade meter, and the full
   stop-by-stop breakdown.
4. **Follow the ride** — a live journey view that highlights the segment you're
   currently on and shows which side is shaded right now. Drag the simulate control to
   move along the trip.

## What's real vs faked

- **Real:** the tram 50 route geometry, the sun-position calculation, the per-segment
  bearing/shade logic, the distance weighting, the flip detection.
- **Faked (prototype only):** the nearby-stop list and distances are fixed sample
  values; only tram 50 at Hugenottenplatz is wired with full route data (other
  lines/stops show a placeholder). "Follow the ride" is driven by a manual simulate
  slider, not a real clock or GPS.

## Notes on the live version

- Step 1's stops, Step 2's lines and destinations, and Step 3's route geometry
  would all come from the VBB API in the real app. (Direction is derived from the
  chosen destination, not asked separately.)
- Step 4 ("follow the ride") would update from the live clock against scheduled stop
  times, switching to GPS position (VBB radar) when the vehicle is located — the
  prototype shows both states (the source badge flips from "clock estimate" to "live
  GPS" as you scrub past the start).
