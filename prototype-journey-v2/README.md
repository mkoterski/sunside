# SunSide journey prototype — v2 (auto-advancing)

A second take on the "follow the ride" screen, in one self-contained offline HTML file. Same flow as
the main prototype (stops → line → destination → result), but the journey view is redesigned:

- **Auto-advances on a timer** — the ride plays forward by itself, ~2.2s per segment. No dragging.
- **Play / pause** control in the status card; arriving at the destination shows an "Arrived" state
  (tap to replay).
- **Auto-scroll** — the route list keeps the current stop near the top, upcoming stops below, passed
  stops dimmed above.
- **Vertical progress bar** down the left of the list (replaces the old horizontal slider); its amber
  fill and glowing dot mark position. Bar direction matches list direction (down = forward).
- **Source badge** flips from "◐ clock" at the start to "📡 GPS" once moving, mirroring how the real
  app would use the live clock then switch to GPS (transit radar) when the vehicle is located.

Everything else (sun maths, per-segment shade logic, tram 50 data) is the verified version shared
with the other prototypes. Fully offline, no dependencies.

Open `index.html`, walk the flow (Hugenottenplatz → 50 → U Seestr.), tap **▶ Follow the ride**, and
watch it play.
