# SunSide — Test Case 3: Aubertstraße 17 → Ferdinandshof Bahnhof

A self-contained, offline prototype for a **long-distance, multi-modal** trip — the first
SunSide case that leaves the Berlin network and runs on regional rail.

## Verified route (corrected)

Per Google Maps and the DB/VBB timetable for this corridor, the trip is:

**Bus 154** (Aubertstr. → S-Bahn) → **S2** (→ S+U Gesundbrunnen) → **RE3** toward Stralsund,
riding to Ferdinandshof. The evening **RE3 departs Gesundbrunnen ~17:32**, matching the
6:45 PM itinerary.

The RE3 stop sequence is the real one, taken from the published line schedule:

> Gesundbrunnen · S Bernau · Eberswalde Hbf · Britz · Chorin · Angermünde ·
> Wilmersdorf (b. Ang.) · Warnitz · Seehausen (UM) · Prenzlau · Nechlin · Pasewalk ·
> Jatznick · **Ferdinandshof** (Anni's stop)

Per-segment bearings and distances are computed from those stations' coordinates
(≈145 km on the RE3 alone).

## Why this case is useful

It exercises behaviour the urban tram cases never reach:

- **Mode-aware suppression** — the Bus 154 hop and the S2 link are marked *"no sun-side
  call"* (too short / too built-up). The recommendation only speaks on the open RE3.
- **Geometry-driven confidence** — the RE3 is mostly northbound but weaves between NE and
  NW (bearings 320°–57° across its segments). That makes the call:
  - **morning** → shade LEFT, 100% (unanimous, high confidence)
  - **evening** → shade RIGHT, 100% (unanimous, high confidence) ← the screenshot's trip
  - **midday** → *mixed*: sit LEFT for 88 of 145 km, with the NW-curving segments
    (Eberswalde→Britz, Angermünde→Prenzlau, the Pasewalk→Ferdinandshof tail) flipping to
    RIGHT. The spine marks every switch.
- **Inferred interchange** — Gesundbrunnen is inferred from the trip, with no explicit
  direction/station picker (consistent with the locked-in UX).

## What's real vs. prototype

- **Real:** RE3 stop sequence, per-segment bearings/distances, the inline NOAA-style
  sun-position math, and the km-weighted verdict.
- **Prototype stand-ins:** departure-time presets, the Bus 154 / S2 access legs (coarse,
  and suppressed anyway), the inferred Gesundbrunnen interchange, and live-GPS tracking.

## Run it

Open `index.html` — no build, no network, no dependencies. Toggle the time row to watch
confidence go High → Mixed → High; tap **▶ Follow the ride** to advance segment by segment
(source badge flips clock→GPS once moving; the last stop lands on Anni's stop).

## Correction note

An earlier draft of this case used RE5 and invented intermediate stops. The line is **RE3**
(as originally specified), and the stops above are the verified sequence.
