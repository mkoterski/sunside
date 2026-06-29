# SunSide prototypes

Self-contained, offline prototypes of SunSide ideas and flows. Each folder is a
single `index.html` you can open directly in any browser — no server, no API, no
build step, no external dependencies. They share the verified sun-position maths
and per-segment shade logic, and each has its own README with the details.

Open [`index.html`](index.html) in this folder for a hub page that links to every
prototype, or jump straight to one from the table below.

The deployed app lives in `public/index.html`; these are exploratory builds, not
the production client.

Folders are numbered in the order they were built; the prefix orders the list
and the rest of the name records the line and route.

| Folder | What it is |
| --- | --- |
| [`010-tram50-hugenottenpl-seestr-demo/`](010-tram50-hugenottenpl-seestr-demo/README.md) | Offline demo of the segment-aware shade logic on one real trip — tram 50, Hugenottenplatz → U Seestraße. |
| [`011-tram50-hugenottenpl-seestr-journey/`](011-tram50-hugenottenpl-seestr-journey/README.md) | Clickable, fully offline prototype of the whole user journey: stops near you → pick line → destination → where to sit. |
| [`012-tram50-hugenottenpl-seestr-autoplay/`](012-tram50-hugenottenpl-seestr-autoplay/README.md) | A second take on the "follow the ride" screen — the journey view auto-advances on a timer, with play/pause and auto-scroll. |
| [`013-aubertstr-ferdinandshof-regional/`](013-aubertstr-ferdinandshof-regional/README.md) | Long-distance, multi-modal regional-rail case — Aubertstraße 17 → Ferdinandshof (bus 154 → S2 → RE3). |
| [`014-m21x21-seestr-goerdelersteg/`](014-m21x21-seestr-goerdelersteg/README.md) | City MetroBus case — Wedding → Goerdelersteg on the M21 / X21 corridor, where the shaded side flips on the final hook to the stop. |
