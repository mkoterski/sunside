# SunSide prototypes

Self-contained, offline prototypes of SunSide ideas and flows. Each folder is a
single `index.html` you can open directly in any browser — no server, no API, no
build step, no external dependencies. They share the verified sun-position maths
and per-segment shade logic, and each has its own README with the details.

The deployed app lives in `public/index.html`; these are exploratory builds, not
the production client.

| Folder | What it is |
| --- | --- |
| [`demo/`](demo/README.md) | Offline demo of the segment-aware shade logic on one real trip — tram 50, Hugenottenplatz → U Seestraße. |
| [`prototype/`](prototype/README.md) | Clickable, fully offline prototype of the whole user journey: stops near you → pick line → destination → where to sit. |
| [`prototype-journey-v2/`](prototype-journey-v2/README.md) | A second take on the "follow the ride" screen — the journey view auto-advances on a timer, with play/pause and auto-scroll. |
| [`prototype-testcase-3/`](prototype-testcase-3/README.md) | Long-distance, multi-modal regional-rail case — Aubertstraße 17 → Ferdinandshof (bus 154 → S2 → RE3). |
