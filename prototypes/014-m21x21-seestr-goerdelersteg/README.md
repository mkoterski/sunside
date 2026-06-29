# SunSide — M21 / X21: Wedding → Goerdelersteg

A self-contained, offline prototype for a **city MetroBus** trip across the
northwest of Berlin: from the Wedding/Seestraße area to **Goerdelersteg**
(satis&fy AG, Lise-Meitner-Straße 45, Charlottenburg-Nord).

Open `index.html` in any browser. No server, no API, no build step, no external
dependencies — the stop coordinates and sun-position maths are baked in.

## The route

The shade-relevant leg is the **M21 toward Goerdelersteg**, boarding at
**U Kurt-Schumacher-Platz** and riding to **Goerdelersteg** — 9 stops, ~5.3 km.
The **X21** runs the same Kurt-Schumacher-Platz → Goerdelersteg corridor as an
express, hence the M21 / X21 framing.

The stop sequence and per-segment bearings are real, taken from OpenStreetMap
(BVG line M21, direction Goerdelersteg). The interesting bit is the shape of the
run: the bus heads **southwest** down past the Westhafen canal bridges
(Aristide-Briand-, Hinckeldey-, Weltlingerbrücke) toward Jungfernheide, then
**hooks northeast** for the final stop to Goerdelersteg — so the shaded side
flips near the end at every time of day.

## What it shows

- **The verdict** — which side of the bus stays shaded for most of the ride,
  km-weighted, with a confidence read and a plain-language explanation.
- **A shade meter** — the split of the route between the winning side and the rest.
- **Stop-by-stop spine** — all 8 segments, each tinted by shaded side, with the
  board / get-off markers and the point where the side flips.
- **A time-of-day toggle** — morning / midday / evening; scrub it to watch the
  recommendation move with the sun (and the flip switch sides).
- **Follow the ride** — an auto-advancing journey view that plays the bus forward
  segment by segment, flipping the source badge from clock estimate to live GPS.

## What's a stand-in

The U6 + walk access leg from Wedding, the time of day, and the live tracking are
prototype stand-ins. Everything in the M21 leg — stops, coordinates, bearings,
and the sun maths — is the verified version shared with the other prototypes.
