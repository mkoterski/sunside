// Minimal verification of the correctness-critical math: bearing + sun side.
// Run with: node test/sun-side.test.mjs   (no dependencies, pure Node)
//
// These are the same formulas used in public/index.html. Kept here as a separate
// testable copy so the logic can be checked deterministically against known
// geometry without a browser. If you later modularise the client, import the
// real functions here instead of duplicating them.

function bearing(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const dL = (lon2 - lon1) * r;
  const y = Math.sin(dL) * Math.cos(lat2 * r);
  const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) -
            Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos(dL);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function sideForBearing(sunAz, b) {
  const rel = (sunAz - b + 360) % 360;
  if (rel >= 25 && rel < 155) return "right";   // sun on right  -> shade LEFT
  if (rel >= 205 && rel < 335) return "left";    // sun on left   -> shade RIGHT
  return "neutral";
}

// Distance-weighted fraction of the ride exposed to a sun-struck side (0..1).
// The best-departure finder ranks departures on this; lower = shadier.
function sunnyExposure(legs, sunAz, sunEl) {
  if (sunEl < -3) return 0;
  let tot = 0, exp = 0;
  for (const l of legs) {
    tot += l.km;
    if (sunEl > 3 && sideForBearing(sunAz, l.bearing) !== "neutral") exp += l.km;
  }
  return tot > 0 ? exp / tot : 0;
}

let pass = 0, fail = 0;
function eq(actual, expected, msg) {
  const ok = actual === expected;
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}  (got ${actual}, want ${expected})`);
  ok ? pass++ : fail++;
}
function near(actual, expected, tol, msg) {
  const ok = Math.abs(actual - expected) <= tol;
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}  (got ${actual.toFixed(1)}, want ~${expected})`);
  ok ? pass++ : fail++;
}

// ── Bearing sanity ──────────────────────────────────────────
// Due north: same lon, higher lat.
near(bearing(52.50, 13.40, 52.55, 13.40), 0, 1, "due north");
// Due east: same lat, higher lon.
near(bearing(52.50, 13.40, 52.50, 13.50), 90, 1, "due east");
// Due south.
near(bearing(52.55, 13.40, 52.50, 13.40), 180, 1, "due south");

// ── Sun side: the core correctness check ────────────────────
// Northbound vehicle (bearing 0), sun due east (az 90).
// East is on the right of a northbound vehicle -> recommend LEFT.
eq(sideForBearing(90, 0), "right", "N-bound, morning E sun hits right");
// Northbound, sun due west (az 270) -> sun on left -> recommend RIGHT.
eq(sideForBearing(270, 0), "left", "N-bound, evening W sun hits left");
// Eastbound vehicle (bearing 90), sun due south (az 180, typical midday).
// South is on the right of an eastbound vehicle -> recommend LEFT.
eq(sideForBearing(180, 90), "right", "E-bound, midday S sun hits right");
// Westbound vehicle (bearing 270), sun due south (az 180).
// South is on the left of a westbound vehicle -> recommend RIGHT.
eq(sideForBearing(180, 270), "left", "W-bound, midday S sun hits left");
// Sun straight ahead -> neutral.
eq(sideForBearing(5, 0), "neutral", "sun ahead is neutral");
// Sun behind -> neutral.
eq(sideForBearing(185, 0), "neutral", "sun behind is neutral");

// ── Flip scenario: a route that turns from N to E under a south sun ──
// Leg 1 heading north (0): south sun (180) is behind -> neutral.
// Leg 2 heading east (90): south sun (180) is on the right -> shade LEFT.
// So the recommendation should change from none to LEFT - a real mid-trip flip.
eq(sideForBearing(180, 0), "neutral", "flip leg1 N under S sun");
eq(sideForBearing(180, 90), "right", "flip leg2 E under S sun");

