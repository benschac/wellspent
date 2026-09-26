# macOS architecture cleanup

Status: steps 1, 2, and 5 complete. Steps 3, 4, and 6 deferred.
Scope: `apps/macos`
Date: 2026-09-26

## Why

The layering in `apps/macos` is sound in pattern but no longer true in fact.
`Services/` depends upward on `Features/`, because the Recording domain's value
types live in `Features/Recording/`. Recording has grown from a feature into a
subsystem and the folder layout was never re-levelled to match.

Nothing here is a rewrite. Steps 1 and 2 are file moves that make the layer
diagram honest; steps 3–6 are optional and can wait.

`TimerMac.xcodeproj` uses `PBXFileSystemSynchronizedRootGroup`, so
groups follow the filesystem, so these moves need no pbxproj edits.
The implementation uses filesystem renames to leave existing index state untouched.

## What is already right (do not "fix" these)

- **Real composition root.** `App/TimerAppComposition.swift` — constructor
  injection with defaults, no singletons, explicit `start()`/`shutdown()`
  ordering, and `shutdown()` returning `Bool` so a failed recording save can veto
  quit. Covered by `TimerAppCompositionTests`.
- **Persistence behind a protocol**, with tests running against fixtures rather
  than SQLite.
- **One type per file, small files.** ~17.6k lines over ~135 files; median well
  under 100 lines.
- **A shared package layer already exists.** `packages/liquid-ui`
  (`Sources/LiquidUI/TimerLiquidShape.swift`, `TimerLiquidSurface.swift`) holds
  extracted geometry shared with iOS via `ios/ExpoLiquidView.swift`. Precedent for
  step 4 is already set.

---

## Step 1 — Add a `Model/` layer (highest value; do this one first)

**Problem.** These types live in `Features/Recording/` but are the entire
vocabulary of `Services/Recording/`. `Services/Recording/RecordingRepository.swift:3-30`
cannot compile without the Features layer. Five of eleven service files depend
upward.

**Fix.** Create `TimerMac/Model/Recording/` and move the pure, `Foundation`-only
value types there. Features and Services both then depend *down* onto Model.

```sh
cd apps/macos
mkdir -p TimerMac/Model/Recording

# Value types currently misfiled under Features/
git mv TimerMac/Features/Recording/RecordingEvent.swift                TimerMac/Model/Recording/
git mv TimerMac/Features/Recording/RecordingSnapshot.swift             TimerMac/Model/Recording/
git mv TimerMac/Features/Recording/RecordingError.swift                TimerMac/Model/Recording/
git mv TimerMac/Features/Recording/RecordingWorkNote.swift             TimerMac/Model/Recording/
git mv TimerMac/Features/Recording/RecordingTaskAttribution.swift      TimerMac/Model/Recording/
git mv TimerMac/Features/Recording/RecordingTelemetryObservation.swift TimerMac/Model/Recording/

# Wire contracts must come too, or Model would depend on Services (see closure note)
git mv TimerMac/Services/Recording/CodexIntakeContract.swift    TimerMac/Model/Recording/
git mv TimerMac/Services/Recording/CodexTelemetryContract.swift TimerMac/Model/Recording/
git mv TimerMac/Services/Recording/LocalHarnessContract.swift   TimerMac/Model/Recording/
```

**Closure note — why the three contract files are in the list.** The move set has
to be closed under its own references or the inversion just moves house:

- `RecordingEvent.swift` references `RecordingWorkNote`, `RecordingError`
- `RecordingWorkNote.swift` references `CodexIntakeContract` and `LocalHarnessContract`
- `RecordingTelemetryObservation.swift` references `CodexIntakeContract`, `CodexTelemetryContract`
- `RecordingTaskAttribution.swift` references only types inside the set

The three contract files import just `CryptoKit` + `Foundation` and reference
types inside this move set, so the resulting Model layer has **no outward
dependencies**. The original proposal omitted `LocalHarnessContract`; current
source inspection caught the additional reference from `RecordingWorkNote`. They are named "Contract" and are wire/DTO definitions —
Model is the honest home regardless.

The crash harness at `apps/macos/scripts/recording-durability.mjs` explicitly
lists these sources. Update all nine paths along with the moves.

**Deliberately staying in `Features/Recording/`:** `RecordingTimeline.swift` is
derived presentation state (only the four `RecordingTimeline*View` /
`RecordingReviewContent` files use it). Same for `RecordingStatusLabel`.

**Verify:**

```sh
# Model must reference nothing outside itself
grep -rn 'import ' TimerMac/Model/Recording/   # expect only Foundation / CryptoKit

# No Services -> Features dependency should survive Step 2
grep -rl 'RecordingModel\|LocalCodexIntakeModel\|LocalHarnessModel' TimerMac/Services
```

---

