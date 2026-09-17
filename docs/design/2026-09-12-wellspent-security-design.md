# Wellspent private vault: security design v0

Date: September 12, 2026. Status: first-pass design for review, not a finished cryptographic protocol or security audit. Read with the [architecture](2026-09-12-wellspent-local-first-architecture.md) and [research gates](2026-09-12-wellspent-research-roadmap.md).

**September 17 product decisions:** encrypted private-record sync is mandatory. Hosted AI receives selected context directly from the device by default; an optional premium route may disclose selected plaintext through Wellspent's backend. That processor is a separate trust boundary from the opaque sync relay, and payment is not consent or vault-key access. The first memory experiment is user-facing; agent feedback is deferred. See the [visual system design](2026-09-17-wellspent-system-design.md) for component boundaries and the proposed portable Rust proof. Protocol, recovery authority, retention and implementation acceptance remain open.

## 1. Promise, assumptions, and exclusions

Proposed promise: synced private-vault content is encrypted on trusted devices; Wellspent's relay cannot decrypt it. Account authentication authorizes service access, while possession of trusted cryptographic authority authorizes vault membership. Hosted AI and integrations receive only separately authorized disclosures.

Protect against relay database/backup dumps, employee access to stored private-vault content, passive network interception, account takeover without a trusted device/recovery secret, and a server attempting to enroll its own device. Authenticated encryption and membership validation must also reject forged/corrupted objects and unauthorized membership updates.

Assume trusted client binaries/updates, correct cryptographic libraries, adequate OS randomness, and an uncompromised local policy/key boundary. A malicious relay may reorder, replay, fork, suppress, or delete traffic. Do not promise availability, proof that a response is complete, or immediate detection of every fork. TLS still protects transport and authentication even though the payload has separate E2EE.

Do not claim protection against compromised unlocked devices, malware inside the app/process, malicious client updates, malicious integration providers, or an authorized recipient retaining disclosed data. Software or hardware key protection does not stop a compromised authorized process from requesting permitted decryption/signing operations. Signal-style forward secrecy, automatic post-compromise recovery, and post-quantum confidentiality are not V1 guarantees.

Account existence, public device keys/count, network addresses, object sizes, timing, epoch transitions, cursors, and synchronization frequency may leak. Keep object type and user labels encrypted unless routing demonstrably requires them. Any clear AAD is authenticated, not hidden. Padding/traffic concealment are deferred.

## 2. Data and key separation

| Domain | Trusted plaintext holders | Server-visible data |
| --- | --- | --- |
| Private vault | Authorized devices after local unlock | Ciphertext objects/attachments, authenticated envelopes, limited routing metadata |
| Device identity | Native/Rust key boundary; hardware provider if selected | Public keys, key identifiers, signed membership material |
| Local SQLite protection | Local DB key holder | Nothing by default; an encrypted backup only if explicitly uploaded |
| Recovery | User-held high-entropy secret; a deliberately authorized recovery process | Recovery ciphertext and public verification/wrapping material where required |
| Delegated integrations | Wellspent integration backend and selected providers | Scoped OAuth secrets, approved payloads, execution/trigger state, receipts |
| Hosted reasoning | Model provider and any application services carrying disclosed context | Selected prompts/tool results, execution state and disclosed artifacts |

Use distinct keys/purposes for device agreement, device signatures if selected, vault epochs, local database encryption, and recovery. Do not reuse an OAuth token-encryption key or an account password as a vault key. Long-lived vault/device/DB keys should not enter JavaScript in the proposed native bridge. Selected plaintext may enter UI memory by design; zeroization is best effort, not a claim that Swift/Kotlin/JS copies disappear immediately.

Each epoch uses fresh independent randomness. A root secret already held by a revoked device must not allow it to derive future epoch keys. If a recovery mechanism can decrypt future epochs, possession of its secret is equivalent to continued high-level vault access.

## 3. Genesis, pairing, and membership

On first creation, the device creates a vault identity and pins the genesis membership checkpoint locally. The relay's account ID routes requests but is not the trust anchor. An account-only attacker may create a different vault; existing clients must never silently replace their pinned vault with it. Product account recovery and vault recovery are distinct.

