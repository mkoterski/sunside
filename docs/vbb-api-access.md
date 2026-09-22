# VBB API access - the official ReST interface

**Status:** test system, granted 2026-09-22. Production still to be unlocked.

## What changed

Until v0.18 everything Berlin and Brandenburg came from
`fahrinfo.vbb.de/bin/mgate.exe`, the endpoint VBB's own web app talks to. It
works and it is fast, but it is nobody's published contract: no terms, no
support, no promise it looks the same next month. The README has carried the
remedy since v0.18 - "VBB issues API credentials on request at `api@vbb.de`" -
and on 2026-09-22 they did.

VBB granted access to the **test system of the ReST interface**, HAFAS ReST
v2.45:

| | |
|---|---|
| Base URL | `https://vbb.demo.hafas.cloud/api/fahrinfo/latest` |
| Authentication | a personal access id, sent as the `accessId` query parameter |
| Documentation | the interface PDF (v2.45.0) attached to VBB's mail |
| Reports as `serverVersion` | 2.52.2 (dialect 2.52), i.e. newer than the PDF |
| Contact | `api@vbb.de` |

Their conditions, in their words: after a successful development phase they
unlock the production system, which additionally requires agreeing to the
[terms of use](https://www.vbb.de/vbb-services/api-open-data/api/zugang-produktivsystem/),
and they would like to be kept up to date on what we build. Error reports
should include the request, the answer and the requested URL, screenshots if
they help.

## Where the access id lives

**Not in this repository, and not in the SPA.** It identifies our account to
VBB and is rate-limited per account, so a copy in a page anyone can view the
source of is a copy anyone can spend.

| Where | How |
|---|---|
| Deployed Worker | `npx wrangler secret put VBB_ACCESS_ID` |
| Local `wrangler dev` | a line in `.dev.vars`, which is gitignored - see `.dev.vars.example` |
| Anywhere else | nowhere else |

`VBB_REST_BASE` is an ordinary var in `wrangler.toml`, because the base is not
a secret and because switching to the production system should be a one-line
change rather than a code change.

The Worker keeps the id out of everything it emits: the access id is appended
in one place (`restGet`), no thrown error carries a request URL, and `/healthz`
reports the base and a `configured: true|false` flag but never the value.

## Not configured is a supported state

No `VBB_ACCESS_ID` means the provider is simply off, and the Worker behaves
exactly as it did in v0.18. That is what makes this safe to deploy before the
secret is set, and what keeps a fork or a CI checkout working with no
credentials at all.

## The test system has no realtime, which decides the order

Measured against the live test system on 2026-09-22, before wiring it in:

- Every departure came back with `rtTime: null` and `rtDate: null`. Thirty
  departures each at Alexanderplatz, Bornholmer Str. and Potsdam Hbf: not one
  prognosis among them.
- `planRtTs` is `1970-01-01T01:00:00+01:00`, the epoch - the server's way of
  saying it has no realtime timestamp at all.
- `rtMode` rejects `REALTIME`: *"Has to be one of [OFF, SERVER_DEFAULT]"*.
- `journeyPos`, the rectangle service that would replace the radar, exists and
  answers 200 with no journeys.

So the official interface currently carries timetable data only. Preferring it
would cost live delays, the LIVE badge and the whole radar strip in exchange
for better provenance, which is a worse app for a rider standing at a stop.
It is therefore wired in as the **fallback** inside the VBB area, with one env
var to promote it when the production system - where realtime is the entire
point - is unlocked:

    VBB_REST_PRIMARY = "true"

Flip it, then compare one board against mgate before trusting it.

## Where it sits among the providers

Three upstreams, one normalised API. Inside Berlin and Brandenburg, by default:

```
mgate HAFAS  ->  VBB ReST  ->  Transitous/MOTIS
(realtime,       (official,     (last resort, different infrastructure)
 radar)           timetable)
```

With `VBB_REST_PRIMARY=true` the first two swap.

Outside that area neither VBB source knows anything, so Transitous answers
alone, as before.

- **Nearby stops** walk the chain: an error or an empty list moves to the next
  source. An empty list is not an answer worth keeping while another source is
  left to ask - it is what a stop just outside one feed looks like.
- **Departure boards** fall back from the ReST interface to mgate with the id
  unchanged. Both name a stop by its plain station number (`900110007`), so
  the fallback needs no re-resolution. This covers the test system being down
  mid-journey, and an id bookmarked while the access id was configured and
  opened after it was withdrawn.
- **Journeys** cannot fall back. A journey reference is a token of the system
  that issued it; handed to mgate it means nothing. Without the access id such
  a request answers 503 and says why, rather than failing obscurely.
- **Radar** stays on mgate. The services we exercised cover boards and
  journeys; live vehicle positions are a separate question (see below).

Ids are namespaced so every follow-up call lands on the provider that issued
it: `v~` for the ReST interface, `h~` for mgate, `m~` for MOTIS.

## Services used

| Call | Service | Notes |
|---|---|---|
| Nearby stops | `GET /location.nearbystops` | `originCoordLat`/`originCoordLong`, `r` in metres, `type=S`, and `products` - see below |
| Departure board | `GET /departureBoard` | by `extId`, with `duration`, `maxJourneys`, `products`. No `rtMode` |
| Journey | `GET /journeyDetail` | by the `JourneyDetailRef.ref` the board handed out, e.g. `1|3438|0|86|22092026` |

Two things about this deployment that no amount of reading the parameter list
would have told us, both found by calling it:

- **`products` is mandatory on `location.nearbystops`.** Without it the service
  answers HTTP 200, no `errorCode`, and simply no result array. A silent empty
  list is indistinguishable from "no stops near you", so the Worker always
  sends the full mask.
- **`location.nearbystops` answers per platform, not per station.** Two
  Björnsonstr. rows 40 m apart, one per tram direction, each carrying
  `mainMastExtId: 900110010` for the station. The Worker collapses them onto
  the mast and keeps the nearest platform's walking distance, because the SPA
  fans out to the four closest stops and two of those slots on one place is
  the same bug the MOTIS side already groups its way out of. The mast id is
  also the number mgate takes, which is what makes the board fallback work
  with the id unchanged.

Shapes that differ from mgate and are handled explicitly:

- **Times** are `YYYY-MM-DD` plus `HH:MM:SS`, and a board running past midnight
  keeps the service date and counts the hour on (`25:10:00`) where mgate
  prefixes a day offset. Both land on the same instant through the Berlin
  wall-clock conversion, which is what lets the two fall back to each other.
  A realtime prognosis carries its own date (`rtDate`), because a delay can
  push a 23:58 departure into tomorrow.
- **Products** report `cls`, the same bitmask mgate uses, as a string. One
  mapping serves both providers.
- **Line names** come as a short `line` ("M10") and a long `name` ("STR M10").
  The short one is what a rider reads off the vehicle, so it wins.
- **Delay** is reported only when there is a prognosis (`rtTime`). An on-time
  zero inferred from a timetable would make the SPA's LIVE badge a lie.
- **Rows without a journey reference** are dropped: the follow-the-ride screen
  would have nothing to ask for, and a card that dead-ends on tap is worse than
  one fewer card.
- **Journey stops are platform-level** (`300441004`) while a board is asked for
  by mast (`900110010`), so the boarding stop is generally not found by id.
  Already handled rather than newly broken: the client's boarding rule falls
  through to the scheduled time, which both documents state identically.

## Open, deliberately

- **Live vehicle positions.** The radar still runs on mgate's `JourneyGeoPos`.
  The official interface does have the service the README's architecture list
  has been asking for - `journeyPos`, taking a rectangle as `llLat`/`llLon`/
  `urLat`/`urLon` - and `journeyDetail` even returns a `lastPos` per journey.
  On the test system both are empty of live data, so there is nothing to build
  against yet. This is the first thing to re-try on the production system.
- **Test-system data.** Beyond the missing realtime, a demo system is not a
  production guarantee. The fallback chain is already the answer if its boards
  drift from mgate's, and the finding is worth a mail to `api@vbb.de` - they
  ask for the request, the answer and the URL.
- **Production access.** Requires agreeing to the terms of use linked above.
  Worth reading against this project's CC BY-NC licence and its
  source-available, non-commercial posture before the switch.
