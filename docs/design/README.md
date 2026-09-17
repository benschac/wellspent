# Wellspent architecture and design index

Browse these sources in the [documentation app](../../apps/docs/README.md): run `bun run dev:docs` and open <http://127.0.0.1:3002/docs/architecture/system-design>. Edit the canonical Markdown here; the site rebuilds it automatically.

Start with the [visual system design](2026-09-17-wellspent-system-design.md) and its [diagram walkthrough](2026-09-17-wellspent-system-design.html). Use [WELLSPENT_PLAN.md](../WELLSPENT_PLAN.md) for the active task queue and status. Dates in these documents identify evidence or decisions; an older “next step” is not a current instruction.

## System design and decisions

| Document | Role |
| --- | --- |
| [September 17 system design](2026-09-17-wellspent-system-design.md) | Current/target diagrams, evidence model, portable Rust boundary, sync/disclosure flows, experiment order and open choices |
| [Local-first architecture](2026-09-12-wellspent-local-first-architecture.md) | Independent device roles, ownership, migration and memory-service candidates |
| [Security design](2026-09-12-wellspent-security-design.md) | Proposed trust, membership, key epochs, recovery, disclosure and security limitations; not a completed audit |
| [Research register](2026-09-12-wellspent-research-roadmap.md) | R01–R15 and acceptance gates; September 17 promotes crypto/replication questions into the architecture sprint |
| [Agent spend/workflow discovery](2026-09-08-agent-spend-and-workflow-discovery.md) | Earlier telemetry-source inventory, task/run/accounting hypotheses and evaluation ideas; recheck sources before implementation |
| [August Focus architecture](2026-08-29-focus-timer-product-and-sync-architecture.md) | Legacy plaintext/server-authoritative design, existing implementation checkpoint and useful failure matrix; not the new E2EE target |
| [Mac interface audit](2026-09-12-macos-interface-and-architecture-audit.md) | Historical findings and completed ownership extraction; revalidate remaining findings before changing code |

## Capture implementation and dated evidence

| Document | Read it for |
| --- | --- |
| [Workflow-capture execution plan](2026-09-12-wellspent-workflow-capture-plan.md) | C2–C5 scope and historical acceptance, subordinate to the current queue |
| [Signal matrix](2026-09-12-wellspent-capture-signal-matrix.md) | Field availability, permissions, recording policy and evidence limits |
| [Synthetic recording proof](2026-09-12-macos-synthetic-recording-proof.md) | Original persistence/lifecycle proof, superseded storage implementation below |
| [SQLiteData migration](2026-09-13-macos-sqlitedata.md) | Current native persistence owner, dependency pins and durability evidence |
| [C3a intake contract](2026-09-13-c3a-local-codex-intake.md) | Original synthetic contract, exact bytes/identity/ACK rules |
| [C3b native intake](2026-09-13-c3b-local-codex-intake.md) | Implemented ordinary hook intake and selected live Debug restart proof |
| [C4a local log_work](2026-09-14-c4a-local-log-work.md) | Explicit note semantics, development connection and dated acceptance limits |
| [Timer controls](2026-09-14-timer-recording-wiring.md) | Local user timer intent controls capture; remote snapshots do not |
| [Codex session reuse](2026-09-16-codex-session-reuse.md) | Connection repair versus interval-bound automatic metadata |
| [Settings recording UI](2026-09-16-recordings-settings-ui.md) | Recording review location and newest-first ordering |

## Architecture documentation outside this directory

| Document | Role |
| --- | --- |
| [Repository README](../../README.md) | Application/package map, local services, existing integrations |
| [Mac guide](../../apps/macos/README.md), [desktop guide](../../apps/desktop/README.md) | Native app and separate Tauri shell |
| [Focus sessions](../focus-sessions.md), [live hints](../focus-realtime.md) | Existing authenticated server-canonical product and optional notification transport |
| [Work log](../work-log.md), [Codex adapter](../../integrations/codex/README.md), [local intake](../../integrations/codex/local-README.md) | Cloud/local capture distinction, transport and setup |
| [Native OpenAPI](../native-openapi.md), [Mac authentication](../macos-focus-auth.md) | HTTP contract and native auth; dated environment evidence may be stale |
| [Backend profiles](../backend-profiles.md) | Local/production endpoint selection and safeguards |
| [Google integrations](../google-integrations.md), [Sheets](../google-sheets.md) | Implemented delegated OAuth/export/job boundaries |
| [Session domain](../../packages/session-domain/README.md) | Existing shared TypeScript Focus rules, not a native replica engine |
| [Verification](../verification.md), [native acceptance](../skills/run-native-acceptance/SKILL.md), [Focus sync](../skills/verify-focus-sync/SKILL.md) | Which checks establish which evidence |

Keep changing status in the current plan. Keep architectural decisions in the design documents and original observations in dated evidence. Do not rewrite a past failed or unrun check into a pass when requirements change.
