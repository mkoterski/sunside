# SunSide Berlin - PoC

Tells a Berlin transit rider which side of the vehicle (left or right, relative to
direction of travel) stays in the shade. Mobile-first single-page app backed by an
edge-cached proxy in front of the public VBB API.

This is the proof-of-concept build, sized for **10-100 concurrent users at zero cost**.

## What's in here

```
sunside/
  public/index.html        the SPA — THIS is the canonical, deployed app
  worker/src/index.js       Cloudflare Worker: caching proxy + single-flight + budget
  test/sun-side.test.mjs    pure-logic tests for the bearing / sun-side math
  wrangler.toml             one Worker serves BOTH the SPA and /api/*
  package.json              dev / deploy / test scripts
  archive/                  earlier prototype/demo iterations, kept for reference only
  misc/                     design brief and supporting notes
```

> `archive/` holds superseded prototype copies (`prototype/`, `demo/`,
> `prototype-journey-v2/`). They are **not** deployed and may drift from the live
> app — only `public/index.html` is authoritative.

## Why a proxy at all

The public VBB instance (`v6.vbb.transport.rest`) has a **global** limit of 100
requests/minute (burst 200), keyed by IP. If every browser calls it directly, a
heatwave crowd exhausts that shared bucket and everyone gets 429'd. The Worker
becomes the only client talking to VBB, so the limit is managed centrally via:

- **Per-endpoint caching** - stop locations cached for hours, departure boards
  ~25s, trip geometry ~120s, live radar ~8s.
- **Single-flight coalescing** - N simultaneous misses for the same key trigger
  one upstream fetch, fanned out to all waiters (kills cache-expiry stampedes).
- **Egress token bucket** - hard ceiling of 80/min with burst headroom; when
  exhausted it serves slightly-stale cache instead of getting hard-429'd.

During clustering (everyone near the same hot stops) this typically collapses
~900 req/min of raw client demand down to a few dozen actual upstream calls.

## Cost: zero

Everything runs on the **Cloudflare Workers free tier** (100k requests/day, which
easily covers 100 users). No KV, no Durable Objects, no paid add-ons. The cache is
in-memory per Worker isolate plus Cloudflare's built-in asset cache - both free.
Static asset hits are not even billed as Worker invocations.

## Deploy (zero cost, ~5 minutes)

You need a free Cloudflare account. No credit card required for the free tier.

```bash
cd sunside
npm install                  # installs wrangler locally
npx wrangler login           # opens browser, authorises once
npx wrangler deploy
```

That's it. Wrangler prints a `https://sunside-berlin.<your-subdomain>.workers.dev`
URL. Open it on a phone. The SPA loads from `public/`, and its API calls go to
`/api/*` on the same origin, which the Worker proxies to VBB.

Watch it live during a demo:

```bash
npx wrangler tail            # streams logs; look for X-Cache HIT/MISS/COALESCED
```

Health/metrics endpoint: `https://<your-url>/healthz` returns remaining tokens,
cache size, and in-flight count.

## Local development

```bash
cd sunside
npx wrangler dev             # serves SPA + proxy at http://localhost:8787
```

Open `http://localhost:8787`. The proxy and cache behave exactly as in production.

To run the SPA against VBB directly (bypassing the proxy entirely - useful for
isolating a frontend bug), add this one line in `public/index.html` just before
the main `<script>`:

```html
<script>window.SUNSIDE_API='https://v6.vbb.transport.rest'</script>
```

## Run the tests

```bash
node test/sun-side.test.mjs
```

Covers bearing math and the sun-side classification, including a curved-route
flip scenario (a vehicle turning from north to east under a southern sun, where
the shaded side genuinely changes mid-trip).

## What changed from the original prototype

1. **Configurable API base** - `const API = window.SUNSIDE_API || '/api'`. The one
   seam that lets the data source swap without touching the rest of the client.
2. **Cache-friendly requests** - geolocation rounded to 3 decimals (~110m grid) so
   nearby users hit identical cache keys; stop fan-out trimmed from 6 to 4.
3. **Segment-aware sun side** - the recommendation now walks every leg between
   boarding and exit, weights each by distance, picks the dominant shaded side, and
   warns when the side flips mid-trip. The old code applied a single bearing to the
   whole ride, which gave wrong answers on curved routes (the Ringbahn being the
   obvious case).

## The bigger picture (intentionally NOT built yet)

The PoC and the future share one diagram: `client -> edge cache -> data source`.
Each box upgrades in place; none of this is a rewrite:

- Replace `UPSTREAM` in the Worker with a **self-hosted `vbb-rest`** instance to
  drop the shared-rate-limit dependency entirely. Only that constant changes.
- Move the cache to **KV or Redis** so it survives restarts and spans isolates.
- Wire Worker logs into **observability/SIEM** - cache hit ratio and upstream 429s
  become signals you can watch before they bite.
- For anything public or commercial, move off the reverse-engineered VBB endpoint
  to the official VBB / GTFS data path and check the data-licence terms.

## Data source

This PoC uses the community-run `v6.vbb.transport.rest`, which wraps an
unofficial VBB endpoint. It is great for a hobby proof-of-concept but is not an
official or guaranteed API. Be a good neighbour: the proxy here exists partly so
this project does not hammer that shared instance. For any serious or public use,
move to the official VBB / GTFS feeds.

## License

Licensed under [CC BY-NC 4.0](LICENSE) (Creative Commons
Attribution-NonCommercial 4.0 International).

You may use, share, and adapt this work for **non-commercial** purposes with
attribution. Commercial use is not permitted. Note that a non-commercial
restriction means this is **source-available, not open source** in the OSI sense.

SunSide Berlin is an independent hobby project and is not affiliated with or
endorsed by VBB, BVG, S-Bahn Berlin, or Deutsche Bahn.