## Step 2 — Move `ForegroundApplicationMonitor` out of `Services/`

**Problem.** After step 1 this is the *only* remaining `Services → Features`
dependency. `Services/Recording/ForegroundApplicationMonitor.swift` holds a
`RecordingModel` (a `Features` `@Observable`) and calls
`recording.recordForegroundApplication(_:)` / `suspendForLifecycle(reason:)`. It
is an app-layer adapter over `NSWorkspace`, not a service.

Its test already lives at `TimerMacTests/Features/Recording/ForegroundApplicationMonitorTests.swift`,
so this move also fixes one of the mismatches in step 5.

```sh
git mv TimerMac/Services/Recording/ForegroundApplicationMonitor.swift \
       TimerMac/Features/Recording/
```

After this, the `grep` at the end of step 1 should return nothing. **Stop here if
short on time** — the layer diagram is now true and the rest is optional.

---

## Step 3 — Split `RecordingModel` (605 lines, 4 responsibilities)

**Problem.** `Features/Recording/RecordingModel.swift` carries event
queue/lifecycle, task attribution, Codex intake, and harness. 15 files reference
it. The file already signals the strain: `loadTelemetryReview` sits at line 18,
wedged between stored properties that resume at line 22. Declarations only drift
like that once a file is too big to hold in your head.

**Fix.** Apply the pattern the file already uses twice:

```swift
@ObservationIgnored lazy var codex = LocalCodexIntakeModel(recording: self)
@ObservationIgnored lazy var harness = LocalHarnessModel(recording: self)
```

Add a third: `RecordingTaskModel`. The seam is already clean — it owns
`taskAttribution`, `taskErrorMessage`, `tasksLoaded`, `pendingTaskAction`, the
`canEditTasks` / `canSelectRecordingTask` guards, and its own
commit/retry/discard path (`commitTaskAction`, `reloadTaskAttribution`,
`drainTaskCaptureQueue`). Roughly 150 lines out.

Cheaper interim option if the full split feels risky: keep one type, split the
file into `RecordingModel+Tasks.swift` via extensions. Fixes readability, not
coupling.

Update `TimerMacTests/Features/Recording/RecordingTaskModelTests.swift` to target
the new type.

---

## Step 4 — Consolidate the frosted surfaces

**Problem.** Four independent takes on the same idea:

| File | Approach |
|---|---|
| `Features/FloatingTimer/TimerFrostedBackdrop.swift` | `NSViewRepresentable` + contour mask |
| `Features/FloatingTimer/TimerFrostedView.swift` | the AppKit view itself |
| `Features/Settings/SettingsFrostedMaterial.swift` | same view, no mask |
| `Features/Settings/SettingsFrostedBackdrop.swift` | flat `windowBackgroundColor` |
| `Features/Focus/FocusPanelBackdrop.swift` | its own `NSVisualEffectView` |

`SettingsFrostedMaterial.swift:6` reaches sideways into
`FloatingTimer/TimerFrostedView` — a cross-feature dependency for a shared
primitive, which is the one thing a Features split exists to prevent.

**Fix.** One home for the primitive plus its small variants. Two options:

- `TimerMac/Shared/Surfaces/` if it stays macOS-only (simpler).
- `packages/liquid-ui/Sources/LiquidUI/` if any of it should follow
  `TimerLiquidSurface` to iOS. Check before assuming — `NSVisualEffectView` does
  not cross over.

Small win on its own; the point is that it stops the next sideways reach.

---

## Step 5 — Finish the test-tree migration

**Problem.** Half-migrated: 25 flat files at `TimerMacTests/` root, 26 already in
`Features/` + `Services/` subdirs. `TimerModelTests` is at root while
`RecordingModelTests` is nested.

```sh
cd apps/macos/TimerMacTests
mkdir -p App Features/Focus Features/Settings Features/FloatingTimer \
         Features/Stopwatch Services/Focus Services/Auth Services/Realtime

git mv TimerAppCompositionTests.swift       App/
git mv TimerStatusItemControllerTests.swift App/

git mv FocusModelTests.swift    Features/Focus/
git mv FocusMutationTests.swift Features/Focus/

git mv SettingsSidebarLockTests.swift Features/Settings/
git mv SettingsStoreTests.swift       Features/Settings/

git mv TimerDetachmentHapticTests.swift Features/FloatingTimer/
git mv TimerDragGestureTests.swift      Features/FloatingTimer/
git mv TimerDragViewTests.swift         Features/FloatingTimer/
git mv TimerFrostedViewTests.swift      Features/FloatingTimer/
git mv TimerHandleAppearanceTests.swift Features/FloatingTimer/
git mv TimerSidebarLayoutTests.swift    Features/FloatingTimer/
git mv TimerSidebarMotionTests.swift    Features/FloatingTimer/
git mv TimerWidgetGeometryTests.swift   Features/FloatingTimer/
git mv TimerLiquidShapeTests.swift      Features/FloatingTimer/

git mv TimerAccessibilityTests.swift       Features/Stopwatch/   # TimerFormatting
git mv TimerFormattingTests.swift          Features/Stopwatch/
git mv TimerModelTests.swift               Features/Stopwatch/
git mv TimerProjectionTests.swift          Features/Stopwatch/
git mv TimerRecordingControllerTests.swift Features/Stopwatch/
git mv TimerSyncStatusTests.swift          Features/Stopwatch/   # TimerCommandTracker

git mv FocusAPIClientTests.swift          Services/Focus/
git mv FocusAuthTests.swift               Services/Auth/
git mv FocusAuthConfigurationTests.swift  Services/Auth/
git mv TimerRealtimeContractTests.swift   Services/Realtime/
```

