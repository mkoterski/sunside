/**
 * SunSide Berlin - edge data layer for transit departures.
 *
 * Three upstreams, one API
 * ------------------------
 * Until v0.17 this Worker proxied `https://v6.vbb.transport.rest`, a shared
 * community instance. That instance was the single biggest source of
 * user-facing breakage: measured on 2026-09-21, VBB's own HAFAS answered a
 * Bornholmer Str. departure board in 176 ms while `v6.vbb.transport.rest`
 * timed out after 12 s in the same minute. It was never VBB's data that was
 * down - see derhuerst/vbb-rest#70, where one reporter tracks outages
 * alternating by whole clock hours and another reports self-hosting fixed it.
 *
 * So this Worker now talks to the data sources itself:
 *
 *   VBB    - the official VBB ReST interface. VBB granted access to their
 *            test system on 2026-09-22, so since v0.19 the Worker speaks the
 *            sanctioned, documented contract as well as the web app's private
 *            protocol. It is reached with a personal access id, which lives in
 *            the Worker's secret store and never in this repository. Without
 *            that secret the provider is simply off and the Worker behaves
 *            exactly as it did in v0.18 - see docs/vbb-api-access.md.
 *
 *            It backs mgate up rather than replacing it, because the test
 *            system serves timetable data only: no prognoses, no vehicle
 *            positions. Promoting it is one env var (VBB_REST_PRIMARY) and is
 *            what the production system is for.
 *
 *   HAFAS  - VBB's own mgate endpoint, for Berlin + Brandenburg, and still the
 *            first source asked there. The protocol is plain JSON over HTTPS
 *            with a static auth blob, so it needs no Node APIs and runs inside
 *            the Worker. "Self-hosted" with no second deployment: no
 *            container, no VPS, still the free tier. It has realtime and it
 *            has the radar, which is the whole reason it still leads.
 *
 *   MOTIS  - api.transitous.org, a publicly funded community service over
 *            DELFI's nationwide GTFS + GTFS-RT. Covers what the other two do
 *            not: Mecklenburg-Vorpommern and the rest of Germany. Also the
 *            last fallback, since it shares no infrastructure with either.
 *
 * All three are normalised to the same response shapes, so the SPA neither
 * knows nor cares which answered. Stop and trip ids are namespaced (`v~` /
 * `h~` / `m~`) and round-trip through the client, which is what keeps
 * follow-up calls on the provider that issued them.
 *
 * What the split costs: MOTIS exposes no live vehicle positions, so the radar
 * strip is mgate-only. Outside Berlin/Brandenburg the app falls back to stop
 * geometry for the bearing - which is what it already does for multi-leg rides.
 *
 * Cost: still entirely on Cloudflare's free tier. No KV, no paid add-ons.
 * Caching is in-memory per isolate; single-flight and a token bucket keep us
 * a polite neighbour to both upstreams.
 */

// ── Cache tuning ─────────────────────────────────────────────────────────────
// Per-endpoint TTLs in seconds, tuned to how fast each dataset actually
// changes rather than to one conservative default.
const TTL = {
  nearby:     6 * 60 * 60, // stop locations are static for hours
  departures: 25,          // realtime-ish, short TTL
  trip:       120,         // stopover geometry: static for the trip
  radar:      8,           // live vehicle positions: the only truly live one
};

// Hard ceiling on distinct cache entries. Keys include query parameters, so
// without this a flood of distinct queries (jittered radar boxes, say) could
// grow the Map until the isolate runs out of memory.
const MAX_CACHE_ENTRIES = 500;

// Egress budget per upstream. Neither endpoint publishes a limit for us, but
// both are somebody else's infrastructure and Transitous explicitly asks to be
// contacted before heavy use - so we cap ourselves and shed to stale cache
// rather than leaving it to them to say no.
const BUDGET = { capacity: 80, refillPerSec: 80 / 60 };

// ── VBB service area ─────────────────────────────────────────────────────────
// Berlin + Brandenburg, generously bounded. Inside it HAFAS is preferred (it
// has realtime throughout and live vehicle positions); outside it MOTIS is the
// only one of the two with any data.
const VBB_AREA = { south: 51.28, north: 53.62, west: 11.17, east: 14.83 };
const inVbbArea = (lat, lon) =>
  lat >= VBB_AREA.south && lat <= VBB_AREA.north &&
  lon >= VBB_AREA.west && lon <= VBB_AREA.east;

// ── Provider: HAFAS (VBB, direct) ────────────────────────────────────────────
const HAFAS_ENDPOINT = 'https://fahrinfo.vbb.de/bin/mgate.exe';

// The envelope VBB's own web app sends. There is deliberately no `ext` field
// and no `cfg` on the service request: including either makes mgate answer
// `err: "PARSE"` and return nothing.
const HAFAS_CLIENT = { type: 'WEB', id: 'VBB', name: 'VBB WebApp', l: 'vs_webapp_vbb' };
const HAFAS_AUTH = { type: 'AID', aid: 'hafas-vbb-webapp' };
const HAFAS_VER = '1.45';

// HAFAS product bitmask, per hafas-client's VBB profile. A product's `cls` is
// the same bitmask, which makes the mapping a simple lookup in both directions.
const HAFAS_BITS = {
  suburban: 1, subway: 2, tram: 4, bus: 8, ferry: 16, express: 32, regional: 64,
};
const HAFAS_ALL_PRODUCTS = 127;

// ── Provider: VBB ReST (official) ────────────────────────────────────────────
// The test system VBB gave us on 2026-09-22, running HAFAS ReST v2.45. The
// base is a var rather than a constant for one reason: when VBB unlocks the
// production system the move is a `wrangler.toml` edit and a new secret, not a
// code change. Everything below speaks the documented interface, which both
// systems serve.
const VBB_REST_DEFAULT_BASE = 'https://vbb.demo.hafas.cloud/api/fahrinfo/latest';

