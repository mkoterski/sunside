# SunSide Berlin - v0.20

**Status:** DEVELOPMENT
**Versioning:** `v0.x` = development/testing, `v1.x` = production-ready

Tells a transit rider which side of the vehicle (left or right, relative to
direction of travel) stays in the shade. Berlin and Brandenburg run on VBB's
own data, with VBB's official ReST API wired in alongside since v0.19; the
rest of Germany, Mecklenburg-Vorpommern included, runs on Transitous. Pick a departure near you, say where
you get off, and the app answers with one sentence: sit on the left, or the
right. Mobile-first single-page app backed by an edge-cached proxy in front of
the public VBB API, sized for **10-100 concurrent users at zero cost**.

**Try it:** [sunside-berlin.mkoterski.workers.dev](https://sunside-berlin.mkoterski.workers.dev)

## Repository layout

| | |
|---|---|
| `public/index.html` | the SPA - THIS is the canonical, deployed app |
| `public/history.js` | encrypted local journey history (F2); see [`docs/encrypted-history.md`](docs/encrypted-history.md) |
| `worker/src/index.js` | Cloudflare Worker: three upstreams (VBB ReST, VBB HAFAS, Transitous), normalised to one API, with caching + single-flight + budget |
| `test/` | pure-logic tests: sun-side maths, history module crypto, provider parsing |
| `wrangler.toml` | one Worker serves BOTH the SPA and `/api/*` |
| `prototypes/` | numbered self-contained offline prototypes; `prototypes/index.html` is the hub |
| `docs/` | design brief, encrypted-history threat model, [VBB API access](docs/vbb-api-access.md), supporting notes |
| `.dev.vars.example` | template for the local secrets file; copy to `.dev.vars` (gitignored) |

`prototypes/` (010-015) are exploratory builds, one folder each, every one a
single `index.html` that opens directly in any browser - no server, no API. Only
`public/index.html` is authoritative. See
[`prototypes/README.md`](prototypes/README.md) for the annotated index.

## Getting started

```bash
npm install
cp .dev.vars.example .dev.vars   # then paste the VBB access id into it
npx wrangler dev
```

Open `http://localhost:8787`. The SPA, proxy and cache behave exactly as in
production.

The access id is the one VBB mailed us for their ReST test system. `.dev.vars`
is gitignored and the id never belongs in the repository or in the SPA - see
[`docs/vbb-api-access.md`](docs/vbb-api-access.md). Leaving it unset is a
supported state, not a broken one: the VBB ReST provider switches off and the
Worker runs on the mgate endpoint and Transitous, exactly as in v0.18. To bypass the proxy and hit VBB directly (isolating a frontend
bug), add one line before the main script in `public/index.html`:

```html
<script>window.SUNSIDE_API='https://v6.vbb.transport.rest'</script>
```

### Tests

```bash
npm test
```

Three suites, no dependencies: the bearing maths and sun-side classification
(including a curved-route flip scenario); the encrypted history module
(round-trip, wrong-passphrase rejection, no plaintext at rest, dedup, cap,
wipe, KDF floor); and the provider layer (stop-id shapes across feeds, HAFAS
and ReST time parsing across both DST switches and past midnight, the two
providers agreeing on one instant, ReST response shapes and line names, the
id namespaces, and the four boarding-stop rules). Should pass before any
commit.

## Deploy

**Cloudflare Workers (the real thing).** Free account, no credit card:

```bash
npx wrangler login
npx wrangler secret put VBB_ACCESS_ID   # once per account; the id VBB mailed us
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
- **The Worker talks to the data sources itself.** It speaks VBB's official
  ReST API, VBB's HAFAS protocol and Transitous' REST API directly and
  normalises all three to one shape, so the SPA is provider-agnostic and a bad
  day at one upstream is not a bad day for the app. Stop and trip ids are
  namespaced (`v~` / `h~` / `m~`) and round-trip through the client, which
  keeps follow-up calls on the provider that issued them. Being the only client also means the load is managed
  centrally:
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
| Nearby departures | Geolocation (rounded to ~110 m so nearby users share cache keys) fans out to the 4 closest stops, merged into one live board with delays. One card per line and direction, so overlapping stops cannot crowd a line off the list; each card shows the walk to its boarding stop |
| Transport filter | Chips above the board for S-Bahn / U-Bahn / Tram / Bus, multi-select, persisted. Counts come from the unfiltered board, so a chip says what picking it gives you. Filtering is client-side, so every combination shares one proxy cache key |
| Refresh | Re-reads the GPS fix, not just the board. The location label prints the coordinates, accuracy and time of the fix, so a refresh is visibly a new one |
| Demo mode | A fixed Hugenottenplatz location for trying the flow without granting geolocation |
| Exit picker | The trip's real stopover list, boarding stop marked, each later stop tappable |
| Sun-side verdict | Sit left / sit right / neutral, with the sun's azimuth and elevation, computed per segment and distance-weighted |
| Route spine | Travel-order stop list on the result screen; the rail between stops is tinted by which side the sun strikes on that segment, with board/exit/flips flags and per-segment bearing + km |
| Shade meter | Distance-weighted km bar in the verdict card: shade-left / even / shade-right, each share paired with its number |
| Follow the ride | Journey view reached from the verdict: pinned status card (current segment, shade side, clock-estimate vs live-GPS source), the spine with current/passed states, a vertical progress bar, auto-follow with pause, and a replay once arrived. Clock/radar-driven, not a demo timer |
| Flip warning | When the shaded side genuinely changes mid-trip, the verdict says so instead of averaging it away |
| Live radar | The actual vehicle's GPS position via VBB radar (Berlin + Brandenburg only). Position, not heading: HAFAS's radar call will not return a passlist, so the bearing comes from stop geometry - which is the better source on anything but a dead-straight single leg |
| Official data path | VBB's own ReST API under an issued access id since v0.19, as the fallback inside Berlin/Brandenburg and one env var away from leading. It stays second for now because the test system serves timetable data only - no prognoses, no vehicle positions - and live delays are worth more to a rider than provenance. Boards fall back between the two with the stop id unchanged, since both name a stop by its station number |
| Coverage beyond Berlin | Mecklenburg-Vorpommern and the rest of Germany via Transitous, picked automatically from where you are, with a visible attribution line when it serves |
| Regional rail | Included since v0.18 - outside Berlin it is often the only service on a route, and a 40-minute regional ride is where the sun side matters most |
| Best-departure finder | Ranks the next departures of the same line by sun exposure - and says honestly when they barely differ |
| Theme | Light/dark toggle |
| Footer | The build number on every screen, linking to the project page. One constant feeds it and the console banner, so the two cannot drift |
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
v0.20  2026-09-22  Fixed: the transport filter hid its own options. The chip
                   row scrolled sideways with the scrollbar hidden for looks,
                   so on a 390 px phone Bus and Regional sat past the right
                   edge with nothing on screen saying they existed - reported
                   from a live board where only four of six chips were
                   reachable. The row now wraps to two lines and every chip
                   is visible without a gesture nobody knew to make. Added:
                   the build number in the footer, linking to the project
                   page, so a tester reporting "the board looked wrong" can
                   say which build they were looking at without opening the
                   console.

v0.19  2026-09-22  VBB granted access to the test system of their official
                   ReST interface, so the Worker now speaks the documented,
                   supported contract as well as the web app's private one
                   (F9). It is wired in as the fallback inside Berlin and
                   Brandenburg, not ahead of mgate, and the reason is
                   measured rather than cautious: the test system carries no
                   realtime at all - every board answered rtTime null,
                   planRtTs sits at the epoch, rtMode rejects REALTIME and
                   journeyPos returns nothing - so leading with it would
                   trade live delays, the LIVE badge and the radar for better
                   provenance. VBB_REST_PRIMARY=true promotes it in one step
                   when the production system is unlocked. Boards fall back
                   between the two VBB sources with the stop id unchanged,
                   since both name a stop by its station number; journey
                   references cannot and say so. Nearby stops arrive per
                   platform there and are collapsed onto their mast, or two
                   of the SPA's four stop slots would go to one place. The
                   access id is a Worker secret, absent from this repository
                   and from the SPA; without it the provider is off and v0.18
                   behaviour stands. See docs/vbb-api-access.md.

v0.18  2026-09-21  The Worker now talks to VBB's HAFAS and to Transitous
                   directly instead of proxying v6.vbb.transport.rest (F7/F8).
                   Root cause of the recurring outages: that shared community
                   instance, not VBB - measured in one minute, VBB's own HAFAS
                   answered in 176 ms while the instance timed out after 12 s.
                   Brings Mecklenburg-Vorpommern and the rest of Germany into
                   scope via Transitous, plus regional rail and a data-source
                   attribution line. Radar keeps positions but loses headings.

v0.17  2026-09-21  Fixed: Refresh never re-read the GPS - it reused the fix
                   from the first permission grant, so departures stayed at
                   the start point. Fixed: the board deduped by line+direction
                   +stop and then cut to the 14 soonest, so overlapping nearby
                   stops spent slots on duplicates and whole lines vanished
                   (M13 towards S Warschauer Str. at Schönhauser Allee/
                   Bornholmer Str.). Now one card per line+direction from the
                   nearest stop serving it, cap 20, 12 departures per board.
                   Added: transport-type filter chips (F5), walk distance per
                   card, and the GPS fix shown in the location label (F4).

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
| F4 | 2026-09-21 | Landed in v0.17: Refresh re-acquires the GPS position (`maximumAge:0`), and the location label prints the fix - coordinates, accuracy, time - so the refresh is visible. A failed re-read keeps the previous fix and says so rather than dropping the board. |
| F5 | 2026-09-21 | Landed in v0.17: transport-type filter chips, multi-select, persisted in `localStorage`. Client-side on purpose - the boards are always fetched with every product enabled, so all filter combinations share one proxy cache key instead of minting an upstream request per combination. |
| F6 | 2026-09-21 | Landed in v0.18: the SPA shows which upstream served the screen, with the attribution link Transitous asks for. Tied to the `X-Data-Source` header the Worker sets, not guessed from geography. |
| F7 | 2026-09-21 | Landed in v0.18: VBB HAFAS spoken directly from the Worker, replacing the community REST instance. This is the "self-hosted vbb-rest" item below, arrived at differently - mgate is plain JSON over HTTPS with a static auth blob, so it needs no Node APIs and no second deployment. |
| F9 | 2026-09-22 | Landed in v0.19: VBB's official ReST API wired in on an access id they issued for their test system, answering the "unofficial endpoint" caveat F7 left standing. Second in the chain rather than first, because the test system has no realtime feed - promoting it is `VBB_REST_PRIMARY=true` once production is unlocked. Kept deliberately reversible: no access id means the provider is off and v0.18 behaviour stands, which is also what keeps a fork working with no credentials. |
| F8 | 2026-09-21 | Landed in v0.18: Transitous/MOTIS as the second provider - coverage outside Berlin/Brandenburg, and the fallback when HAFAS fails. Open question deliberately left open: Transitous asks to be contacted before real traffic, and describes the service as for open-source non-commercial use. |

### Architecture upgrades

The PoC and the future share one diagram -
`client -> edge cache -> data source` - and each box upgrades in place:

- ~~Swap `UPSTREAM` for a self-hosted `vbb-rest` instance~~ - done in v0.18,
  by speaking HAFAS from the Worker rather than hosting a second service.
- Restore a live bearing. HAFAS's `JourneyGeoPos` rejects `getPasslist`, so
  the radar gives a position without a heading. The official interface has the
  service this needs - `journeyPos` over a rectangle, plus `lastPos` on a
  journey - but on the test system both are empty of live data, so there is
  nothing to build against yet. First thing to re-try on production.
- Move the cache to KV or Redis so it survives restarts and spans isolates.
- Wire Worker logs into observability - cache hit ratio and upstream 429s
  become signals you watch before they bite.
- ~~Move to the official VBB data path~~ - done in v0.19, on the test system.
  Production access still needs unlocking by VBB and agreement to their
  [terms of use](https://www.vbb.de/vbb-services/api-open-data/api/zugang-produktivsystem/),
  which is worth reading against this project's non-commercial licence first.

## Data sources

Three, all spoken to directly by the Worker and normalised to one API shape, so
the SPA neither knows nor cares which answered.

**VBB HAFAS** (`fahrinfo.vbb.de/bin/mgate.exe`) for Berlin + Brandenburg, and
still the first source asked there. Plain JSON over HTTPS with a static auth
blob, which is why it runs inside the Worker with no Node APIs and no second
deployment. It is an unofficial endpoint - fine for a hobby project, not
guaranteed - but it has realtime prognoses and live vehicle positions, and
until the official interface does too, that is what decides the order.

**VBB ReST** (`vbb.demo.hafas.cloud/api/fahrinfo/latest`) for Berlin +
Brandenburg, as the fallback since v0.19. VBB's official interface, reached
with an access id they issued on 2026-09-22 for their test system: documented,
supported and under terms, which is exactly what mgate is not. The id lives in
the Worker's secret store and nowhere else. The test system serves timetable
data only, so `VBB_REST_PRIMARY` stays off until VBB unlocks production. Full
notes - what falls back to what, why journeys cannot, and the two surprises the
interface holds - are in [`docs/vbb-api-access.md`](docs/vbb-api-access.md).

**Transitous / MOTIS** (`api.transitous.org`) for everywhere else, including
Mecklenburg-Vorpommern, and as the last fallback when both VBB sources fail -
it shares no infrastructure with either, so it is a second opinion rather than
a retry. It is a publicly
funded community service over DELFI's nationwide GTFS + GTFS-RT. Their usage
policy asks for a User-Agent naming the app and a contact, and a visible link
to their sources page; the Worker sends the first and the SPA renders the
second whenever MOTIS served the screen. **Before any real traffic, email them**
- they ask to be contacted ahead of heavy use, and they describe the service as
for open-source non-commercial projects, which is worth confirming for a
source-available CC BY-NC one.

### Why not the community REST instance

Until v0.17 the Worker proxied `v6.vbb.transport.rest`. That instance, not VBB's
data, was the cause of every "data source is down" the app showed. Measured on
2026-09-21 within the same minute: VBB's own HAFAS returned a Bornholmer Str.
departure board in **176 ms** while `v6.vbb.transport.rest` timed out after
12 s. A reporter on [vbb-rest#70](https://github.com/derhuerst/vbb-rest/issues/70)
tracks the outages alternating by whole clock hours, and another found
self-hosting fixed it. Talking to HAFAS directly is that fix, without the second
deployment self-hosting would normally imply.

## License

[CC BY-NC 4.0](LICENSE) - use, share and adapt for **non-commercial** purposes
with attribution. Source-available, not OSI open source.

SunSide Berlin is an independent hobby project, not affiliated with or endorsed
by VBB, BVG, S-Bahn Berlin or Deutsche Bahn.

## Status

Prototype, `v0.20`, DEVELOPMENT. The full loop works end to end against live
data: departures → exit stop → verdict with route spine and shade meter →
follow-the-ride, with live radar, the best-departure finder, the transport
filter and opt-in encrypted history, in German and English, deployed at the
URL above. Verified end to end in one desktop browser at Schönhauser
Allee/Bornholmer Str. (Berlin), Cottbus (Brandenburg), Rostock and Greifswald
(Mecklenburg-Vorpommern). The v2A design handoff is fully implemented.
