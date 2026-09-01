/*
 * SunSide — encrypted local history (zero-knowledge, passphrase-gated)
 * ──────────────────────────────────────────────────────────────────────────
 * Stores recent stops and recent trips ENCRYPTED in the browser only. Nothing
 * leaves the device. The encryption key is derived from a user passphrase via
 * PBKDF2 and held only in memory for the session — it is never written to disk,
 * so the history is unreadable (even by this app) until the user unlocks it.
 *
 * Threat model & honest limits:
 *   - Protects against: another script/extension reading raw storage, a device
 *     backup/sync that scoops up storage, casual disk inspection, and the app
 *     itself at rest (it genuinely cannot read history without the passphrase).
 *   - Does NOT protect against: an attacker who has the passphrase, or who can
 *     run code in the page WHILE it is unlocked (they can ask it to decrypt).
 *     No browser-local scheme can. This is honest defense, not a vault.
 *   - Forgotten passphrase = unrecoverable history, by design (no server, no
 *     reset). The "clear history" control is the escape hatch.
 *
 * Crypto choices (conservative):
 *   - AES-GCM 256 for encryption (authenticated; detects tampering/wrong key).
 *   - PBKDF2-SHA256, 310,000 iterations (OWASP 2023 floor) for key derivation.
 *   - Per-record random 12-byte IV; per-store random 16-byte salt.
 *   - Storage holds only: salt, and {iv, ciphertext} blobs. No plaintext, no key.
 */

const STORE_KEY = 'sunside.history.v1';   // encrypted blob lives here
const SALT_KEY  = 'sunside.kdf-salt.v1';  // KDF salt (not secret, but per-install)
const PBKDF2_ITERS = 310000;
const MAX_STOPS = 12;
const MAX_TRIPS = 12;

// Pluggable storage + crypto so this is testable in Node. In the browser these
// default to window.localStorage and window.crypto.
function makeHistory({ storage, cryptoObj } = {}) {
  const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  const subtle = (cryptoObj || (typeof crypto !== 'undefined' ? crypto : null));
  if (!store) throw new Error('no storage available');
  if (!subtle || !subtle.subtle) throw new Error('no Web Crypto available');

  const enc = new TextEncoder();
  const dec = new TextDecoder();
  let sessionKey = null; // CryptoKey, memory-only

  const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const unb64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

  function getSalt() {
    let s = store.getItem(SALT_KEY);
    if (!s) {
      const salt = subtle.getRandomValues(new Uint8Array(16));
      s = b64(salt);
      store.setItem(SALT_KEY, s);
    }
    return unb64(s);
  }

  async function deriveKey(passphrase) {
    const salt = getSalt();
    const baseKey = await subtle.subtle.importKey(
      'raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']
    );
    return subtle.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: PBKDF2_ITERS, hash: 'SHA-256' },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function encryptObj(obj) {
    const iv = subtle.getRandomValues(new Uint8Array(12));
    const ct = await subtle.subtle.encrypt(
      { name: 'AES-GCM', iv }, sessionKey, enc.encode(JSON.stringify(obj))
    );
    return { iv: b64(iv), ct: b64(ct) };
  }

  async function decryptBlob(blob) {
    const pt = await subtle.subtle.decrypt(
      { name: 'AES-GCM', iv: unb64(blob.iv) }, sessionKey, unb64(blob.ct)
    );
    return JSON.parse(dec.decode(pt));
  }

  // ── public API ──────────────────────────────────────────────────────────

  // Is there an existing encrypted store? (decides "set passphrase" vs "unlock")
  function exists() { return !!store.getItem(STORE_KEY); }

  // Whether the session is currently unlocked.
  function isUnlocked() { return sessionKey !== null; }

  // Unlock (or initialize) with a passphrase. Returns true on success.
  // If a store exists, a wrong passphrase fails AES-GCM auth and returns false.
  async function unlock(passphrase) {
    if (!passphrase || passphrase.length < 1) return false;
    sessionKey = await deriveKey(passphrase);
    if (exists()) {
      try { await read(); }            // verify the passphrase actually decrypts
      catch { sessionKey = null; return false; }
    } else {
      await write({ stops: [], trips: [] }); // initialize an empty encrypted store
    }
    return true;
  }

  // Lock: drop the key from memory.
  function lock() { sessionKey = null; }

  async function read() {
    const raw = store.getItem(STORE_KEY);
    if (!raw) return { stops: [], trips: [] };
    return decryptBlob(JSON.parse(raw));
  }

  async function write(data) {
    const blob = await encryptObj(data);
    store.setItem(STORE_KEY, JSON.stringify(blob));
  }

  // Add a recent stop (dedup by name, most-recent-first, capped).
  async function addStop(stop) {
    if (!isUnlocked()) throw new Error('locked');
    const d = await read();
    d.stops = [stop, ...d.stops.filter(s => s.name !== stop.name)].slice(0, MAX_STOPS);
    await write(d);
    return d.stops;
  }

  // Add a recent trip (dedup by line+from+to, capped).
  async function addTrip(trip) {
    if (!isUnlocked()) throw new Error('locked');
    const key = t => `${t.line}|${t.from}|${t.to}`;
    const d = await read();
    d.trips = [trip, ...d.trips.filter(t => key(t) !== key(trip))].slice(0, MAX_TRIPS);
    await write(d);
    return d.trips;
  }

  async function getStops() { return (await read()).stops; }
  async function getTrips() { return (await read()).trips; }

  // Wipe everything, including the salt — full reset, irreversible.
  function clear() {
    store.removeItem(STORE_KEY);
    store.removeItem(SALT_KEY);
    sessionKey = null;
  }

  return { exists, isUnlocked, unlock, lock, addStop, addTrip, getStops, getTrips, clear };
}

// Export for Node tests; harmless in the browser.
if (typeof module !== 'undefined' && module.exports) module.exports = { makeHistory, PBKDF2_ITERS };