Pairing states to specify: unpaired → offer pending → out-of-band verified → approved against a membership predecessor → keys received/confirmed → active. Cancellation, expiry, duplicate requests, and interruption must have explicit results. A relay-created device row is merely pending metadata.

The pairing transcript must authenticate both roles and public keys, vault identity, protocol/suite, one-time nonce, expiry, and the membership checkpoint. The new device proves possession and confirms the same exchange; the existing device deliberately authorizes admission. Research whether a one-direction QR requires a return confirmation, a short authentication string, or a second scan. The QR must not contain an unprotected vault or recovery secret.

Membership changes need a specified signing authority and canonical encoding. Candidate: current authorized devices sign changes referencing a previous trusted membership hash. Decide who can add/remove, whether any device can revoke another, and how competing valid changes resolve. Encryption to a public key alone does not authenticate the approving device. HPKE provides recipient encryption and optional sender authentication, while replay/downgrade handling remains application work. [RFC 9180](https://www.rfc-editor.org/rfc/rfc9180.html#section-9.7).

Persist trusted membership checkpoints atomically with relevant state. Reject unauthorized signatures, substitutions, old suite negotiation, and rollback behind a locally known checkpoint. A signed hash chain is not proof of a unique latest chain: record divergent signed heads and stop unsafe merging. With only a malicious relay connecting devices, withheld history can remain undetectable until an independently trusted checkpoint or peer comparison arrives.

## 4. Records, replay, and local transactions

Candidate envelope fields: format/suite version, vault identity, epoch, object/operation IDs, author key ID, causal parents or logical revision, nonce, ciphertext, and optional author signature. Specify exactly which fields are clear versus encrypted and bind all security-relevant routing fields. Use canonical or length-delimited encoding, explicit limits, and domain separation. Never concatenate ambiguous variable-length strings for key derivation or signing.

An epoch-shared AEAD key authenticates possession of that key, not a particular device. AAD naming a device does not prove authorship. Decide whether individual record signatures are required for provenance and revocation admission; membership signatures are a separate requirement.

Nonce allocation must survive multiple writers, repeated edits, crashes, reinstall, restored backups, and retries. Compare random extended nonces against per-operation derived keys/counters under a documented usage bound. A retry should reuse the stored immutable ciphertext; changed plaintext is a new operation. Do not rely on a global counter that can roll back or be allocated independently by two devices.

Commit local operation, projection, pending delivery state, and any allocation/checkpoint changes transactionally. On download, authenticate and validate before applying; advance the delivery cursor only with durable local application or a documented quarantined outcome. Invalid objects must not silently become canonical data or permanently prevent unrelated valid records from progressing. Limits on parsing, allocation, decompression, and attachment sizes defend against malicious ciphertext traffic.

Distinguish operation identity/deduplication, causal ordering, relay delivery position, timer revision, recap revision, and membership epoch. These solve different problems. Attachments require authenticated manifests, chunk ordering/completeness checks, and independent key/nonce domains. Full chunking is deferred from the first record prototype.

## 5. Revocation, offline work, and historical exposure

A membership-authorized removal produces a fresh random epoch and envelopes only for remaining devices. Once a device has accepted that membership state, its future uploads use the new epoch. It must retain legitimate pending local work while transforming or reissuing stale-epoch uploads according to a specified rule.

Revocation cannot make a removed device forget earlier plaintext or keys. A legitimate device unaware of the removal can still produce old-epoch ciphertext after the wall-clock removal time. Therefore the defensible guarantee is protection of data encrypted under the fresh epoch after membership adoption, not instantaneous worldwide protection of every new edit. Decide whether ordinary sync accepts this eventual boundary or requires a stronger freshness mechanism that constrains offline publication.

Do not use relay timestamps to decide whether an old-epoch edit is trustworthy. Specify how to quarantine revoked-device operations, preserve unsynced work for inspection/export, and distinguish authenticated history already accepted before removal. Concurrent removals require an explicit authority/branch policy.

Long-term recipient-key compromise can expose recorded HPKE envelopes sent to that key. Consequently, retaining historical epoch envelopes can expose many past epochs, not just one compromised epoch. Envelope/key retention, recovery, and paid history must be decided together. [HPKE forward-secrecy limitation](https://www.rfc-editor.org/rfc/rfc9180.html#section-9.7.4).

## 6. Recovery, storage, and migration

All devices lost plus no usable recovery material means data loss. A recovery code without surviving ciphertext is also insufficient. Recovery must define separately: historical decryption, permission to enroll a new device, access to relay account storage, and trust in the recovered membership checkpoint.

Investigate a random high-entropy secret and recovery envelopes covering independently generated epochs. One candidate derives a recovery recipient key from the user-held secret, while ordinary devices hold only its public wrapping key. This requires review; do not distribute a secret that lets a revoked device unwrap every future recovery envelope. Decide whether recovery removes old devices and rotates recovery authority, and what a stolen recovery code exposes.

Recovery tests must include several rotations, missing envelopes, old backups, maliciously stale relay state, changed recovery code, and account takeover. After every trusted device/checkpoint is lost, proving that the server returned the newest history may require an independent recovery checkpoint/backup. Do not claim complete freshness without one. Password-based recovery and Argon2id parameter selection remain deferred unless the chosen UX requires passwords.

SQLite encryption is separate from transport encryption. Generate a random DB key and protect it through native secure storage. Specify lock/reboot/background access, backups, WAL/sidecars, exported files, indexing, diagnostics, and crash reports. A restored DB and a missing/nonportable key must trigger a clear recovery path, not destructive recreation. Signing out, locking, deleting a local copy, revoking a device, and deleting an account must be distinct operations; never automatically wipe the only local canonical copy because an auth token expired.

Protocol migration needs authenticated suite/version negotiation, minimum accepted versions, downgrade rejection, old-client quarantine/export, and interrupted-migration recovery. Replacing X25519 software identity with P-256 hardware identity requires an authorized identity transition. A server metadata edit cannot replace a trusted key. Database schema version and encrypted envelope version evolve independently.

## 7. AI, cloud capabilities, and approvals

Model tool output is a disclosure to a hosted runtime even when the tool ran locally. Aggregate and redact in the local broker before returning results. Record the permitted datasets/time range, recipient/runtime, purpose, expiry, and disclosure receipt. Read-only capabilities still have privacy impact. Removing a grant stops future access but cannot retract context already disclosed or retained in a session.

Never grant an executor access to the raw vault/keys as a shortcut around the broker. Enforce grants at each call and again before a side effect; tool descriptions and model prompts do not enforce permissions. Tool search is discovery, not authorization. Untrusted notes, issue text, calendar descriptions, and tool outputs cannot expand a grant. Sessions must not mix accounts or silently grow their accessible data.

For an external write, create a durable proposed action with an immutable payload digest, target/provider account, capability scope, preconditions, expiry, and idempotency ID. Approval binds that exact proposal and an authorized approver. Execution checks the grant, approval, revocation, and current provider state; changed parameters need a new proposal. Duplicate phone approvals and resumed agent calls must not duplicate the side effect. A timed-out provider call has an unknown outcome until reconciled.

Push notifications are hints, not authority, and should avoid private payloads by default. A signed cross-device approval can authorize a cloud action, but the integration service must necessarily see the approved payload. While every device is offline, only previously delegated capabilities/payloads can execute. Cloud job state and credential access remain a separate trust domain; a compromised service holding provider tokens is not cryptographically prevented from abusing those delegated scopes.

Wellspent owns the durable grant, approval, action state, provider receipt, cancellation, and retry policy. Provider session state helps resume reasoning but does not establish action completion. Explicitly classify transcripts, traces, notifications, integration jobs, and support logs; they must not become accidental plaintext vault replicas.

## 8. Release evidence and language

Before E2EE claims: complete the decision register; test adversarial pairing/membership/recovery transcripts, nonce/crash behavior, corrupted/oversized envelopes, replay/downgrades, conflict convergence, and cross-platform vectors; fuzz parsers; review dependencies and signed update delivery; commission external protocol/implementation review. A database scan for canary plaintext is useful leakage evidence, not a proof of cryptographic security.

Permissible future wording after acceptance: “Your synced private vault is end-to-end encrypted. You choose what context is shared with AI and connected services.” Avoid “Wellspent can never access any data,” “runs locally so nothing leaves,” immediate global revocation, or forward-secrecy claims. The present implementation has not passed these gates.
