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

// The needle for the no-plaintext check below, and therefore deliberately
// distinctive rather than realistic. The check used to look for the line name
// "U9", which is two characters from base64's own 64-character alphabet: in a
// few hundred characters of ciphertext that pair turns up by chance about once
// in ten runs, so a correctly encrypted store failed the suite at random - and
// because `npm test` chains the suites with &&, took the provider tests down
// with it. A long needle cannot be produced by luck.
const LINE = 'U9-plaintext-canary';

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
await h.addTrip({ line: LINE, dir: 'Osloer Str.', from: 'U Amrumer Str.', to: 'U Turmstr.' });
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
// Everything a snooper with the device could read: the serialised store as it
// sits in localStorage, plus every base64 field decoded back to bytes. The
// decode matters because base64 expands a 3-byte window into 4 characters from
// a 64-symbol alphabet, which makes short strings far likelier to appear there
// by chance than in the bytes they encode.
function atRest() {
  const raw = storage._dump();
  const decoded = [...raw.matchAll(/[A-Za-z0-9+/]{16,}={0,2}/g)]
    .map((m) => Buffer.from(m[0], 'base64').toString('latin1'))
    .join('\n');
  return `${raw}\n${decoded}`;
}

eq(atRest().includes('Turmstr'), false, 'stop name is not in storage plaintext');
eq(atRest().includes(LINE), false, 'line name is not in storage plaintext');

// A check that cannot fail proves nothing, so make it fail on purpose: a
// plaintext field written beside the encrypted blob has to be caught.
storage.setItem('sunside.leak-probe', JSON.stringify({ line: LINE }));
eq(atRest().includes(LINE), true, 'the check does catch a field written in the clear');
storage.removeItem('sunside.leak-probe');
eq(atRest().includes(LINE), false, 'and the store is clean again once it is gone');

// ── dedup + cap ──────────────────────────────────────────────────────────────
await h.addTrip({ line: LINE, dir: 'Osloer Str.', from: 'U Amrumer Str.', to: 'U Turmstr.' });
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