// ── Sunny-side exposure (best-departure finder) ─────────────
// Sun below horizon: every departure equal, exposure is 0.
eq(sunnyExposure([{ bearing: 0, km: 1 }], 90, -5), 0, "sun below horizon -> 0");
// Northbound ride, sun due east well up: side-on the whole way -> exposure 1.
near(sunnyExposure([{ bearing: 0, km: 2 }], 90, 30), 1, 1e-9, "fully side-on -> 1");
// Sun straight ahead the whole ride: neutral, no sunny side -> 0.
eq(sunnyExposure([{ bearing: 0, km: 1 }], 5, 30), 0, "sun ahead -> 0 exposure");
// Mixed: one side-on leg (N-bound under E sun) + one neutral leg (E-bound under
// E sun), equal length -> half the ride exposed.
near(sunnyExposure([{ bearing: 0, km: 1 }, { bearing: 90, km: 1 }], 90, 30), 0.5, 1e-9, "half exposed");
// Low sun (0..3 deg) is not yet treated as a window problem -> 0 despite side-on.
eq(sunnyExposure([{ bearing: 0, km: 1 }], 90, 1), 0, "sun under 3 deg -> 0 exposure");

// ── v2A additions (route spine + shade meter invariants) ─────────────────────

// The shade meter's per-side km totals must sum to the trip total, whatever the
// sun does. Mirror of calcSun's weight loop.
function kmBySide(legs, sunAz, sunEl) {
  const w = { left: 0, right: 0, neutral: 0 };
  for (const l of legs) w[sunEl < -3 ? "neutral" : sideForBearing(sunAz, l.bearing)] += l.km;
  return w;
}
const METER_LEGS = [{ bearing: 0, km: 1.2 }, { bearing: 90, km: 0.8 }, { bearing: 45, km: 0.5 }];
const w = kmBySide(METER_LEGS, 180, 40);
near(w.left + w.right + w.neutral, 2.5, 1e-9, "meter km shares sum to trip total");
const wDown = kmBySide(METER_LEGS, 180, -10);
near(wDown.neutral, 2.5, 1e-9, "sun below horizon -> all km neutral");

// The flip stop the spine tags must be the one the existing flipAt logic finds.
// Mirror of calcSun's flip-detection loop.
function findFlip(legs, sunAz) {
  const shadeOf = s => s === "left" ? "right" : s === "right" ? "left" : null;
  let firstReco = null;
  for (let i = 0; i < legs.length; i++) {
    const reco = shadeOf(sideForBearing(sunAz, legs[i].bearing));
    if (reco) {
      if (firstReco === null) firstReco = reco;
      else if (reco !== firstReco) return legs[i].from;
    }
  }
  return null;
}
// E-bound under a southern sun (shade left), then W-bound (shade right):
// the flip is tagged at the second leg's from-stop.
eq(findFlip([{ bearing: 90, km: 1, from: "A" }, { bearing: 270, km: 1, from: "B" }], 180), "B",
  "spine flip tag matches flipAt logic");
eq(findFlip([{ bearing: 90, km: 1, from: "A" }, { bearing: 100, km: 1, from: "B" }], 180), null,
  "no flip tag on a straight-ish route");

// ── F3: follow-the-ride clock index ──────────────────────────────────────────
// Mirror of the app's clockIdx: index of the last arrival at or before `now`;
// 0 before the first; missing arrivals are skipped, not advanced past.
function clockIdx(arrivals, now) {
  let idx = 0;
  arrivals.forEach((a, i) => { if (a && new Date(a).getTime() <= now) idx = i; });
  return idx;
}
const T0 = Date.parse("2026-09-01T15:00:00Z");
const ARR = [null, "2026-09-01T15:03:00Z", "2026-09-01T15:06:00Z", "2026-09-01T15:09:00Z"];
eq(clockIdx(ARR, T0), 0, "before first arrival -> boarding stop");
eq(clockIdx(ARR, T0 + 4 * 60000), 1, "between arrivals -> last stop reached");
eq(clockIdx(ARR, T0 + 60 * 60000), 3, "long past the end -> exit stop, no overrun");
eq(clockIdx([null, null, "2026-09-01T15:06:00Z", null], T0 + 7 * 60000), 2,
  "missing arrivals are skipped, not advanced past");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