// Read per request: Workers hand `env` to `fetch`, and secrets are only
// readable there. `enabled` is the whole feature flag - no access id, no
// provider, and the v0.18 behaviour stands untouched.
//
// `primary` decides the order inside Berlin/Brandenburg, and it is off by
// default for one measured reason: the test system carries no realtime feed.
// Every board it answered on 2026-09-22 had `rtTime: null` and `planRtTs` at
// the epoch, `rtMode` accepts only OFF and SERVER_DEFAULT, and `journeyPos`
// returns no journeys at all. Asking it first would trade live delays, the
// LIVE badge and the radar for a nicer provenance, which is a worse app. So
// mgate keeps the lead and the official interface backs it up - until the
// production system is unlocked, where realtime is the point of the exercise:
// set VBB_REST_PRIMARY=true then, and check one board against mgate.
function vbbConfig(env) {
  const accessId = String((env && env.VBB_ACCESS_ID) || '');
  const base = String((env && env.VBB_REST_BASE) || VBB_REST_DEFAULT_BASE).replace(/\/+$/, '');
  return {
    enabled: Boolean(accessId),
    primary: String((env && env.VBB_REST_PRIMARY) || '') === 'true',
    base,
    accessId,
  };
}

// ── Provider: MOTIS (Transitous) ─────────────────────────────────────────────
const MOTIS_BASE = 'https://api.transitous.org';

// Transitous requires a User-Agent naming the app, its version and a way to
// reach a human; requests without one are answered 403. Their usage policy
// also asks for a visible link to transitous.org/sources, which the SPA
// renders whenever MOTIS served the data.
const MOTIS_UA =
  'sunside-berlin/0.20 (+https://github.com/mkoterski/sunside; matthias.koterski@nextwind.de)';

// GTFS route types as MOTIS names them, mapped onto the product vocabulary the
// SPA already uses for badge colours and the filter chips.
const MOTIS_PRODUCTS = {
  TRAM: 'tram',
  SUBWAY: 'subway',
  METRO: 'subway',
  RAIL: 'regional',
  REGIONAL_RAIL: 'regional',
  REGIONAL_FAST_RAIL: 'regional',
  NIGHT_RAIL: 'regional',
  LONG_DISTANCE: 'express',
  HIGHSPEED_RAIL: 'express',
  COACH: 'bus',
  BUS: 'bus',
  FERRY: 'ferry',
  SUBURBAN: 'suburban',
  AIRPLANE: 'express',
  OTHER: 'bus',
};

// ── In-isolate state (free; resets on cold start, which is fine) ─────────────
const memCache = new Map(); // key -> { body, source, expires }
const inflight = new Map(); // key -> Promise (single-flight)
const buckets = {
  vbb:   { tokens: BUDGET.capacity, last: Date.now() },
  hafas: { tokens: BUDGET.capacity, last: Date.now() },
  motis: { tokens: BUDGET.capacity, last: Date.now() },
};

function refill(which) {
  const b = buckets[which];
  const now = Date.now();
  b.tokens = Math.min(BUDGET.capacity, b.tokens + ((now - b.last) / 1000) * BUDGET.refillPerSec);
  b.last = now;
  return b;
}
function takeToken(which) {
  const b = refill(which);
  if (b.tokens >= 1) { b.tokens -= 1; return true; }
  return false;
}

// Insert while keeping the cache bounded: drop anything already expired first
// (cheap, and usually enough), then evict oldest-inserted until under the
// ceiling. Map iteration order is insertion order, so the first key is oldest.
function setCache(key, entry) {
  if (memCache.size >= MAX_CACHE_ENTRIES) {
    const now = Date.now();
    for (const [k, v] of memCache) if (v.expires <= now) memCache.delete(k);
    while (memCache.size >= MAX_CACHE_ENTRIES) {
      const oldest = memCache.keys().next().value;
      if (oldest === undefined) break;
      memCache.delete(oldest);
    }
  }
  memCache.set(key, entry);
}

// ── Time helpers ─────────────────────────────────────────────────────────────
const pad = (n, w = 2) => String(n).padStart(w, '0');

// Offset of Europe/Berlin at a given instant, in ms. Workers ship a full ICU,
// so Intl resolves CET vs CEST for the right date without a timezone library.
function berlinOffsetMs(instant) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Berlin', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant);
  const p = {};
  for (const { type, value } of parts) p[type] = value;
  const hour = p.hour === '24' ? 0 : Number(p.hour); // en-GB renders midnight as 24
  const asUtc = Date.UTC(
    Number(p.year), Number(p.month) - 1, Number(p.day),
    hour, Number(p.minute), Number(p.second),
  );
  return asUtc - instant.getTime();
}

// Berlin wall-clock components -> the UTC instant they name. Two passes settle
// the DST-boundary case, where the first guess picks the wrong side's offset.
function berlinWallToInstant(y, mo, d, h, mi, s) {
  const wallAsUtc = Date.UTC(y, mo - 1, d, h, mi, s);
  let instant = wallAsUtc;
  for (let i = 0; i < 2; i++) instant = wallAsUtc - berlinOffsetMs(new Date(instant));
  return new Date(instant);
}

// ISO 8601 carrying Berlin's offset, matching what the old upstream emitted
// (2026-09-21T14:47:00+02:00) so the SPA's `new Date(...)` behaves identically.
function isoBerlin(instant) {
  const off = berlinOffsetMs(instant);
  const local = new Date(instant.getTime() + off);
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off) / 60000;
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}` +
    `T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

