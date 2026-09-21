// Pure-logic tests for the two-provider data layer added in v0.18.
// Run with: node test/providers.test.mjs   (no dependencies, pure Node)
//
// These mirror the rules in worker/src/index.js and public/index.html. Every
// case below is one that actually went wrong during development against live
// data, which is why it is here rather than in a comment.

let pass = 0, fail = 0;
function eq(actual, expected, msg) {
  const ok = Object.is(actual, expected);
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}  (got ${actual}, want ${expected})`);
  ok ? pass++ : fail++;
}

// ── MOTIS stop ids ───────────────────────────────────────────────────────────
// "<feed>_<DHID>", DHID = country:area:stop[:quay[:edge]]. Used for GROUPING
// platforms into a station, never to build an id we then query.
function motisParent(stopId) {
  const s = String(stopId);
  const us = s.indexOf("_");
  if (us < 0) return s;
  const parts = s.slice(us + 1).split(":");
  return parts.length > 3 ? `${s.slice(0, us)}_${parts.slice(0, 3).join(":")}` : s;
}

eq(motisParent("de-VBB_de:11000:900110007::3"), "de-VBB_de:11000:900110007",
  "VBB spells the platform '::3'");
eq(motisParent("de-DELFI_de:13003:1489:1:1"), "de-DELFI_de:13003:1489",
  "DELFI spells it ':quay:edge' - the bug that left six Rostock Hbf rows");
eq(motisParent("de-DELFI_de:13075:8081"), "de-DELFI_de:13075:8081",
  "an id already at station level is unchanged");
eq(motisParent("eu-flixbus_dcbb121a"), "eu-flixbus_dcbb121a",
  "an opaque non-DHID id is left alone");

// ── Stop-name collapsing ─────────────────────────────────────────────────────
// DELFI aggregates feeds, so one station arrives under several ids that no id
// arithmetic reconciles. Names are what a rider compares.
const normaliseStopName = (name) => String(name || "")
  .toLowerCase()
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

eq(normaliseStopName("Rostock, Hauptbahnhof"), normaliseStopName("Rostock Hauptbahnhof"),
  "a comma does not make it a different station");
eq(normaliseStopName("Schönhauser Allee/Bornholmer Str."), "schonhauser allee bornholmer str",
  "umlauts fold and punctuation becomes a separator");
eq(normaliseStopName("Greifswald Feldstraße") === normaliseStopName("Greifswald Feldstrasse"), false,
  "ss and sz are NOT folded together - that would need a German-specific rule");

// ── HAFAS time parsing ───────────────────────────────────────────────────────
// Dates "YYYYMMDD", times "HHMMSS" with an optional leading day offset for
// boards that run past midnight.
const pad = (n, w = 2) => String(n).padStart(w, "0");
function berlinOffsetMs(instant) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Berlin", hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(instant);
  const p = {};
  for (const { type, value } of parts) p[type] = value;
  const hour = p.hour === "24" ? 0 : Number(p.hour);
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day),
    hour, Number(p.minute), Number(p.second)) - instant.getTime();
}
function berlinWallToInstant(y, mo, d, h, mi, s) {
  const wallAsUtc = Date.UTC(y, mo - 1, d, h, mi, s);
  let instant = wallAsUtc;
  for (let i = 0; i < 2; i++) instant = wallAsUtc - berlinOffsetMs(new Date(instant));
  return new Date(instant);
}
function isoBerlin(instant) {
  const off = berlinOffsetMs(instant);
  const local = new Date(instant.getTime() + off);
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off) / 60000;
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}` +
    `T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}
function hafasTime(dateStr, timeStr) {
  if (!dateStr || timeStr == null) return null;
  const t = String(timeStr);
  const dayOffset = t.length > 6 ? Number(t.slice(0, t.length - 6)) : 0;
  const hms = t.slice(-6);
  return isoBerlin(berlinWallToInstant(
    Number(dateStr.slice(0, 4)), Number(dateStr.slice(4, 6)),
    Number(dateStr.slice(6, 8)) + dayOffset,
    Number(hms.slice(0, 2)), Number(hms.slice(2, 4)), Number(hms.slice(4, 6))));
}

eq(hafasTime("20260921", "164700"), "2026-09-21T16:47:00+02:00",
  "summer time carries +02:00, the offset the old upstream emitted");
eq(hafasTime("20260115", "081500"), "2026-01-15T08:15:00+01:00",
  "winter time carries +01:00");
eq(hafasTime("20260921", "01001500"), "2026-09-22T00:15:00+02:00",
  "a day-offset prefix rolls over midnight, not into hour 24");
eq(hafasTime("20260921", null), null, "a missing time stays null, never epoch zero");
// The DST switch: 2026-10-25, clocks go back at 03:00 CEST -> 02:00 CET.
eq(hafasTime("20261025", "010000"), "2026-10-25T01:00:00+02:00",
  "before the autumn switch the offset is still +02:00");
eq(hafasTime("20261025", "040000"), "2026-10-25T04:00:00+01:00",
  "after the autumn switch it is +01:00");

// ── Product mapping ──────────────────────────────────────────────────────────
const HAFAS_BITS = { suburban: 1, subway: 2, tram: 4, bus: 8, ferry: 16, express: 32, regional: 64 };
function productFromCls(cls) {
  for (const name in HAFAS_BITS) if (HAFAS_BITS[name] === cls) return name;
  return "regional";
}
eq(productFromCls(4), "tram", "cls 4 is a tram");
eq(productFromCls(8), "bus", "cls 8 is a bus - including a tram line's replacement service");
eq(productFromCls(1), "suburban", "cls 1 is the S-Bahn");
eq(productFromCls(4096), "regional", "an unknown class degrades to regional, not to undefined");

// ── boardingIndex: where the rider gets on ───────────────────────────────────
// Mirror of the client rule. Four strategies, each covering a case the one
// before it gets wrong.
function haversine(la1, lo1, la2, lo2) {
  const R = 6371, r = Math.PI / 180;
  const dLa = (la2 - la1) * r, dLo = (lo2 - lo1) * r;
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(dLo / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function boardingIndex(stopovers, dep) {
  const byId = stopovers.findIndex(s => s.stop?.id && s.stop.id === dep._sId);
  if (byId >= 0) return byId;
  const target = Date.parse(dep.plannedWhen || dep.when || "");
  if (Number.isFinite(target)) {
    const byTime = stopovers.findIndex(s => {
      const t = Date.parse(s.plannedDeparture || s.plannedArrival || "");
      return Number.isFinite(t) && Math.abs(t - target) <= 60000;
    });
    if (byTime >= 0) return byTime;
  }
  if (dep._sLat != null && dep._sLon != null) {
    let best = -1, bestKm = Infinity;
    stopovers.forEach((s, i) => {
      const l = s.stop?.location;
      if (!l || l.latitude == null) return;
      const km = haversine(dep._sLat, dep._sLon, l.latitude, l.longitude);
      if (km < bestKm) { bestKm = km; best = i; }
    });
    if (best >= 0 && bestKm <= 0.4) return best;
  }
  const byName = stopovers.findIndex(s => s.stop?.name === dep._sName);
  return byName >= 0 ? byName : 0;
}

const so = (id, name, lat, lon, pDep) =>
  ({ stop: { id, name, location: lat == null ? null : { latitude: lat, longitude: lon } },
     plannedDeparture: pDep });

const ROUTE = [
  so("x~1", "Origin", 52.500, 13.400, "2026-09-21T16:45:00+02:00"),
  so("x~2", "Middle", 52.520, 13.410, "2026-09-21T16:52:00+02:00"),
  so("x~3", "Later", 52.540, 13.420, "2026-09-21T17:00:00+02:00"),
];

eq(boardingIndex(ROUTE, { _sId: "x~2" }), 1, "an exact id match wins");

// HAFAS master station: the board lists a service calling a few hundred metres
// away, so the id is absent - but the scheduled time is the same document.
eq(boardingIndex(ROUTE, { _sId: "x~99", plannedWhen: "2026-09-21T16:52:00+02:00" }), 1,
  "scheduled time identifies the stop when the id does not");

// A flat realtime prognosis repeats one time for every remaining stop, which
// is why the rule keys on the SCHEDULED time and not on `when`.
eq(boardingIndex(ROUTE, { _sId: "x~99", plannedWhen: "2026-09-21T17:00:00+02:00",
  when: "2026-09-21T16:45:00+02:00" }), 2,
  "plannedWhen is preferred over a delayed live time");

eq(boardingIndex(ROUTE, { _sId: "x~99", _sLat: 52.5201, _sLon: 13.4101 }), 1,
  "coordinates resolve it when ids differ across feeds");
eq(boardingIndex(ROUTE, { _sId: "x~99", _sLat: 52.9, _sLon: 13.9 }), 0,
  "a far-away coordinate does not match; it falls through");
eq(boardingIndex(ROUTE, { _sId: "x~99", _sName: "Later" }), 2,
  "the name is the last resort before the origin");
eq(boardingIndex(ROUTE, { _sId: "x~99" }), 0,
  "with nothing to go on, start at the trip's origin");
// The reported failure: an S3 out of Rostock that starts in Güstrow. Falling
// back to the origin there offers stops the rider passed half an hour ago.
eq(boardingIndex(ROUTE, { _sId: "x~99", _sLat: 52.5399, _sLon: 13.4199,
  plannedWhen: "2026-09-21T17:00:00+02:00" }), 2,
  "mid-route boarding is found, not mistaken for the origin");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
