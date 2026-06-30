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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