// HAFAS dates are "YYYYMMDD"; times are "HHMMSS", optionally with a leading
// day offset ("01164600" = 16:46:00 the following day) for boards running past
// midnight. Returns an ISO string, or null when the field is absent.
function hafasTime(dateStr, timeStr) {
  if (!dateStr || timeStr == null) return null;
  const t = String(timeStr);
  const dayOffset = t.length > 6 ? Number(t.slice(0, t.length - 6)) : 0;
  const hms = t.slice(-6);
  return isoBerlin(berlinWallToInstant(
    Number(dateStr.slice(0, 4)),
    Number(dateStr.slice(4, 6)),
    Number(dateStr.slice(6, 8)) + dayOffset,
    Number(hms.slice(0, 2)), Number(hms.slice(2, 4)), Number(hms.slice(4, 6)),
  ));
}

// "Now" as HAFAS wants it: Berlin wall clock, split into its date and time.
function hafasNowParts() {
  const now = new Date();
  const berlin = new Date(now.getTime() + berlinOffsetMs(now));
  return {
    date: `${berlin.getUTCFullYear()}${pad(berlin.getUTCMonth() + 1)}${pad(berlin.getUTCDate())}`,
    time: `${pad(berlin.getUTCHours())}${pad(berlin.getUTCMinutes())}${pad(berlin.getUTCSeconds())}`,
  };
}

const secondsBetween = (a, b) => (a && b ? Math.round((Date.parse(a) - Date.parse(b)) / 1000) : null);