Implementation decisions:

- `TimerLiquidShapeTests.swift` stays in the app test target and moves to
  `Features/FloatingTimer/`: it also exercises `TimerFrostedView` and app geometry,
  so transferring the whole suite to LiquidUI would introduce app dependencies.
- `Features/Recording/RecordingSnapshotTests.swift` and
  `RecordingSnapshotFixture.swift` move to `Model/Recording/` with their subject.
- The Codex prototype/SQLite integration tests remain under `Services/Recording/`.

---

## Step 6 — Segregate `RecordingRepository` (largest, lowest urgency)

**Problem.** A 17-method protocol spanning four concerns, and the tell is
`Services/Recording/RecordingRepository.swift:33-66`: a block of default
implementations that throw `.invalidStore` so fixtures can skip methods they
don't need. `SQLiteRecordingRepository.swift` is 760 lines — migrations plus four
concerns' queries.

**Fix.** Split into `RecordingEventStore`, `CodexGrantStore`,
`CodexTelemetryStore`, `TaskAttributionStore`, each with a SQLite implementation
sharing one `DatabaseQueue` provider (the existing `database()` /
`access(_:)` helpers at `SQLiteRecordingRepository.swift:538-549` are already
that seam).

**Preserve the safety intent.** The comment above those defaults — "Synthetic
fixtures and unavailable repositories do not silently enable local intake" — is
load-bearing. Separate protocols honor it *better*: a fixture then cannot
inherit a throwing stub by accident, it simply doesn't conform. Don't drop the
guarantee while refactoring; the four migrations
(`recording-v1`, `codex-local-grants-v1`, `local-task-attribution-v2`,
`codex-telemetry-v3`) and the open-time schema validation must keep working
unchanged.

---

## Also worth a line

`Features/Stopwatch/TimerModel.swift` imports AppKit for `NSWorkspace`
sleep/wake (lines 198, 216) — a system service inside a view model. A
`SystemPowerEvents` protocol in `Services/` would let `TimerModel` be tested
without AppKit. Low priority.

## Verification after any step

```sh
bunx turbo run lint  --filter=@repo/macos
bunx turbo run build --filter=@repo/macos
bunx turbo run test  --filter=@repo/macos
```

Crash-durability checks are separate. Run them after step 1 because the harness
source paths change, and after step 6 for persistence behavior:

```sh
bun run --cwd apps/macos test:recording:crash
bun run --cwd apps/macos test:codex:crash
```


## Implementation evidence — September 26, 2026

Steps 1, 2, and 5 move 37 Swift files without changing their contents: nine
Recording model/contract files, the foreground monitor, and 27 tests/fixtures.
The Xcode project is unchanged. `recording-durability.mjs` now resolves all nine
moved domain sources. Existing unrelated working-tree changes were preserved.

The Model closure was checked with a standalone Swift 6 typecheck of only
`TimerMac/Model/Recording/*.swift`. It imports only Foundation and CryptoKit.
Services no longer reference `RecordingModel`, `LocalCodexIntakeModel`, or
`LocalHarnessModel`; the test root has no remaining flat Swift files.

Executed checks:

- `bun run --cwd apps/macos lint` — passed.
- `bun run --cwd apps/macos build` — passed (unsigned Debug build).
- `bun run --cwd apps/macos test` — passed: 278 tests, 384 executions including
  parameterized cases, zero failures or skips in Xcode's result summary.
- `bun run --cwd apps/macos test:recording:crash` — passed all four termination
  checkpoints. The final `test:codex:crash` run repeated those four after the
  additional `LocalHarnessContract` move and passed all five Codex checkpoints.
- Standalone Swift 6 Model typecheck, byte-for-byte comparison of all 37 moves,
  and `git diff --check` — passed.

Xcode and the crash runners required host access to Swift's compiler/package
caches; their initial sandbox attempts could not write those caches.
Steps 3, 4, and 6 remain deferred. File organization does not establish live
capture, manual visual acceptance, or signed distribution readiness.
