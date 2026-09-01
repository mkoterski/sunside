# SunSide Berlin - v0.11

**Status:** DEVELOPMENT
**Versioning:** `v0.x` = development/testing, `v1.x` = production-ready

Tells a Berlin transit rider which side of the vehicle (left or right, relative
to direction of travel) stays in the shade. Pick a departure near you, say where
you get off, and the app answers with one sentence: sit on the left, or the
right. Mobile-first single-page app backed by an edge-cached proxy in front of
the public VBB API, sized for **10-100 concurrent users at zero cost**.

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

## What's in here

| | |
|---|---|
| `public/index.html` | the SPA - THIS is the canonical, deployed app |
| `worker/src/index.js` | Cloudflare Worker: caching proxy + single-flight + budget |
| `test/sun-side.test.mjs` | pure-logic tests for the bearing / sun-side maths |
| `wrangler.toml` | one Worker serves BOTH the SPA and `/api/*` |
| `prototypes/` | numbered self-contained offline prototypes; `prototypes/index.html` is the hub |
| `privacy/` | encrypted journey-history module and its notes |
| `misc/` | design brief and supporting notes |

`prototypes/` (010-015) are exploratory builds, one folder each, every one a
single `index.html` that opens directly in any browser - no server, no API. Only
`public/index.html` is authoritative. See
[`prototypes/README.md`](prototypes/README.md) for the annotated index.

## Features

| | |
|---|---|
| Nearby departures | Geolocation (rounded to ~110 m so nearby users share cache keys) fans out to the 4 closest stops, merged into one live board with delays |
| Demo mode | A fixed Hugenottenplatz location for trying the flow without granting geolocation |
| Exit picker | The trip's real stopover list, boarding stop marked, each later stop tappable |
| Sun-side verdict | Sit left / sit right / neutral, with the sun's azimuth and elevation, computed per segment and distance-weighted |
| Flip warning | When the shaded side genuinely changes mid-trip, the verdict says so instead of averaging it away |
| Live radar | The actual vehicle's GPS position via VBB radar; its live bearing is preferred on single-leg rides |
| Best-departure finder | Ranks the next departures of the same line by sun exposure - and says honestly when they barely differ |
| Theme | Light/dark toggle |
| Language | DE/EN toggle in the header, German default, persisted in `localStorage`. Static markup re-applies via `data-i18n`; the active screen re-renders, so nothing on screen stays behind |
| Favicon | The app's concept as a mark - a sun half and a shade half. Inline SVG data URI, no icon asset to ship |

## Running locally

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
node test/sun-side.test.mjs
```

Covers the bearing maths and sun-side classification, including a curved-route
flip scenario. Should pass before any commit.

## Deploy

**Cloudflare Workers (the real thing).** Free account, no credit card:

```bash
npx wrangler login
npx wrangler deploy
```

Wrangler prints a `https://sunside-berlin.<subdomain>.workers.dev` URL - SPA and
`/api/*` proxy on one origin. `npx wrangler tail` streams logs (watch for
`X-Cache HIT/MISS/COALESCED`); `/healthz` returns remaining tokens, cache size
and in-flight count.

**GitHub Pages (testing only).** Pages is static hosting, so it cannot run the
Worker - but two things still work:

- The **prototypes** are fully offline and run on Pages as-is:
  `https://mkoterski.github.io/sunside/prototypes/`
- The **app** detects a `github.io` host and falls back to calling VBB
  directly: `https://mkoterski.github.io/sunside/public/`. Fine for personal
  testing; it spends the shared 100 req/min bucket the proxy exists to
  protect, so anything beyond that goes through the Worker.

## Versioning and changelog

Follows the NeXtWind script standards (`nxw-script-standards.md` in the parent
`claude-mk` working folder, not published here): development starts at `v0.10`,
every iteration increments by one, every bump gets an entry, newest first,
bug-fix entries name the root cause (NXW-VER-1 to NXW-VER-8). The version
appears in the title above, the changelog below and the startup console banner.
History before v0.10 predates the numbering and is archived by date.

### Changelog

```
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

## License

[CC BY-NC 4.0](LICENSE) - use, share and adapt for **non-commercial** purposes
with attribution. Source-available, not OSI open source.

SunSide Berlin is an independent hobby project, not affiliated with or endorsed
by VBB, BVG, S-Bahn Berlin or Deutsche Bahn.

## Status

Prototype, `v0.11`, DEVELOPMENT. As of the v0.10 fix the full loop works end to
end against live data: departures → exit stop → verdict, with live radar and
the best-departure finder. Verified in one desktop browser; design work is the
next planned step, on top of a client that actually works.