// ── Geometry ─────────────────────────────────────────────────────────────────
function haversineMetres(la1, lo1, la2, lo2) {
  const R = 6371000, r = Math.PI / 180;
  const dLa = (la2 - la1) * r, dLo = (lo2 - lo1) * r;
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(dLo / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── HAFAS ────────────────────────────────────────────────────────────────────
async function mgate(meth, req, signal) {
  const res = await fetch(HAFAS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({
      lang: 'de',
      svcReqL: [{ meth, req }],
      client: HAFAS_CLIENT,
      ver: HAFAS_VER,
      auth: HAFAS_AUTH,
    }),
    signal,
  });
  if (!res.ok) throw new Error(`hafas http ${res.status}`);
  const body = await res.json();
  if (body.err && body.err !== 'OK') throw new Error(`hafas ${body.err}`);
  const svc = body.svcResL && body.svcResL[0];
  if (!svc) throw new Error('hafas: empty response');
  if (svc.err && svc.err !== 'OK') throw new Error(`hafas ${svc.err}`);
  return svc.res || {};
}

function productFromCls(cls) {
  for (const name in HAFAS_BITS) if (HAFAS_BITS[name] === cls) return name;
  return 'regional';
}

// VBB's own profile strips the redundant mode prefix from line names and gives
// the two Ringbahn directions distinguishable names. Both are reproduced here
// so labels read the way riders - and the SPA's badges - expect.
const hafasLineName = (raw) => String(raw || '?').replace(/^(bus|tram)\s+/i, '').trim();

function renameRingbahn(product, direction) {
  if (product !== 'suburban' || !direction) return direction;
  const d = direction.trim();
  if (/^ringbahn s\s?41$/i.test(d)) return 'Ringbahn S41 ⟳';
  if (/^ringbahn s\s?42$/i.test(d)) return 'Ringbahn S42 ⟲';
  return direction;
}

async function hafasNearby({ lat, lon, distance, results }, signal) {
  const res = await mgate('LocGeoPos', {
    ring: {
      cCrd: { x: Math.round(lon * 1e6), y: Math.round(lat * 1e6) },
      maxDist: distance, minDist: 0,
    },
    getStops: true, getPOIs: false, maxLoc: results,
  }, signal);

  return (res.locL || []).filter((l) => l.crd).map((l) => ({
    type: 'stop',
    id: `h~${l.extId}`,
    name: l.name,
    location: { type: 'location', latitude: l.crd.y / 1e6, longitude: l.crd.x / 1e6 },
    distance: l.dist != null ? Math.round(l.dist) : null,
  }));
}

async function hafasDepartures({ id, duration, results, products }, signal) {
  const { date, time } = hafasNowParts();
  const res = await mgate('StationBoard', {
    type: 'DEP', date, time,
    stbLoc: { type: 'S', lid: `A=1@L=${id}@` },
    jnyFltrL: [{ type: 'PROD', mode: 'INC', value: String(products) }],
    dur: duration,
    maxJny: results,
  }, signal);

  const prodL = res.common?.prodL || [];
  const departures = (res.jnyL || []).map((j) => {
    const stb = j.stbStop || {};
    const prod = prodL[stb.dProdX != null ? stb.dProdX : j.prodX] || {};
    const product = productFromCls(prod.cls);
    const plannedWhen = hafasTime(j.date, stb.dTimeS);
    const when = hafasTime(j.date, stb.dTimeR) || plannedWhen;
    // A realtime prognosis is what makes the SPA's LIVE badge honest: without
    // one, delay stays null rather than being reported as an on-time zero.
    const hasPrognosis = stb.dTimeR != null;
    return {
      tripId: `h~${j.jid}`,
      direction: renameRingbahn(product, j.dirTxt),
      when,
      plannedWhen,
      delay: hasPrognosis ? secondsBetween(when, plannedWhen) : null,
      line: { type: 'line', name: hafasLineName(prod.name), product },
    };
  }).filter((d) => d.when);

  return { departures };
}

async function hafasTrip({ id }, signal) {
  const res = await mgate('JourneyDetails', { jid: id, getPasslist: true, getPolyline: false }, signal);
  const locL = res.common?.locL || [];
  const date = res.journey?.date;
  const stopovers = (res.journey?.stopL || []).map((s) => {
    const l = locL[s.locX] || {};
    return {
      stop: {
        type: 'stop',
        id: l.extId ? `h~${l.extId}` : null,
        name: l.name,
        location: l.crd
          ? { type: 'location', latitude: l.crd.y / 1e6, longitude: l.crd.x / 1e6 }
          : null,
      },
      arrival: hafasTime(date, s.aTimeR) || hafasTime(date, s.aTimeS),
      plannedArrival: hafasTime(date, s.aTimeS),
      departure: hafasTime(date, s.dTimeR) || hafasTime(date, s.dTimeS),
      plannedDeparture: hafasTime(date, s.dTimeS),
    };
  });
  return { trip: { id: `h~${id}`, stopovers } };
}

async function hafasRadar({ north, south, east, west, results, products }, signal) {
  const { date, time } = hafasNowParts();
  const res = await mgate('JourneyGeoPos', {
    maxJny: results, onlyRT: false, date, time,
    rect: {
      llCrd: { x: Math.round(west * 1e6), y: Math.round(south * 1e6) },
      urCrd: { x: Math.round(east * 1e6), y: Math.round(north * 1e6) },
    },
    perSize: 30000, perStep: 30000, ageOfReport: true,
    jnyFltrL: [{ type: 'PROD', mode: 'INC', value: String(products) }],
    trainPosMode: 'CALC',
  }, signal);

  const prodL = res.common?.prodL || [];
  // No `bearing`: JourneyGeoPos rejects getPasslist, so there is no next stop
  // to take a heading towards. The SPA treats a missing bearing as a cue to
  // fall back to stop geometry, which is the better source on anything but a
  // dead-straight single leg anyway.
  const movements = (res.jnyL || []).filter((j) => j.pos).map((j) => {
    const prod = prodL[j.prodX] || {};
    const product = productFromCls(prod.cls);
    return {
      tripId: `h~${j.jid}`,
      direction: renameRingbahn(product, j.dirTxt),
      line: { type: 'line', name: hafasLineName(prod.name), product },
      location: { type: 'location', latitude: j.pos.y / 1e6, longitude: j.pos.x / 1e6 },
    };
  });
  return { movements };
}

// ── VBB ReST ─────────────────────────────────────────────────────────────────
// One GET helper for the whole interface: every service takes its arguments in
// the query string and answers JSON. The access id is appended here and only
// here, so no call site can forget it - and no error message can leak it,
// which is why nothing below ever puts the request URL into a thrown message.
// Those messages are handed to the client verbatim by the error handler.
async function restGet(cfg, path, params, signal) {
  const url = new URL(cfg.base + path);
  for (const k in params) if (params[k] != null) url.searchParams.set(k, String(params[k]));
  url.searchParams.set('format', 'json');
  url.searchParams.set('accessId', cfg.accessId);

  let res;
  try {
    res = await fetch(url, { headers: { 'Accept': 'application/json' }, signal });
  } catch (e) {
    throw new Error(`vbb ${path}: ${e.name === 'TimeoutError' ? 'timeout' : 'fetch failed'}`);
  }
  if (!res.ok) throw new Error(`vbb http ${res.status}`);
  const body = await res.json();
  // The interface reports its own failures in the body (API_AUTH for a bad or
  // expired access id, API_QUOTA when the test system's allowance is spent),
  // sometimes under HTTP 200. Surfacing the code is what makes a mail to VBB
  // useful, since they ask for the request, the answer and the URL.
  if (body && (body.errorCode || body.errorText)) {
    throw new Error(`vbb ${body.errorCode || 'error'}`);
  }
  return body || {};
}

// ReST dates are "YYYY-MM-DD", times "HH:MM:SS". A board running past midnight
// keeps the service date and counts the hour on ("25:10:00") where mgate
// prefixes a day offset instead - the same idea, differently spelled, and both
// land on the same instant through the Berlin wall-clock conversion.
function restTime(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;
  const [h, mi, sec] = String(timeStr).split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(mi)) return null;
  const [y, mo, d] = String(dateStr).split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  return isoBerlin(berlinWallToInstant(
    y, mo, d + Math.floor(h / 24), h % 24, mi, Number.isFinite(sec) ? sec : 0,
  ));
}

// `Product` is an array on the departure board and an object on a journey, and
// older deployments send only the flat `ProductAtStop`. Take whichever is
// there rather than making every call site care.
function restProduct(row) {
  const p = row.Product || row.ProductAtStop;
  return (Array.isArray(p) ? p[0] : p) || {};
}

// `cls` is the same bitmask mgate reports, so one product mapping serves both
// providers. It arrives as a string here, hence the Number().
const restProductName = (prod) => productFromCls(Number(prod.cls));

// `line` is the name a rider reads off the vehicle ("M10", "S41"); `name` is
// the long form ("STR M10", "Bus 142"). Prefer the short one, and strip the
// redundant mode prefix from the long one the way the mgate side does.
const restLineName = (prod, fallback) =>
  String(prod.line || prod.name || fallback || '?')
    .replace(/^(bus|tram|str)\s+/i, '').trim() || '?';

