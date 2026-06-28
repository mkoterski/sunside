/**
 * SunSide Berlin - edge proxy for the VBB transport API.
 *
 * Why this exists:
 *   The public VBB instance (v6.vbb.transport.rest) enforces a GLOBAL limit of
 *   100 req/min (burst 200), keyed by source IP. If every browser calls it
 *   directly, 10-100 concurrent users trivially exhaust that shared bucket and
 *   get 429'd. This Worker is the only thing that talks to VBB, so the limit
 *   becomes ours to manage centrally via three mechanisms:
 *
 *     1. Per-endpoint caching      - most transit data is far more cacheable
 *                                    than it feels (stop locations, trip geometry).
 *     2. Single-flight coalescing  - N simultaneous misses for the same key
 *                                    trigger ONE upstream fetch, fanned out to all.
 *     3. Egress token bucket       - hard ceiling below 100/min; sheds to stale
 *                                    cache instead of getting hard-429'd.
 *
 * Cost: runs entirely on Cloudflare's free Workers tier. No KV, no paid add-ons.
 * Caching is in-memory per isolate (Map) plus the Cache API; both are free.
 *
 * Future bigger picture (not built here): swap UPSTREAM for a self-hosted
 * vbb-rest instance to remove the shared-limit dependency entirely. Only the
 * UPSTREAM constant changes - the cache/single-flight logic carries forward.
 */

const UPSTREAM = "https://v6.vbb.transport.rest";

// Per-endpoint cache TTLs in seconds. Tuned to how fast each dataset actually
// changes, not to a single conservative default.
const TTL = {
  "locations/nearby": 6 * 60 * 60, // stop locations are static for hours
  "stops":            25,          // departure boards: realtime-ish, short TTL
  "trips":            120,         // trip stopover geometry: static for the trip
  "radar":            8,           // live vehicle positions: the only truly live one
  _default:           20,
};

// Egress budget. Public VBB allows 100/min; we stay under it with headroom so a
// burst never trips the hard limit. Tokens refill continuously.
const BUDGET = { capacity: 80, refillPerSec: 80 / 60 };

// Which upstream paths we are willing to proxy. Anything else is rejected so the
// Worker can't be turned into an open proxy.
const ALLOW = [
  /^locations\/nearby$/,
  /^stops\/[^/]+\/departures$/,
  /^stops\/[^/]+\/arrivals$/,
  /^trips\/.+$/,
  /^radar$/,
  /^locations$/,
];

// ── In-isolate state (free; resets on cold start, which is fine) ──────────────
const memCache = new Map();      // key -> { body, status, ct, expires }
const inflight = new Map();      // key -> Promise (single-flight)
let tokens = BUDGET.capacity;
let lastRefill = Date.now();

function refill() {
  const now = Date.now();
  tokens = Math.min(BUDGET.capacity, tokens + ((now - lastRefill) / 1000) * BUDGET.refillPerSec);
  lastRefill = now;
}
function takeToken() {
  refill();
  if (tokens >= 1) { tokens -= 1; return true; }
  return false;
}

function ttlForPath(path) {
  if (path.startsWith("locations/nearby")) return TTL["locations/nearby"];
  if (path.startsWith("stops/"))           return TTL["stops"];
  if (path.startsWith("trips/"))           return TTL["trips"];
  if (path.startsWith("radar"))            return TTL["radar"];
  return TTL._default;
}

function pathAllowed(path) {
  return ALLOW.some((re) => re.test(path));
}

function cors(resp) {
  const h = new Headers(resp.headers);
  h.set("Access-Control-Allow-Origin", "*");
  h.set("Access-Control-Allow-Methods", "GET,OPTIONS");
  h.set("Access-Control-Allow-Headers", "Content-Type");
  return new Response(resp.body, { status: resp.status, headers: h });
}

function jsonResp(body, status, extraHeaders = {}) {
  return cors(new Response(body, {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  }));
}

/**
 * Fetch a VBB path through cache + single-flight + budget.
 * `path` is the upstream path WITHOUT leading slash, query string included.
 */
async function getUpstream(path, search) {
  const key = path + (search || "");
  const now = Date.now();

  // 1. Fresh cache hit.
  const cached = memCache.get(key);
  if (cached && cached.expires > now) {
    return jsonResp(cached.body, cached.status, { "X-Cache": "HIT" });
  }

  // 2. Coalesce concurrent misses onto one in-flight request.
  if (inflight.has(key)) {
    const r = await inflight.get(key);
    return jsonResp(r.body, r.status, { "X-Cache": "COALESCED" });
  }

  // 3. Budget check. If exhausted, serve stale cache if we have any.
  if (!takeToken()) {
    if (cached) {
      return jsonResp(cached.body, cached.status, { "X-Cache": "STALE-BUDGET" });
    }
    return jsonResp(JSON.stringify({ error: "rate budget exhausted, retry shortly" }), 503,
      { "Retry-After": "2" });
  }

  const ttl = ttlForPath(path);
  const promise = (async () => {
    const upstreamUrl = `${UPSTREAM}/${path}${search || ""}`;
    const res = await fetch(upstreamUrl, {
      headers: { "Accept": "application/json", "User-Agent": "sunside-berlin-poc" },
    });
    const body = await res.text();
    const entry = { body, status: res.status, expires: Date.now() + ttl * 1000 };
    // Only cache successful responses; let errors retry next time.
    if (res.ok) memCache.set(key, entry);
    return entry;
  })();

  inflight.set(key, promise);
  try {
    const r = await promise;
    return jsonResp(r.body, r.status, { "X-Cache": "MISS" });
  } catch (e) {
    // On upstream failure fall back to stale cache if present.
    if (cached) return jsonResp(cached.body, cached.status, { "X-Cache": "STALE-ERROR" });
    return jsonResp(JSON.stringify({ error: "upstream fetch failed" }), 502);
  } finally {
    inflight.delete(key);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return cors(new Response(null, { status: 204 }));
    }

    // Health/metrics endpoint - handy during the demo.
    if (url.pathname === "/healthz") {
      refill();
      return jsonResp(JSON.stringify({
        ok: true,
        tokensRemaining: Math.floor(tokens),
        cacheEntries: memCache.size,
        inflight: inflight.size,
      }), 200);
    }

    // API proxy: everything under /api/* maps to the VBB path.
    if (url.pathname.startsWith("/api/")) {
      const path = url.pathname.slice("/api/".length).replace(/^\/+/, "");
      if (!pathAllowed(path)) {
        return jsonResp(JSON.stringify({ error: "path not allowed" }), 403);
      }
      return getUpstream(path, url.search);
    }

    // Static assets (the SPA). Served from the bound ASSETS binding.
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return new Response("Not found", { status: 404 });
  },
};
