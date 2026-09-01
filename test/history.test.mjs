// Verification of the encrypted history module (public/history.js).
// Run with: node test/history.test.mjs   (no dependencies, pure Node)
//
// Unlike sun-side.test.mjs this imports the REAL module - makeHistory() takes
// pluggable storage/crypto exactly so it is testable here. Node's global
// WebCrypto stands in for window.crypto; a Map-backed stub stands in for
// localStorage.

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { makeHistory, PBKDF2_ITERS } = require('../public/history.js');

// Minimal localStorage stand-in.
function makeStorage() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    _dump: () => [...m.entries()].map(([k, v]) => `${k}=${v}`).join('\n'),
  };
}

let pass = 0, fail = 0;
function eq(actual, expected, msg) {
  const ok = actual === expected;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}  (got ${actual}, want ${expected})`);
  ok ? pass++ : fail++;
}

const storage = makeStorage();
const h = makeHistory({ storage, cryptoObj: crypto });

// ── init + basic state ──────────────────────────────────────────────────────
eq(h.exists(), false, 'no store before first unlock');
eq(h.isUnlocked(), false, 'locked before first unlock');
eq(await h.unlock(''), false, 'empty passphrase rejected');
eq(await h.unlock('korrekt-pferd-batterie'), true, 'first unlock initialises');
eq(h.exists(), true, 'store exists after init');
eq(h.isUnlocked(), true, 'unlocked after init');
eq((await h.getTrips()).length, 0, 'fresh store has no trips');
eq((await h.getStops()).length, 0, 'fresh store has no stops');

// ── round-trip across sessions ──────────────────────────────────────────────
await h.addTrip({ line: 'U9', dir: 'Osloer Str.', from: 'U Amrumer Str.', to: 'U Turmstr.' });
await h.addStop({ name: 'U Amrumer Str.', lat: 52.542, lon: 13.349 });
h.lock();
eq(h.isUnlocked(), false, 'lock drops the key');
let threw = false;
try { await h.addTrip({ line: 'X', from: 'a', to: 'b' }); } catch { threw = true; }
eq(threw, true, 'ops on a locked store throw');
eq(await h.unlock('falsche-passphrase'), false, 'wrong passphrase rejected');
eq(h.isUnlocked(), false, 'still locked after wrong passphrase');
eq(await h.unlock('korrekt-pferd-batterie'), true, 'correct passphrase unlocks again');
eq((await h.getTrips())[0].to, 'U Turmstr.', 'trip survives lock/unlock round-trip');

// ── no plaintext at rest ─────────────────────────────────────────────────────
const raw = storage._dump();
eq(raw.includes('Turmstr'), false, 'stop name is not in storage plaintext');
eq(raw.includes('U9'), false, 'line name is not in storage plaintext');

// ── dedup + cap ──────────────────────────────────────────────────────────────
await h.addTrip({ line: 'U9', dir: 'Osloer Str.', from: 'U Amrumer Str.', to: 'U Turmstr.' });
eq((await h.getTrips()).length, 1, 'same trip dedups by line+from+to');
for (let i = 0; i < 15; i++) await h.addTrip({ line: 'M13', from: 'A', to: `Stop ${i}` });
eq((await h.getTrips()).length, 12, 'trips capped at 12');

// ── full wipe ────────────────────────────────────────────────────────────────
h.clear();
eq(h.exists(), false, 'clear removes the store');
eq(h.isUnlocked(), false, 'clear drops the key');
eq(storage._dump(), '', 'clear removes the salt too - nothing left at rest');

// ── KDF floor ────────────────────────────────────────────────────────────────
eq(PBKDF2_ITERS >= 310000, true, 'PBKDF2 iterations at or above the OWASP floor');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