async function vbbNearby({ lat, lon, distance, results, cfg }, signal) {
  const body = await restGet(cfg, '/location.nearbystops', {
    originCoordLat: lat.toFixed(6),
    originCoordLong: lon.toFixed(6),
    r: Math.round(distance),
    // Platforms collapse onto their mast below, so ask for enough rows that
    // the collapse still leaves `results` distinct stations.
    maxNo: Math.min(results * 4, 50),
    type: 'S', // stops only, no points of interest
    // Not optional, whatever it looks like: without `products` this service
    // answers 200 with no `stopLocationOrCoordLocation` at all. An empty list
    // and no error code is a silent nothing, and it is what a first attempt
    // at this call looks like from the outside.
    products: HAFAS_ALL_PRODUCTS,
  }, signal);

  // Hits arrive wrapped in `stopLocationOrCoordLocation[].StopLocation`; a
  // flat `StopLocation[]` is accepted too, which is what older deployments
  // answer. Both unwrap to the same record.
  const list = (body.stopLocationOrCoordLocation || body.StopLocation || [])
    .map((e) => (e && e.StopLocation) || e)
    .filter((l) => l && l.lat != null && l.lon != null);

  // This service answers per PLATFORM: two Björnsonstr. rows 40 m apart, one
  // per tram direction, each carrying `mainMastExtId` for the station they
  // belong to. Left in, they are two board requests for one place and two of
  // the four slots the SPA fans out to - the same bug the MOTIS side already
  // groups its way out of. The mast id is also the number mgate takes
  // (900110010), which is what lets a board fall back between the two VBB
  // providers with the id exactly as it came in.
  const byMast = new Map();
  for (const l of list) {
    const mast = l.mainMastExtId || l.extId || l.id;
    const stop = {
      type: 'stop',
      id: `v~${mast}`,
      name: l.name,
      // The nearest platform's coordinates, not the mast's: that is the point
      // the rider walks to, and it is what `dist` is measured against.
      location: { type: 'location', latitude: Number(l.lat), longitude: Number(l.lon) },
      distance: l.dist != null ? Math.round(Number(l.dist)) : null,
    };
    const prev = byMast.get(mast);
    if (!prev || (stop.distance ?? Infinity) < (prev.distance ?? Infinity)) byMast.set(mast, stop);
  }
  return [...byMast.values()]
    .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity))
    .slice(0, results);
}

async function vbbDepartures({ id, duration, results, products, cfg }, signal) {
  const body = await restGet(cfg, '/departureBoard', {
    extId: id,
    duration,
    maxJourneys: results,
    products,
    // No `rtMode`: this deployment accepts only OFF and SERVER_DEFAULT and
    // answers API_PARAM for anything else. Its default is what we want anyway.
  }, signal);

  const departures = (body.Departure || []).map((d) => {
    const prod = restProduct(d);
    const product = restProductName(prod);
    const plannedWhen = restTime(d.date, d.time);
    // A prognosis carries its own date, because a delay can push a 23:58
    // departure into tomorrow.
    const when = restTime(d.rtDate || d.date, d.rtTime) || plannedWhen;
    const ref = d.JourneyDetailRef && d.JourneyDetailRef.ref;
    return {
      // Without a journey reference the follow-the-ride screen has nothing to
      // ask for, so the row is dropped below rather than shown as a card that
      // dead-ends on tap.
      tripId: ref ? `v~${ref}` : null,
      direction: renameRingbahn(product, d.direction || null),
      when,
      plannedWhen,
      // Same rule as on the mgate side: no prognosis, no delay. An on-time
      // zero inferred from a timetable would make the LIVE badge a lie.
      delay: d.rtTime ? secondsBetween(when, plannedWhen) : null,
      line: { type: 'line', name: restLineName(prod, d.name), product },
    };
  }).filter((d) => d.when && d.tripId);

  return { departures };
}

// Journey stops are named per platform (300441004) while a board is asked for
// by mast (900110010), so the boarding stop is generally NOT found by id here.
// That is already handled rather than newly broken: the client's boarding rule
// falls through to the scheduled time, which both documents state identically.
async function vbbTrip({ id, cfg }, signal) {
  const body = await restGet(cfg, '/journeyDetail', { id }, signal);
  const stops = (body.Stops && body.Stops.Stop) || [];
  const stopovers = stops.map((s) => ({
    stop: {
      type: 'stop',
      id: s.extId ? `v~${s.extId}` : null,
      name: s.name,
      location: s.lat != null
        ? { type: 'location', latitude: Number(s.lat), longitude: Number(s.lon) }
        : null,
    },
    arrival: restTime(s.rtArrDate || s.arrDate, s.rtArrTime) || restTime(s.arrDate, s.arrTime),
    plannedArrival: restTime(s.arrDate, s.arrTime),
    departure: restTime(s.rtDepDate || s.depDate, s.rtDepTime) || restTime(s.depDate, s.depTime),
    plannedDeparture: restTime(s.depDate, s.depTime),
  }));
  return { trip: { id: `v~${id}`, stopovers } };
}

// ── MOTIS ────────────────────────────────────────────────────────────────────
async function motisGet(path, params, signal) {
  const url = new URL(MOTIS_BASE + path);
  for (const k in params) if (params[k] != null) url.searchParams.set(k, params[k]);
  const res = await fetch(url, {
    headers: { 'Accept': 'application/json', 'User-Agent': MOTIS_UA },
    signal,
  });
  if (!res.ok) throw new Error(`motis http ${res.status}`);
  const body = await res.json();
  if (body && body.error) throw new Error(`motis: ${body.error}`);
  return body;
}

const motisProduct = (mode) => MOTIS_PRODUCTS[mode] || 'bus';

