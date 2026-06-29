# Encrypted local history (`history.js`)

A zero-knowledge, passphrase-gated store for SunSide's recent **stops** and **trips**.
Everything stays on the device, encrypted; nothing is transmitted. This keeps the app's
privacy posture intact while adding a "recently used" convenience.

## What it is

- **AES-GCM 256** authenticated encryption.
- **PBKDF2-SHA256, 310,000 iterations** (OWASP 2023 floor) to derive the key from a user
  passphrase.
- The key lives **only in memory** for the session — never written to disk. The history is
  unreadable, even by the app itself, until the user enters the passphrase.
- Storage holds only a per-install salt and `{iv, ciphertext}` blobs. No plaintext, no key.

## Threat model — read this

**Protects against:** another script/extension reading raw `localStorage`, a device
backup/sync that scoops up storage, casual disk inspection, and the app at rest (it
genuinely cannot decrypt without the passphrase).

**Does NOT protect against:** an attacker who knows the passphrase, or who can run code in
the page *while it is unlocked* (they can ask the app to decrypt). No browser-local scheme
can defeat this — it is honest defense-in-depth, not a vault.

**Forgotten passphrase = unrecoverable history, by design.** There is no server and no
reset. The "clear history" control is the only escape hatch. Communicate this to the user
at the point they set the passphrase.

**Critical pairing with CSP:** the biggest realistic threat to local-encrypted data is a
malicious script in your own page (XSS). This module's protection is only as strong as your
Content-Security-Policy. A strict CSP without `unsafe-inline` is what makes "another script
can't read it" actually true. Inline `<script>` blocks force `unsafe-inline` and undermine
this — move app code to external files and lock the CSP down.

## API

```js
const h = makeHistory();            // uses window.localStorage + window.crypto
h.exists();                          // is there an encrypted store yet?
await h.unlock(passphrase);          // init (first time) or unlock; false if wrong pass
h.isUnlocked();
await h.addStop({ name, lat, lon });
await h.addTrip({ line, from, to });
await h.getStops();                  // most-recent-first, deduped, capped at 12
await h.getTrips();
h.lock();                            // drop key from memory
h.clear();                           // wipe store + salt, irreversible
```

`unlock()` doubles as init: the first call with no existing store creates an empty encrypted
one; later calls verify the passphrase by attempting a decrypt and return `false` on mismatch.

## Integration sketch

1. On first use of "recent stops", prompt the user to **set a passphrase** (explain the
   no-recovery tradeoff). On later sessions, prompt to **unlock**.
2. After a successful trip selection, call `addStop()` / `addTrip()`.
3. Show recent items only while `isUnlocked()`.
4. Offer **lock** and **clear history** controls in settings.

## Privacy-notice / RoPA wording you can reuse

> SunSide can remember your recently used stops and trips. This history is stored only on
> your device, encrypted with a key derived from a passphrase you choose; it is never sent to
> any server and cannot be read without your passphrase. You can clear it at any time. If you
> forget the passphrase, the history cannot be recovered.

This processing is local-only with no transmission and no controller-side storage, which is
the strongest minimization position; it should be reflected as such in your Art. 30 records.
(Engineering guidance, not legal advice — your DPO judgment governs the notice wording.)

## Tested

Verified (18 assertions): empty-init, round-trip across sessions, wrong-passphrase rejection,
no-plaintext-in-storage, dedup, cap at 12, locked-ops-throw, full wipe, and the PBKDF2
iteration floor.
