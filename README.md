# SunSide Berlin - v0.16

**Status:** DEVELOPMENT
**Versioning:** `v0.x` = development/testing, `v1.x` = production-ready

Tells a Berlin transit rider which side of the vehicle (left or right, relative
to direction of travel) stays in the shade. Pick a departure near you, say where
you get off, and the app answers with one sentence: sit on the left, or the
right. Mobile-first single-page app backed by an edge-cached proxy in front of
the public VBB API, sized for **10-100 concurrent users at zero cost**.

**Try it:** [sunside-berlin.mkoterski.workers.dev](https://sunside-berlin.mkoterski.workers.dev)

## Repository layout

| | |
|---|---|
| `public/index.html` | the SPA - THIS is the canonical, deployed app |
| `public/history.js` | encrypted local journey history (F2); see [`docs/encrypted-history.md`](docs/encrypted-history.md) |
| `worker/src/index.js` | Cloudflare Worker: caching proxy + single-flight + budget |
| `test/` | pure-logic tests: sun-side maths, history module crypto |
| `wrangler.toml` | one Worker serves BOTH the SPA and `/api/*` |
| `prototypes/` | numbered self-contained offline prototypes; `prototypes/index.html` is the hub |
| `docs/` | design brief, encrypted-history threat model, supporting notes |

`prototypes/` (010-015) are exploratory builds, one folder each, every one a
single `index.html` that opens directly in any browser - no server, no API. Only
`public/index.html` is authoritative. See
[`prototypes/README.md`](prototypes/README.md) for the annotated index.

## Getting started

```bash
npm install
npx wrangler dev
```

Open `http://localhost:8787`. The SPA, proxy and cache behave exactly as in
production. To bypass the proxy and hit VBB directly (isolating a frontend
bug), add one line before the main script in `public/index.html`:

```html
<script>window.SUNSIDE_API='https://v6.vbb.transport.rest'</script>
```

### Tests

```bash
npm test
```

Two suites, no dependencies: the bearing maths and sun-side classification
(including a curved-route flip scenario), and the encrypted history module
(round-trip, wrong-passphrase rejection, no plaintext at rest, dedup, cap,
wipe, KDF floor). Should pass before any commit.

## Deploy

**Cloudflare Workers (the real thing).** Free account, no credit card:

```bash
npx wrangler login
npx wrangler deploy
```

Wrangler prints the live URL - SPA and `/api/*` proxy on one origin.
`npx wrangler tail` streams logs (watch for `X-Cache HIT/MISS/COALESCED`);
`/healthz` returns remaining tokens, cache size and in-flight count.
Deploys are manual: a `git push` updates GitHub Pages, not the Worker.

**GitHub Pages (testing only).** Pages is static hosting, so it cannot run the
Worker - but two things still work:

- The **prototypes** are fully offline and run on Pages as-is:
  [mkoterski.github.io/sunside/prototypes](https://mkoterski.github.io/sunside/prototypes/)
- The **app** detects a `github.io` host and falls back to calling VBB
  directly: [mkoterski.github.io/sunside/public](https://mkoterski.github.io/sunside/public/). Fine for personal
  testing; it spends the shared 100 req/min bucket the proxy exists to
  protect, so anything beyond that goes through the Worker.

## Why it is built like this

- **One canonical client.** `public/index.html` holds the whole SPA - markup,
  CSS and JS. No build step, no framework, no dependencies.
- **A proxy, because the upstream limit is shared.** The public VBB instance
  (`v6.vbb.transport.rest`) allows 100 req/min globally, keyed by IP. If every
  browser called it directly, a heatwave crowd would exhaust that bucket and
  everyone would get 429'd. The Worker is the only client talking to VBB, so
  the limit is managed centrally:
  - *Per-endpoint caching* - stop locations for hours, departure boards ~25s,
    trip geometry ~120s, live radar ~8s.
  - *Single-flight coalescing* - N simultaneous misses for one key trigger one
    upstream fetch, fanned out to all waiters.
  - *Egress token bucket* - hard ceiling of 80/min; when exhausted it serves
    slightly-stale cache instead of getting hard-429'd.
- **Segment-aware, not one-bearing.** The recommendation walks every leg
  between boarding and exit, weights each by distance, picks the dominant
  shaded side and warns when the side flips mid-trip - the single-bearing
  shortcut gives wrong answers on curved routes (the Ringbahn being the
  obvious case).
- **Zero cost.** Everything runs on the Cloudflare Workers free tier. No KV,
  no Durable Objects. The cache is in-memory per isolate plus Cloudflare's
  asset cache; static hits are not even billed as Worker invocations.

## Features

| | |
|---|---|
| Nearby departures | Geolocation (rounded to ~110 m so nearby users share cache keys) fans out to the 4 closest stops, merged into one live board with delays |
| Demo mode | A fixed Hugenottenplatz location for trying the flow without granting geolocation |
| Exit picker | The trip's real stopover list, boarding stop marked, each later stop tappable |
| Sun-side verdict | Sit left / sit right / neutral, with the sun's azimuth and elevation, computed per segment and distance-weighted |
| Route spine | Travel-order stop list on the result screen; the rail between stops is tinted by which side the sun strikes on that segment, with board/exit/flips flags and per-segment bearing + km |
| Shade meter | Distance-weighted km bar in the verdict card: shade-left / even / shade-right, each share paired with its number |
| Follow the ride | Journey view reached from the verdict: pinned status card (current segment, shade side, clock-estimate vs live-GPS source), the spine with current/passed states, a vertical progress bar, auto-follow with pause, and a replay once arrived. Clock/radar-driven, not a demo timer |
| Flip warning | When the shaded side genuinely changes mid-trip, the verdict says so instead of averaging it away |
| Live radar | The actual vehicle's GPS position via VBB radar; its live bearing is preferred on single-leg rides |
| Best-departure finder | Ranks the next departures of the same line by sun exposure - and says honestly when they barely differ |
| Theme | Light/dark toggle |
| Language | DE/EN toggle in the header, German default, persisted in `localStorage`. Static markup re-applies via `data-i18n`; the active screen re-renders, so nothing on screen stays behind |
| History | Opt-in, passphrase-gated, encrypted journey history - device-only, zero-knowledge at rest (AES-GCM, PBKDF2). Each verdict saves the ride; matching departures and the remembered exit stop get a "recent" tag. Lock and clear controls on the card; forgotten passphrase = gone, by design. See [`docs/encrypted-history.md`](docs/encrypted-history.md) |
| Favicon | The app's concept as a mark - a sun half and a shade half. Inline SVG data URI, no icon asset to ship |

## Versioning and changelog

Follows the NeXtWind script standards (`nxw-script-standards.md` in the parent
`claude-mk` working folder, not published here): development starts at `v0.10`,
every iteration increments by one, every bump gets an entry, newest first,
bug-fix entries name the root cause (NXW-VER-1 to NXW-VER-8). The version
appears in the title above, the changelog below and the startup console banner.
History before v0.10 predates the numbering and is archived by date.

### Changelog

```
v0.16  2026-09-01  Fixed: during a VBB outage the app hung on the loading
                   screen indefinitely, which on a phone reads as "app broken".
                   Root cause: no timeout anywhere in the chain - a downed VBB
                   stalls connections rather than refusing them, the Worker
                   waited on it forever and the client waited on the Worker.
                   Now the Worker aborts upstream after 8s (then serves stale
                   cache or an honest 502) and every client API call aborts
                   after 12s; a 5xx or timeout shows a new honest "data source
                   is down, try again in a few minutes" state in both languages
                   instead of blaming the user's connection.

v0.15  2026-09-01  F3 landed - v2A part 2, follow-the-ride: a journey screen
                   off the verdict. Dark status card (stop n of m, current
                   segment, shade side, clock-estimate vs live-GPS badge),
                   the spine reused with current/passed row states, vertical
                   progress bar, auto-follow via scrollTop (not scrollIntoView)
                   with pause, replay in the arrived state. Clock/radar-driven;
                   show() clears the ticker on leaving the screen. New pure
                   assertions for the clock index (before/between/past/missing
                   arrivals). The spine row builder is shared, not duplicated.

v0.14  2026-09-01  v2A design pass, part 1 (docs/design-handoff-v2a.md): the app
                   finally shows the per-segment analysis it always computed.
                   Route spine on the result screen (rail tinted by sunny side,
                   board/exit/flips flags), shade meter with per-side km in the
                   verdict card, sun bar now shows the analysed departure time
                   instead of contradicting the finder, plus a11y (44px targets,
                   keyboard-tabbable rows, focus rings) and motion polish. Two
                   new pure-logic assertions: meter km shares sum to the trip
                   total; the spine's flip tag matches the flipAt logic.
                   Follow-the-ride (item 4) is deferred to its own release.

v0.13  2026-09-01  F2 landed: the encrypted history module is integrated. The
                   start screen gets an opt-in card (set passphrase / unlock /
                   lock / clear); every verdict saves the ride; matching
                   departures and the remembered exit stop show a "recent"
                   tag. Module moved lib/ → public/history.js so it deploys;
                   its doc moved to docs/encrypted-history.md. Its README
                   claimed 18 test assertions that were not in the repo -
                   test/history.test.mjs now holds 22, wired into npm test.

v0.12  2026-09-01  Repo tidy-up, no behavior change: misc/ renamed to docs/,
                   privacy/ renamed to lib/encrypted-history/ (it is a module,
                   not a topic), README reordered so getting started comes
                   before the rationale, .claude/ ignored. The history module
                   is tracked as F2 now instead of sitting unexplained.

v0.11  2026-09-01  F1 landed: DE/EN toggle in the header, German default,
                   persisted. All copy moved into one STR dictionary per
                   language, written as native copy. Added the favicon.
                   Fixed (caught in verification): a local `const t` in two
                   render functions shadowed the translation function t(),
                   so the stop list threw on render.

v0.10  2026-09-01  Adopted NXW versioning; rewrote this README. Fixed: the
                   exit-stop list never rendered - v6 wraps /trips payloads as
                   {trip:{...}} but the client read stopovers off the top
                   level, so the core flow was unreachable. Added a github.io
                   API fallback so a Pages copy works for testing.

────────────────────────────────────────────────────────────────────────────
Pre-versioning history, by date.

2026-06-30  Best-departure finder in the app; competitor-feature mockups (015).
2026-06-29  Offline prototypes 010-014 plus hub page; encrypted history module;
            archive/ renamed to prototypes/.
2026-06-28  Initial build: sun-side bearing maths, VBB proxy Worker, SPA,
            tests, license. Fixed: a literal </script> inside a comment ended
            the script element early and broke all JS.
```

## Roadmap

Deliberately not built yet. The IDs are stable, so a changelog entry can quote
one when an item lands.

### Planned features

Nothing open right now.

### Settled

Decided or built, kept here so the IDs are not reused.

| ID | Settled | Decision |
|---|---|---|
| F1 | 2026-09-01 | Landed in v0.11 as a DE/EN toggle in the header, German default, persisted in `localStorage`. |
| F2 | 2026-09-01 | Landed in v0.13: encrypted history integrated as an opt-in card on the start screen, saves on every verdict, surfaces "recent" tags. One honest caveat from the module's own threat model stands: the app is one inline script, so the CSP hardening the module recommends against XSS is not in place yet - the encryption at rest is real either way. |
| F3 | 2026-09-01 | Landed in v0.15: follow-the-ride journey screen per [`docs/design-handoff-v2a.md`](docs/design-handoff-v2a.md) §4. Clock/radar-driven; the replay button animates the ride once more after arrival. With this, the whole v2A handoff is implemented. |

### Architecture upgrades

The PoC and the future share one diagram -
`client -> edge cache -> data source` - and each box upgrades in place:

- Swap `UPSTREAM` for a self-hosted `vbb-rest` instance to drop the
  shared-rate-limit dependency. Only that constant changes.
- Move the cache to KV or Redis so it survives restarts and spans isolates.
- Wire Worker logs into observability - cache hit ratio and upstream 429s
  become signals you watch before they bite.
- For anything public or commercial: move to the official VBB / GTFS data path
  and check the data-licence terms.

## Data source

The community-run `v6.vbb.transport.rest` wraps an unofficial VBB endpoint -
great for a hobby PoC, not official or guaranteed. Be a good neighbour: the
proxy exists partly so this project does not hammer that shared instance.
It also has real outages (three observed on 2026-09-01 alone). During one the
Worker aborts the upstream call after 8s and serves stale cache when it has
any; the app fails fast to an honest "data source is down" state when it does
not.

## License

[CC BY-NC 4.0](LICENSE) - use, share and adapt for **non-commercial** purposes
with attribution. Source-available, not OSI open source.

SunSide Berlin is an independent hobby project, not affiliated with or endorsed
by VBB, BVG, S-Bahn Berlin or Deutsche Bahn.

## Status

Prototype, `v0.16`, DEVELOPMENT. The full loop works end to end against live
data: departures → exit stop → verdict with route spine and shade meter →
follow-the-ride, with live radar, the best-departure finder and opt-in
encrypted history, in German and English, deployed at the URL above. Verified
in one desktop browser. The v2A design handoff is fully implemented.