// MOTIS ids are "<feed>_<DHID>", and a DHID is country:area:stop[:quay[:edge]].
// Trimming to three components names the station a platform belongs to, which
// is what lets several platform rows collapse into one place a rider would
// recognise. Six "Rostock Hauptbahnhof" rows in the nearby list, each eating
// one of the SPA's four stop slots, is what happens without it.
//
// GROUPING ONLY. The parent is not necessarily a stop MOTIS can answer for:
// Rostock Hbf has one, Greifswald Landratsamt does not and returns 404. So we
// group by the parent and hand back the id MOTIS actually gave us. That is
// safe as well as correct, because querying a platform id returns the whole
// station's board anyway, both directions included.
function motisParent(stopId) {
  const s = String(stopId);
  const us = s.indexOf('_');
  if (us < 0) return s;
  const parts = s.slice(us + 1).split(':');
  return parts.length > 3 ? `${s.slice(0, us)}_${parts.slice(0, 3).join(':')}` : s;
}

// DELFI aggregates several source feeds, so one station can appear under
// several ids that no amount of id arithmetic will reconcile (de-VBB_… and
// de-DELFI_… for the same Rostock platform). Names are what a rider compares,
// so names are what we collapse on.
const normaliseStopName = (name) => String(name || '')
  .toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

async function motisNearby({ lat, lon, distance, results }, signal) {
  // map/stops takes a box, not a radius; derive one that comfortably contains
  // the requested circle, then filter by true distance below.
  const dLat = distance / 111320;
  const dLon = distance / (111320 * Math.max(0.2, Math.cos(lat * Math.PI / 180)));
  const raw = await motisGet('/api/v6/map/stops', {
    min: `${lat - dLat},${lon - dLon}`,
    max: `${lat + dLat},${lon + dLon}`,
  }, signal);

  // Collapse platforms to their parent, then collapse feed duplicates by name.
  // Keeping the nearest of each group is what makes the walking distance the
  // SPA prints mean "to the closest way in", not "to an arbitrary platform".
  const byName = new Map();
  for (const s of raw || []) {
    if (s.lat == null || s.lon == null) continue;
    const d = haversineMetres(lat, lon, s.lat, s.lon);
    if (d > distance) continue;
    const key = normaliseStopName(s.name);
    if (!key) continue;
    const prev = byName.get(key);
    if (!prev || d < prev.distance) {
      byName.set(key, {
        type: 'stop',
        id: `m~${s.stopId}`,        // as given: see the note on motisParent
        parent: motisParent(s.stopId),
        name: s.name,
        location: { type: 'location', latitude: s.lat, longitude: s.lon },
        distance: Math.round(d),
      });
    }
  }
  // A second pass by parent station: two differently-named entries can still
  // belong to one station ("Rostock, Hauptbahnhof Süd" and "Rostock ZOB" do).
  // Left in, they are two rows the SPA fans out to that fetch the same board.
  const byStation = new Map();
  for (const st of [...byName.values()].sort((a, b) => a.distance - b.distance)) {
    if (!byStation.has(st.parent)) byStation.set(st.parent, st);
  }
  return [...byStation.values()].slice(0, results).map(({ parent, ...s }) => s);
}

async function motisDepartures({ id, duration, results, productSet }, signal) {
  // stoptimes counts rows, it does not take a time window, so ask for a
  // generous page and cut it to the window ourselves.
  const body = await motisGet('/api/v6/stoptimes', {
    stopId: id,
    n: Math.max(results * 2, 20),
    arriveBy: 'false',
  }, signal);

  const cutoff = Date.now() + duration * 60000;
  const departures = [];
  for (const st of body.stopTimes || []) {
    const product = motisProduct(st.mode);
    if (productSet && !productSet.has(product)) continue;
    const place = st.place || {};
    const when = place.departure || place.scheduledDeparture;
    if (!when || Date.parse(when) > cutoff) continue;
    departures.push({
      tripId: `m~${st.tripId}`,
      direction: st.headsign || null,
      when,
      plannedWhen: place.scheduledDeparture || when,
      // MOTIS flags whether a row is realtime-backed; only then is a delay a
      // measurement rather than a number subtracted from itself.
      delay: st.realTime ? secondsBetween(when, place.scheduledDeparture) : null,
      line: { type: 'line', name: st.routeShortName || st.displayName || '?', product },
    });
    if (departures.length >= results) break;
  }
  return { departures };
}

async function motisTrip({ id }, signal) {
  const body = await motisGet('/api/v6/trip', { tripId: id }, signal);
  const stopovers = [];
  for (const leg of body.legs || []) {
    for (const p of [leg.from, ...(leg.intermediateStops || []), leg.to]) {
      if (!p) continue;
      // Consecutive legs share their boundary stop; skip the repeat so the
      // geometry walk never sees a zero-length segment.
      const last = stopovers[stopovers.length - 1];
      if (last && last.stop.name === p.name) continue;
      stopovers.push({
        stop: {
          type: 'stop',
          id: p.stopId ? `m~${p.stopId}` : null,
          name: p.name,
          location: p.lat != null
            ? { type: 'location', latitude: p.lat, longitude: p.lon }
            : null,
        },
        arrival: p.arrival || p.scheduledArrival || null,
        plannedArrival: p.scheduledArrival || null,
        departure: p.departure || p.scheduledDeparture || null,
        plannedDeparture: p.scheduledDeparture || null,
      });
    }
  }
  return { trip: { id: `m~${id}`, stopovers } };
}

// MOTIS exposes no live vehicle positions, so an empty list is the honest
// answer - better than a position interpolated along a polyline and presented
// as a GPS fix.
async function motisRadar() {
  return { movements: [] };
}

const PROVIDERS = {
  // Radar never routes through this table - the handler calls hafasRadar and
  // spends the mgate budget directly - which is also the honest entry here:
  // the ReST services we were granted cover boards and journeys, not live
  // vehicle positions.
  vbb:   { nearby: vbbNearby,   departures: vbbDepartures,   trip: vbbTrip,   radar: hafasRadar },
  hafas: { nearby: hafasNearby, departures: hafasDepartures, trip: hafasTrip, radar: hafasRadar },
  motis: { nearby: motisNearby, departures: motisDepartures, trip: motisTrip, radar: motisRadar },
};

