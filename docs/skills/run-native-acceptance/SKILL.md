---
name: run-native-acceptance
description: Run or prepare Timer native acceptance for Android, iOS, or macOS lifecycle and cross-device timer behavior. Use when device proof is requested; not for ordinary Swift or React Native code review.
---

# Run native acceptance

Read the native acceptance section of `docs/verification.md` from the Timer repository root. Identify the requested platform and whether its current code controls the WebSocket prototype or durable focus sessions before selecting a scenario.

Use existing package scripts and an identified test device. The Android launcher force-stops the app and does not install it; Xcode builds/tests do not prove physical recovery or APNs delivery. Reuse the existing test account/build and session authorization where available.

Run applicable independent static checks, then the requested lifecycle/device scenario. For durable convergence, compare session identity, command IDs, revisions, pending replay, and accepted transition counts through offline process termination and reconnect. Do not claim this gate passes while the native client still uses only the prototype.

Record the checkout/build, device/OS, backend environment, scenario, observed outcome, and unrun checks using the guide's evidence fields. If device selection is ambiguous or hardware/signing is unavailable, finish independent checks and report exactly which observation needs that input. Do not reset device data or deploy a backend as an implicit acceptance step.