// ── Request parsing ──────────────────────────────────────────────────────────
// The SPA sends VBB-style product flags ("tram=true&bus=false&…"). Translate
// once, into both the HAFAS bitmask and a set for MOTIS filtering.
function parseProducts(sp) {
  let mask = 0;
  const set = new Set();
  let sawAny = false;
  for (const name in HAFAS_BITS) {
    const v = sp.get(name);
    if (v === null) continue;
    sawAny = true;
    if (v === 'true') { mask |= HAFAS_BITS[name]; set.add(name); }
  }
  if (!sawAny || mask === 0) return { mask: HAFAS_ALL_PRODUCTS, set: null };
  return { mask, set };
}

function num(sp, key, dflt) {
  const v = Number(sp.get(key));
  return Number.isFinite(v) ? v : dflt;
}

// Split a namespaced id back into its provider and that provider's own id. An
// id with no prefix is treated as mgate HAFAS, which keeps anything bookmarked
// before v0.18 working.
function splitId(raw) {
  const s = decodeURIComponent(raw || '');
  if (s.startsWith('v~')) return { provider: 'vbb', id: s.slice(2) };
  if (s.startsWith('h~')) return { provider: 'hafas', id: s.slice(2) };
  if (s.startsWith('m~')) return { provider: 'motis', id: s.slice(2) };
  return { provider: 'hafas', id: s };
}

// ── Fetch with cache + single-flight + budget ────────────────────────────────
async function served(key, ttl, provider, run) {
  const now = Date.now();

  const cached = memCache.get(key);
  if (cached && cached.expires > now) {
    return { body: cached.body, source: cached.source, cache: 'HIT' };
  }
  if (inflight.has(key)) {
    const r = await inflight.get(key);
    return { body: r.body, source: r.source, cache: 'COALESCED' };
  }
  if (!takeToken(provider)) {
    if (cached) return { body: cached.body, source: cached.source, cache: 'STALE-BUDGET' };
    const e = new Error('rate budget exhausted, retry shortly');
    e.status = 503;
    throw e;
  }

  const promise = (async () => {
    // Fail fast. A stalled upstream is the failure mode that historically left
    // the app on a loading screen forever, so it gets a deadline, not patience.
    const body = await run(AbortSignal.timeout(8000));
    const entry = { body, source: provider, expires: Date.now() + ttl * 1000 };
    setCache(key, entry);
    return entry;
  })();

  inflight.set(key, promise);
  try {
    const r = await promise;
    return { body: r.body, source: r.source, cache: 'MISS' };
  } catch (e) {
    // Serve stale rather than nothing: a board a minute old beats an error
    // screen, and the SPA shows departure times so staleness is visible.
    if (cached) return { body: cached.body, source: cached.source, cache: 'STALE-ERROR' };
    throw e;
  } finally {
    inflight.delete(key);
  }
}

// ── Response helpers ─────────────────────────────────────────────────────────
function jsonResp(obj, status, extra = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...extra },
  });
}

// Origins allowed to call this Worker cross-origin. The SPA is same-origin so
// it never needs an entry; the GitHub Pages testing copy does, because since
// v0.18 there is no public REST upstream it could call directly instead. This
// stays an explicit list rather than a wildcard, which would make the Worker
// an open proxy for VBB that any site could spend our budget on.
const EXTRA_ORIGINS = new Set(['https://mkoterski.github.io']);

function withCors(resp, request) {
  const origin = request.headers.get('Origin');
  const h = new Headers(resp.headers);
  if (origin && (origin === new URL(request.url).origin || EXTRA_ORIGINS.has(origin))) {
    h.set('Access-Control-Allow-Origin', origin);
    h.set('Vary', 'Origin');
    h.set('Access-Control-Allow-Methods', 'GET,OPTIONS');
    h.set('Access-Control-Allow-Headers', 'Content-Type');
  }
  h.set('Access-Control-Expose-Headers', 'X-Data-Source, X-Cache');
  return new Response(resp.body, { status: resp.status, headers: h });
}

// ── Routing ──────────────────────────────────────────────────────────────────
async function handleApi(url, env) {
  const path = url.pathname.slice('/api/'.length).replace(/^\/+/, '');
  const sp = url.searchParams;
  const products = parseProducts(sp);
  const cfg = vbbConfig(env);

  // Nearby stops. This is the only call that picks a provider from geography;
  // every later call follows the id the SPA received from here.
  if (path === 'locations/nearby') {
    const lat = num(sp, 'latitude', NaN);
    const lon = num(sp, 'longitude', NaN);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return jsonResp({ error: 'latitude and longitude are required' }, 400);
    }
    const distance = Math.min(num(sp, 'distance', 700), 2000);
    const results = Math.min(num(sp, 'results', 10), 25);
    const args = { lat, lon, distance, results, cfg };
    // Inside Berlin/Brandenburg both VBB sources are asked before MOTIS;
    // outside, neither knows anything and MOTIS is the only source. Order
    // within the pair is cfg.primary, which is off while we are on the test
    // system - see vbbConfig. Each step is different infrastructure, so a step
    // down the chain is a second opinion, never a retry of the same one.
    const chain = inVbbArea(lat, lon)
      ? (cfg.enabled ? (cfg.primary ? ['vbb', 'hafas', 'motis'] : ['hafas', 'vbb', 'motis'])
                     : ['hafas', 'motis'])
      : ['motis'];
    const keyOf = (p) => `nearby|${p}|${lat.toFixed(3)}|${lon.toFixed(3)}|${distance}|${results}`;

    for (const provider of chain) {
      try {
        const r = await served(keyOf(provider), TTL.nearby, provider,
          (s) => PROVIDERS[provider].nearby(args, s));
        // An empty list is not an answer worth returning while another source
        // is left to ask: it is what a stop just outside one feed looks like.
        if (r.body.length || provider === chain[chain.length - 1]) {
          return jsonResp(r.body, 200, { 'X-Cache': r.cache, 'X-Data-Source': r.source });
        }
      } catch (e) {
        if (e.status === 503) throw e;
        if (provider === chain[chain.length - 1]) throw e;
      }
    }
    return jsonResp([], 200, { 'X-Data-Source': chain[chain.length - 1] });
  }

  const depMatch = path.match(/^stops\/(.+)\/departures$/);
  if (depMatch) {
    const { provider, id } = splitId(depMatch[1]);
    const duration = Math.min(num(sp, 'duration', 35), 180);
    const results = Math.min(num(sp, 'results', 12), 60);
    const args = { id, duration, results, products: products.mask, productSet: products.set, cfg };
    // Both VBB providers name a stop by its station number, so a board asked
    // of one can be answered by the other with the id exactly as it came in.
    // That covers the test system being down mid-journey, and an id bookmarked
    // while the access id was configured and opened after it was withdrawn.
    const chain = provider === 'vbb'
      ? (cfg.enabled ? ['vbb', 'hafas'] : ['hafas'])
      : [provider];
    let lastErr;
    for (const p of chain) {
      const key = `dep|${p}|${id}|${duration}|${results}|${products.mask}`;
      try {
        const r = await served(key, TTL.departures, p, (s) => PROVIDERS[p].departures(args, s));
        return jsonResp(r.body, 200, { 'X-Cache': r.cache, 'X-Data-Source': r.source });
      } catch (e) {
        if (e.status === 503) throw e;
        lastErr = e;
      }
    }
    throw lastErr;
  }

  const tripMatch = path.match(/^trips\/(.+)$/);
  if (tripMatch) {
    const { provider, id } = splitId(tripMatch[1]);
    // A journey reference is a token of the system that issued it, so unlike a
    // stop id it cannot be handed to another provider. If the access id is
    // gone, say so rather than asking mgate a question it cannot parse.
    if (provider === 'vbb' && !cfg.enabled) {
      return jsonResp({ error: 'this trip id needs the VBB ReST API, which is not configured' }, 503);
    }
    const key = `trip|${provider}|${id}`;
    const r = await served(key, TTL.trip, provider, (s) => PROVIDERS[provider].trip({ id, cfg }, s));
    return jsonResp(r.body, 200, { 'X-Cache': r.cache, 'X-Data-Source': r.source });
  }

  if (path === 'radar') {
    const north = num(sp, 'north', NaN), south = num(sp, 'south', NaN);
    const east = num(sp, 'east', NaN), west = num(sp, 'west', NaN);
    if (![north, south, east, west].every(Number.isFinite)) {
      return jsonResp({ error: 'north, south, east and west are required' }, 400);
    }
    // Radar is HAFAS-only; outside its area the empty list is the true answer.
    if (!inVbbArea((north + south) / 2, (east + west) / 2)) {
      return jsonResp({ movements: [] }, 200, { 'X-Data-Source': 'motis' });
    }
    const results = Math.min(num(sp, 'results', 64), 128);
    const args = { north, south, east, west, results, products: products.mask };
    const key = `radar|${north.toFixed(3)}|${south.toFixed(3)}|${east.toFixed(3)}|${west.toFixed(3)}|${results}`;
    try {
      const r = await served(key, TTL.radar, 'hafas', (s) => hafasRadar(args, s));
      return jsonResp(r.body, 200, { 'X-Cache': r.cache, 'X-Data-Source': r.source });
    } catch (e) {
      if (e.status === 503) throw e;
      // The vehicle strip is a nicety; losing it must not fail the screen.
      return jsonResp({ movements: [] }, 200, { 'X-Data-Source': 'none' });
    }
  }

  return jsonResp({ error: 'path not allowed' }, 403);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const isApi = url.pathname.startsWith('/api/');
    const isHealth = url.pathname === '/healthz';

    if (request.method === 'OPTIONS') {
      return withCors(new Response(null, { status: 204 }), request);
    }

    // Read-only service; only GET is meaningful.
    if ((isApi || isHealth) && request.method !== 'GET') {
      return withCors(jsonResp({ error: 'method not allowed' }, 405, { 'Allow': 'GET, OPTIONS' }), request);
    }

    if (isHealth) {
      const tokensRemaining = {};
      for (const name in buckets) tokensRemaining[name] = Math.floor(refill(name).tokens);
      const cfg = vbbConfig(env);
      return withCors(jsonResp({
        ok: true,
        version: '0.20',
        // The base is operational information worth seeing (test system or
        // production?); the access id is never reported, here or anywhere.
        upstreams: {
          vbb: cfg.enabled ? cfg.base : null,
          hafas: HAFAS_ENDPOINT,
          motis: MOTIS_BASE,
        },
        vbbRest: { configured: cfg.enabled, primary: cfg.primary },
        tokensRemaining,
        cacheEntries: memCache.size,
        inflight: inflight.size,
      }, 200), request);
    }

    if (isApi) {
      try {
        return withCors(await handleApi(url, env), request);
      } catch (e) {
        const status = e.status || 502;
        const extra = status === 503 ? { 'Retry-After': '2' } : {};
        return withCors(jsonResp({ error: e.message || 'upstream fetch failed' }, status, extra), request);
      }
    }

    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Not found', { status: 404 });
  },
};
